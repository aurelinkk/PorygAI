/**
 * Organisations, appartenances et formules d'abonnement.
 *
 * Deux idées à garder en tête en lisant ce fichier :
 *
 *  - **Le rôle appartient à l'appartenance, pas au compte.** `users` ne porte
 *    plus que l'identité. Le rôle appliqué est celui de l'organisation active de
 *    la session (voir auth/session.ts).
 *  - **Les plafonds sont vérifiés ici, en base, avant l'écriture** : le client
 *    affiche une jauge, mais c'est `assertRoom` qui décide. Un plafond calculé
 *    côté client ne serait qu'une décoration.
 *
 * Comme partout : toute écriture journalise dans la même transaction.
 */
import {
  MAX_ORGANIZATIONS_PER_USER, PLAN_DEFINITIONS, ROLE_LABELS, ROLES, hasRoomFor, quotaMessage,
  type ImportLineDto, type ImportReportDto, type MemberDto, type OrganizationDto,
  type OrganizationUsageDto, type Plan, type Quota, type Role,
  type CreateOrganizationInput, type UpdateMemberInput, type UpdateOrganizationInput,
  type UserDto,
} from '@poryg/shared';
import { recordAudit } from '../audit.js';
import { all, one, run, transaction, type Db } from '../db/connection.js';
import { badRequest, noOrganization, notFound, planLimit } from '../lib/http-errors.js';
import { nowIso } from '../lib/time.js';

// --- Appartenances -----------------------------------------------------------

export interface ActiveMembership {
  organizationId: number;
  role: Role;
}

/**
 * Organisation active d'une personne : celle demandée si l'appartenance est
 * toujours valide, sinon la première dont elle est membre.
 *
 * Renvoie `null` quand la personne n'appartient à aucune organisation active :
 * c'est le cas d'un compte tout juste créé, qui ne verra aucune donnée métier
 * tant qu'il n'aura pas créé ou rejoint une organisation.
 */
export function resolveActiveMembership(db: Db, userId: number, preferred: number | null): ActiveMembership | null {
  const query = `
    SELECT m.organization_id AS organizationId, m.role AS role
      FROM memberships m
      JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'`;

  if (preferred !== null) {
    const wanted = one<ActiveMembership>(db, `${query} AND m.organization_id = ?`, userId, preferred);
    if (wanted) return wanted;
  }
  return one<ActiveMembership>(db, `${query} ORDER BY m.id LIMIT 1`, userId) ?? null;
}

/** L'utilisateur est-il membre actif de cette organisation ? (et avec quel rôle) */
export function membershipRole(db: Db, userId: number, organizationId: number): Role | null {
  const row = one<{ role: Role }>(
    db,
    "SELECT role FROM memberships WHERE user_id = ? AND organization_id = ? AND status = 'active'",
    userId, organizationId,
  );
  return row?.role ?? null;
}

/**
 * Organisation active, ou refus. Les routes gardées par `requirePermission`
 * ont déjà la garantie qu'il y en a une : cette fonction sert de filet et
 * supprime le `!` qu'il faudrait sinon écrire partout.
 */
export function currentOrganizationId(user: UserDto): number {
  if (user.organizationId === null) throw noOrganization();
  return user.organizationId;
}

// --- Lecture -----------------------------------------------------------------

interface OrganizationRow {
  id: number;
  name: string;
  slug: string;
  plan: Plan;
  created_at: string;
}

const SELECT_ORGANIZATION = `SELECT id, name, slug, plan, created_at FROM organizations WHERE status = 'active'`;

/**
 * Consommation face aux plafonds. Les applications supprimées (statut `deleted`)
 * ne comptent pas : sinon une suppression logique consommerait un quota à vie.
 */
export function usageOf(db: Db, organizationId: number, plan: Plan): OrganizationUsageDto {
  const applications = one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM applications WHERE organization_id = ? AND status <> 'deleted'",
    organizationId,
  )!.n;
  const members = one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM memberships WHERE organization_id = ? AND status = 'active'",
    organizationId,
  )!.n;

  return {
    applications,
    members,
    maxApplications: PLAN_DEFINITIONS[plan].maxApplications,
    maxMembers: PLAN_DEFINITIONS[plan].maxMembers,
  };
}

function toDto(db: Db, row: OrganizationRow, role: Role): OrganizationDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    createdAt: row.created_at,
    role,
    usage: usageOf(db, row.id, row.plan),
  };
}

/** Les organisations dont l'utilisateur est membre actif, dans l'ordre d'adhésion. */
export function listUserOrganizations(db: Db, userId: number): OrganizationDto[] {
  const rows = all<OrganizationRow & { role: Role }>(
    db,
    `SELECT o.id, o.name, o.slug, o.plan, o.created_at, m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
      ORDER BY m.id`,
    userId,
  );
  return rows.map((row) => toDto(db, row, row.role));
}

/** Une organisation vue par l'un de ses membres. `null` si elle ne l'est pas. */
export function getOrganization(db: Db, organizationId: number, userId: number): OrganizationDto | null {
  const role = membershipRole(db, userId, organizationId);
  if (!role) return null;
  const row = one<OrganizationRow>(db, `${SELECT_ORGANIZATION} AND id = ?`, organizationId);
  return row ? toDto(db, row, role) : null;
}

/** Formule en vigueur (lecture directe : les contrôles de plafond en dépendent). */
function planOf(db: Db, organizationId: number): Plan {
  const row = one<{ plan: Plan }>(db, "SELECT plan FROM organizations WHERE id = ? AND status = 'active'", organizationId);
  if (!row) throw notFound('Organisation introuvable');
  return row.plan;
}

/**
 * Refuse l'ajout si la formule est pleine. À appeler AVANT toute création
 * d'application ou rattachement de personne.
 *
 * 403 plutôt que 402 « Payment Required » : rien n'est facturé ici, et le client
 * distingue le cas grâce au code `PLAN_LIMIT`.
 */
export function assertRoom(db: Db, organizationId: number, quota: Quota): void {
  const plan = planOf(db, organizationId);
  const usage = usageOf(db, organizationId, plan);
  const current = quota === 'applications' ? usage.applications : usage.members;
  if (!hasRoomFor(plan, quota, current)) {
    throw planLimit(quotaMessage(plan, quota));
  }
}

// --- Création et réglages ----------------------------------------------------

/**
 * « Atelier Nova » → « atelier-nova ». Sans bibliothèque : `normalize('NFD')`
 * sépare les accents de leur lettre, il ne reste qu'à jeter les diacritiques.
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // les diacritiques, isolés de leur lettre par NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'organisation';
}

/**
 * Ajoute un suffixe tant que le slug est pris (« nova », « nova-2 », « nova-3 »…).
 * `exclude` : l'organisation que l'on renomme, qui ne doit pas se gêner elle-même.
 */
function uniqueSlug(db: Db, name: string, exclude?: number): string {
  const base = slugify(name);
  let candidate = base;
  for (
    let suffix = 2;
    one(db, 'SELECT 1 AS ok FROM organizations WHERE slug = ? AND id IS NOT ?', candidate, exclude ?? null);
    suffix += 1
  ) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

/**
 * Crée une organisation. Celui qui la crée en devient l'AI Officer : il faut
 * bien quelqu'un pour y inviter les autres, et c'est le seul rôle qui le peut.
 */
export function createOrganization(db: Db, input: CreateOrganizationInput, actor: UserDto, ip?: string): OrganizationDto {
  return transaction(db, () => {
    const creees = one<{ n: number }>(
      db, "SELECT COUNT(*) AS n FROM organizations WHERE created_by = ? AND status = 'active'", actor.id,
    )!.n;
    if (creees >= MAX_ORGANIZATIONS_PER_USER) {
      throw badRequest(
        `Vous avez déjà créé ${MAX_ORGANIZATIONS_PER_USER} organisations. Contactez un administrateur si vous en avez besoin de plus.`,
      );
    }

    const slug = uniqueSlug(db, input.name);
    const result = run(
      db,
      'INSERT INTO organizations (name, slug, plan, created_by, plan_changed_at) VALUES (?, ?, ?, ?, ?)',
      input.name, slug, input.plan, actor.id, nowIso(),
    );
    const id = Number(result.lastInsertRowid);

    run(
      db,
      "INSERT INTO memberships (organization_id, user_id, role, invited_by) VALUES (?, ?, 'ai_officer', ?)",
      id, actor.id, actor.id,
    );

    recordAudit(db, {
      actorId: actor.id, entity: 'organization', entityId: id, action: 'organization_created',
      after: { name: input.name, slug, plan: input.plan }, ip,
    });
    return getOrganization(db, id, actor.id)!;
  });
}

/**
 * Renommage et changement de formule.
 *
 * Un passage à une formule plus petite est refusé tant que l'organisation
 * dépasse ses nouveaux plafonds : mieux vaut un refus explicite que des
 * applications devenues invisibles ou des comptes coupés sans prévenir.
 */
export function updateOrganization(
  db: Db, organizationId: number, input: UpdateOrganizationInput, actor: UserDto, ip?: string,
): OrganizationDto {
  return transaction(db, () => {
    const before = getOrganization(db, organizationId, actor.id);
    if (!before) throw notFound('Organisation introuvable');

    if (input.plan !== before.plan) {
      const cible = PLAN_DEFINITIONS[input.plan];
      const trop: string[] = [];
      if (cible.maxApplications !== null && before.usage.applications > cible.maxApplications) {
        trop.push(`${before.usage.applications} applications pour un plafond de ${cible.maxApplications}`);
      }
      if (cible.maxMembers !== null && before.usage.members > cible.maxMembers) {
        trop.push(`${before.usage.members} personnes pour un plafond de ${cible.maxMembers}`);
      }
      if (trop.length > 0) {
        throw badRequest(
          `Impossible de passer à la formule ${cible.label} : ${trop.join(' et ')}. ` +
          'Supprimez ou retirez ce qui dépasse avant de changer de formule.',
        );
      }
    }

    // Le slug suit le nom : il n'est qu'un identifiant d'affichage (il n'apparaît
    // dans aucune URL, aucune API), et en laisser un qui contredit le nom affiché
    // ne renseignerait personne.
    const slug = input.name === before.name ? before.slug : uniqueSlug(db, input.name, organizationId);

    run(
      db,
      `UPDATE organizations
          SET name = ?, slug = ?, plan = ?,
              plan_changed_at = CASE WHEN plan <> ? THEN ? ELSE plan_changed_at END
        WHERE id = ?`,
      input.name, slug, input.plan, input.plan, nowIso(), organizationId,
    );

    const after = getOrganization(db, organizationId, actor.id)!;
    recordAudit(db, {
      actorId: actor.id, entity: 'organization', entityId: organizationId, action: 'organization_updated',
      before: { name: before.name, slug: before.slug, plan: before.plan },
      after: { name: after.name, slug: after.slug, plan: after.plan }, ip,
    });
    return after;
  });
}

// --- Membres -----------------------------------------------------------------

interface MemberRow {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  status: 'active' | 'disabled';
  created_at: string;
  sessions: number;
}

/**
 * Les personnes de l'organisation, actives puis désactivées.
 *
 * `sessions` compte les connexions déjà ouvertes : à zéro, l'invitation n'a
 * jamais été honorée, ce que la liste signale (« jamais connecté »). Les
 * sessions expirées étant purgées, l'indication est indicative, pas un audit.
 */
export function listMembers(db: Db, organizationId: number): MemberDto[] {
  const rows = all<MemberRow>(
    db,
    `SELECT u.id, u.email, u.display_name, m.role, m.status, m.created_at,
            (SELECT COUNT(*) FROM audit_log l
              WHERE l.entity = 'user' AND l.entity_id = CAST(u.id AS TEXT) AND l.action = 'login') AS sessions
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ?
      ORDER BY m.status, u.display_name`,
    organizationId,
  );

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    joinedAt: row.created_at,
    neverConnected: row.sessions === 0,
  }));
}

/** Empêche une organisation de se retrouver sans personne pour la gérer. */
function assertNotLastOfficer(db: Db, organizationId: number, userId: number): void {
  const others = one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM memberships
      WHERE organization_id = ? AND user_id <> ? AND status = 'active' AND role = 'ai_officer'`,
    organizationId, userId,
  )!.n;
  if (others === 0) {
    throw badRequest(
      "Cette personne est le dernier AI Officer de l'organisation : nommez quelqu'un d'autre avant de la retirer ou de changer son rôle.",
    );
  }
}

/** Change le rôle d'une personne, la retire de l'organisation ou l'y remet. */
export function updateMember(
  db: Db, organizationId: number, userId: number, input: UpdateMemberInput, actor: UserDto, ip?: string,
): MemberDto {
  return transaction(db, () => {
    const current = one<{ role: Role; status: 'active' | 'disabled' }>(
      db, 'SELECT role, status FROM memberships WHERE organization_id = ? AND user_id = ?', organizationId, userId,
    );
    if (!current) throw notFound("Cette personne n'appartient pas à l'organisation");

    const perdCeRole = current.role === 'ai_officer' && (input.role !== 'ai_officer' || input.status === 'disabled');
    if (perdCeRole) assertNotLastOfficer(db, organizationId, userId);

    // Réintégrer quelqu'un consomme une place, comme un nouvel arrivant.
    if (current.status === 'disabled' && input.status === 'active') assertRoom(db, organizationId, 'members');

    run(
      db,
      `UPDATE memberships
          SET role = ?, status = ?,
              disabled_by = CASE WHEN ? = 'disabled' THEN ? ELSE NULL END,
              disabled_at = CASE WHEN ? = 'disabled' THEN ? ELSE NULL END
        WHERE organization_id = ? AND user_id = ?`,
      input.role, input.status, input.status, actor.id, input.status, nowIso(), organizationId, userId,
    );

    recordAudit(db, {
      actorId: actor.id, entity: 'membership', entityId: `${organizationId}:${userId}`, action: 'member_updated',
      before: current, after: { role: input.role, status: input.status }, ip,
    });

    return listMembers(db, organizationId).find((member) => member.id === userId)!;
  });
}

// --- Import de comptes -------------------------------------------------------

/** Adresse plausible. Volontairement simple : c'est la connexion qui fait foi. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Séparateurs acceptés : point-virgule, virgule, tabulation. */
const SEPARATORS = /[;,\t]/;

/** Codes et libellés de rôle acceptés à l'import (« dpo », « DPO », « Auditeur »…). */
const ROLE_BY_LABEL = new Map<string, Role>([
  ...ROLES.map((role) => [role.toLowerCase(), role] as const),
  ...ROLES.map((role) => [ROLE_LABELS[role].toLowerCase(), role] as const),
]);

interface ParsedLine {
  line: number;
  email: string;
  displayName: string;
  role: Role | null;
  /** Motif de rejet dès l'analyse (adresse invalide, rôle inconnu). */
  error?: string;
}

/**
 * Une personne par ligne : `adresse ; nom ; rôle`.
 * Le nom et le rôle sont facultatifs (nom déduit de l'adresse, rôle `standard`).
 * Les lignes vides, les commentaires (`#`) et un éventuel en-tête sont ignorés.
 */
function parseLines(text: string): ParsedLine[] {
  const parsed: ParsedLine[] = [];
  /** Aucune ligne utile n'a encore été lue : la suivante peut être un en-tête. */
  let attendUnEntete = true;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const [rawEmail = '', rawName = '', rawRole = ''] = trimmed.split(SEPARATORS).map((part) => part.trim());
    const email = rawEmail.toLowerCase();

    // En-tête d'un export tableur (« email;nom;role »). On le cherche sur la
    // première ligne UTILE et non sur la première du fichier : un commentaire
    // ou une ligne vide la précède souvent.
    if (attendUnEntete && ['email', 'e-mail', 'adresse', 'mail', 'courriel'].includes(email)) {
      attendUnEntete = false;
      return;
    }
    attendUnEntete = false;

    if (!EMAIL.test(email)) {
      parsed.push({ line, email: rawEmail, displayName: rawName, role: null, error: 'Adresse e-mail invalide' });
      return;
    }

    let role: Role = 'standard';
    if (rawRole) {
      const found = ROLE_BY_LABEL.get(rawRole.toLowerCase());
      if (!found) {
        parsed.push({
          line, email, displayName: rawName, role: null,
          error: `Rôle inconnu : « ${rawRole} ». Attendu : ${ROLES.join(', ')}`,
        });
        return;
      }
      role = found;
    }

    // Sans nom fourni, la partie gauche de l'adresse fait l'affaire : mieux vaut
    // « jean.dupont » qu'une ligne vide dans la liste des membres.
    const displayName = rawName || email.split('@')[0]!.replace(/[._-]+/g, ' ');
    parsed.push({ line, email, displayName, role });
  });

  return parsed;
}

/**
 * Analyse le texte et calcule, ligne par ligne, ce qui se passerait.
 *
 * `dryRun` n'a pas de traitement à part : l'aperçu est CE calcul, et l'import
 * l'exécute ensuite. Deux implémentations (une pour prévoir, une pour faire)
 * finiraient par ne plus dire la même chose.
 */
export function importMembers(
  db: Db, organizationId: number, text: string, dryRun: boolean, actor: UserDto, ip?: string,
): ImportReportDto {
  const parsed = parseLines(text);
  const plan = planOf(db, organizationId);
  let members = usageOf(db, organizationId, plan).members;

  const vues = new Set<string>();
  const lines: ImportLineDto[] = [];
  /** Ce qu'il faudra écrire si ce n'est pas un simple aperçu. */
  const aEcrire: { email: string; displayName: string; role: Role; existant: number | null }[] = [];

  for (const entry of parsed) {
    const push = (outcome: ImportLineDto['outcome'], message: string) =>
      lines.push({ line: entry.line, email: entry.email, displayName: entry.displayName, role: entry.role, message, outcome });

    if (entry.error) {
      push('rejected', entry.error);
      continue;
    }
    if (vues.has(entry.email)) {
      push('rejected', 'Adresse déjà présente plus haut dans le fichier');
      continue;
    }
    vues.add(entry.email);

    const compte = one<{ id: number; display_name: string }>(
      db, 'SELECT id, display_name FROM users WHERE email = ?', entry.email,
    );
    const deja = compte
      ? one<{ status: string }>(
          db, 'SELECT status FROM memberships WHERE organization_id = ? AND user_id = ?', organizationId, compte.id,
        )
      : undefined;

    if (deja?.status === 'active') {
      push('already', `Déjà membre de l'organisation`);
      continue;
    }

    if (!hasRoomFor(plan, 'members', members)) {
      push('rejected', quotaMessage(plan, 'members'));
      continue;
    }

    members += 1;
    aEcrire.push({ email: entry.email, displayName: entry.displayName, role: entry.role!, existant: compte?.id ?? null });
    push(
      compte ? 'added' : 'created',
      compte
        ? `Compte existant rattaché avec le rôle ${ROLE_LABELS[entry.role!]}`
        : `Compte créé (connexion Google) avec le rôle ${ROLE_LABELS[entry.role!]}`,
    );
  }

  if (!dryRun && aEcrire.length > 0) {
    transaction(db, () => {
      for (const ligne of aEcrire) {
        let userId = ligne.existant;
        if (userId === null) {
          // `password_hash` NULL : le compte ne peut PAS se connecter par mot de
          // passe (le provider local le refuse). L'entrée se fait par Google,
          // comme pour les comptes créés par la migration 002.
          const result = run(
            db, 'INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, NULL)',
            ligne.email, ligne.displayName,
          );
          userId = Number(result.lastInsertRowid);
          recordAudit(db, {
            actorId: actor.id, entity: 'user', entityId: userId, action: 'user_created',
            after: { email: ligne.email, displayName: ligne.displayName }, ip,
          });
        }

        // `INSERT OR REPLACE` réactiverait une appartenance désactivée en
        // perdant son historique : on distingue les deux cas.
        const existante = one<{ id: number }>(
          db, 'SELECT id FROM memberships WHERE organization_id = ? AND user_id = ?', organizationId, userId,
        );
        if (existante) {
          run(
            db,
            "UPDATE memberships SET role = ?, status = 'active', disabled_by = NULL, disabled_at = NULL WHERE id = ?",
            ligne.role, existante.id,
          );
        } else {
          run(
            db, 'INSERT INTO memberships (organization_id, user_id, role, invited_by) VALUES (?, ?, ?, ?)',
            organizationId, userId, ligne.role, actor.id,
          );
        }

        recordAudit(db, {
          actorId: actor.id, entity: 'membership', entityId: `${organizationId}:${userId}`, action: 'member_added',
          after: { email: ligne.email, role: ligne.role }, ip,
        });
      }
    });
  }

  return {
    dryRun,
    lines,
    created: lines.filter((line) => line.outcome === 'created').length,
    added: lines.filter((line) => line.outcome === 'added').length,
    already: lines.filter((line) => line.outcome === 'already').length,
    rejected: lines.filter((line) => line.outcome === 'rejected').length,
  };
}
