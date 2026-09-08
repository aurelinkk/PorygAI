/**
 * Accès aux applications IA. Toute écriture passe par ici et journalise dans audit_log.
 *
 * Règle de visibilité : un brouillon (draft) n'est visible que par son Process Owner,
 * son créateur, et les rôles ayant `application:read_all_drafts` (AI Officer).
 */
import {
  can, AUDIT_ACTION_LABELS, COMPLIANCE_VALIDITY_MONTHS, REEVALUATION_FIELDS,
  type ApplicationFilters, type AppStatus, type ApplicationDto, type AuditEntryDto,
  type CreateApplicationInput, type UpdateApplicationInput, type UserDto,
} from '@poryg/shared';
import type { SQLInputValue } from 'node:sqlite';
import { recordAudit } from '../audit.js';
import { all, one, run, transaction, type Db } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

export interface ApplicationRow {
  id: number;
  code: string;
  name: string;
  description: string;
  business_domain: string;
  data_sensitivity: string;
  ai_type: string;
  process_owner_id: number;
  owner_name: string;
  status: AppStatus;
  compliance_valid_until: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_by: number | null;
  deleted_by_name: string | null;
  deleted_at: string | null;
}

const SELECT_APPLICATION = `
  SELECT a.*,
         owner.display_name   AS owner_name,
         creator.display_name AS created_by_name,
         deleter.display_name AS deleted_by_name
    FROM applications a
    JOIN users owner   ON owner.id   = a.process_owner_id
    LEFT JOIN users creator ON creator.id = a.created_by
    LEFT JOIN users deleter ON deleter.id = a.deleted_by
`;

export function toDto(row: ApplicationRow): ApplicationDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    businessDomain: row.business_domain,
    dataSensitivity: row.data_sensitivity,
    aiType: row.ai_type,
    processOwner: { id: row.process_owner_id, displayName: row.owner_name },
    status: row.status,
    complianceValidUntil: row.compliance_valid_until,
    createdAt: row.created_at,
    createdBy: row.created_by && row.created_by_name ? { id: row.created_by, displayName: row.created_by_name } : null,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by && row.deleted_by_name ? { id: row.deleted_by, displayName: row.deleted_by_name } : null,
  };
}

/** Clause SQL de visibilité pour un utilisateur donné (à insérer après WHERE). */
export function visibilityClause(user: UserDto): { sql: string; params: number[] } {
  if (can(user.role, 'application:read_all_drafts')) return { sql: '1 = 1', params: [] };
  return {
    sql: "(a.status <> 'draft' OR a.process_owner_id = ? OR a.created_by = ?)",
    params: [user.id, user.id],
  };
}

/**
 * Liste filtrée. Les filtres sont appliqués en SQL (pas en mémoire) : la
 * recherche reste correcte même si l'inventaire grandit.
 */
export function listApplications(
  db: Db,
  user: UserDto,
  filters: ApplicationFilters = {},
  limit = 200,
): ApplicationDto[] {
  const visibility = visibilityClause(user);
  const conditions = [visibility.sql];
  const params: SQLInputValue[] = [...visibility.params];

  if (filters.q) {
    // ESCAPE s'attache à CHAQUE LIKE (et non à la clause WHERE) : il neutralise
    // % et _ saisis par l'utilisateur, qui seraient sinon des jokers.
    conditions.push(
      `(a.name LIKE ? ESCAPE '\\' OR a.code LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\')`,
    );
    const pattern = `%${filters.q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    params.push(pattern, pattern, pattern);
  }
  if (filters.status) {
    conditions.push('a.status = ?');
    params.push(filters.status);
  }
  if (filters.domain) {
    conditions.push('a.business_domain = ?');
    params.push(filters.domain);
  }
  if (filters.sensitivity) {
    conditions.push('a.data_sensitivity = ?');
    params.push(filters.sensitivity);
  }

  const rows = all<ApplicationRow>(
    db,
    `${SELECT_APPLICATION} WHERE ${conditions.join(' AND ')} ORDER BY a.updated_at DESC LIMIT ?`,
    ...params,
    limit,
  );
  return rows.map(toDto);
}

export function getApplication(db: Db, id: number): ApplicationDto | null {
  const row = one<ApplicationRow>(db, `${SELECT_APPLICATION} WHERE a.id = ?`, id);
  return row ? toDto(row) : null;
}

/** L'application `id` est-elle visible par cet utilisateur ? (brouillon d'autrui → non) */
export function isVisible(db: Db, user: UserDto, id: number): boolean {
  const visibility = visibilityClause(user);
  return Boolean(
    one(db, `SELECT 1 AS ok FROM applications a WHERE a.id = ? AND ${visibility.sql}`, id, ...visibility.params),
  );
}

/** Crée une application en statut `draft`, avec un code séquentiel APP-NNNN. */
export function createApplication(
  db: Db, input: CreateApplicationInput, actor: UserDto, ip?: string,
): ApplicationDto {
  return transaction(db, () => {
    const next = one<{ n: number }>(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS n FROM applications')!.n;
    const code = `APP-${String(next).padStart(4, '0')}`;

    const result = run(
      db,
      `INSERT INTO applications
         (code, name, description, business_domain, data_sensitivity, ai_type, process_owner_id, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      code, input.name, input.description, input.businessDomain, input.dataSensitivity, input.aiType,
      input.processOwnerId, actor.id, actor.id,
    );
    const id = Number(result.lastInsertRowid);
    const created = getApplication(db, id)!;

    recordAudit(db, { actorId: actor.id, entity: 'application', entityId: id, action: 'create', after: created, ip });
    return created;
  });
}

/** Une modification de ces champs invalide l'évaluation en cours (voir REEVALUATION_FIELDS). */
function requiresReevaluation(before: ApplicationDto, input: UpdateApplicationInput): boolean {
  return REEVALUATION_FIELDS.some((field) => before[field] !== input[field]);
}

export interface UpdateResult {
  application: ApplicationDto;
  /** L'application est repassée « In progress » parce qu'un champ évalué a changé. */
  reevaluationTriggered: boolean;
}

/**
 * Met à jour une application. Si un champ évalué change alors qu'elle était
 * conforme ou non conforme, elle repasse en cours d'audit et sa date d'échéance
 * est effacée : ce qui avait été audité n'est plus ce qui est déclaré.
 */
export function updateApplication(
  db: Db, id: number, input: UpdateApplicationInput, actor: UserDto, ip?: string,
): UpdateResult {
  return transaction(db, () => {
    const before = getApplication(db, id)!;
    const decided = before.status === 'compliant' || before.status === 'non_compliant';
    const reevaluationTriggered = decided && requiresReevaluation(before, input);
    const status: AppStatus = reevaluationTriggered ? 'in_progress' : before.status;

    run(
      db,
      `UPDATE applications
          SET name = ?, description = ?, business_domain = ?, data_sensitivity = ?, ai_type = ?,
              process_owner_id = ?, status = ?,
              compliance_valid_until = CASE WHEN ? THEN NULL ELSE compliance_valid_until END,
              updated_by = ?, updated_at = ?
        WHERE id = ?`,
      input.name, input.description, input.businessDomain, input.dataSensitivity, input.aiType,
      input.processOwnerId, status, reevaluationTriggered ? 1 : 0, actor.id, nowIso(), id,
    );

    const after = getApplication(db, id)!;
    recordAudit(db, { actorId: actor.id, entity: 'application', entityId: id, action: 'update', before, after, ip });
    return { application: after, reevaluationTriggered };
  });
}

/** Envoie un brouillon à l'audit (draft → in_progress). */
export function submitApplication(db: Db, id: number, actor: UserDto, ip?: string): ApplicationDto {
  return transaction(db, () => {
    const before = getApplication(db, id)!;
    run(db, "UPDATE applications SET status = 'in_progress', updated_by = ?, updated_at = ? WHERE id = ?",
      actor.id, nowIso(), id);
    const after = getApplication(db, id)!;
    recordAudit(db, { actorId: actor.id, entity: 'application', entityId: id, action: 'submit', before, after, ip });
    return after;
  });
}

/**
 * Suppression LOGIQUE : statut `deleted` + qui/quand. Le statut précédent est
 * conservé dans le journal d'audit, ce qui permet la restauration.
 */
export function softDeleteApplication(db: Db, id: number, actor: UserDto, ip?: string): ApplicationDto {
  return transaction(db, () => {
    const before = getApplication(db, id)!;
    run(
      db,
      "UPDATE applications SET status = 'deleted', deleted_by = ?, deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?",
      actor.id, nowIso(), actor.id, nowIso(), id,
    );
    const after = getApplication(db, id)!;
    recordAudit(db, { actorId: actor.id, entity: 'application', entityId: id, action: 'delete', before, after, ip });
    return after;
  });
}

/**
 * Restauration. On ne devine pas le statut d'avant : on le relit dans le journal
 * d'audit (dernière suppression). À défaut, retour au brouillon.
 */
export function restoreApplication(db: Db, id: number, actor: UserDto, ip?: string): ApplicationDto {
  return transaction(db, () => {
    const before = getApplication(db, id)!;
    const lastDelete = one<{ before_json: string | null }>(
      db,
      `SELECT before_json FROM audit_log
        WHERE entity = 'application' AND entity_id = ? AND action = 'delete'
        ORDER BY id DESC LIMIT 1`,
      String(id),
    );

    let previous: AppStatus = 'draft';
    if (lastDelete?.before_json) {
      const parsed = JSON.parse(lastDelete.before_json) as Partial<ApplicationDto>;
      if (parsed.status && parsed.status !== 'deleted') previous = parsed.status;
    }

    run(
      db,
      'UPDATE applications SET status = ?, deleted_by = NULL, deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?',
      previous, actor.id, nowIso(), id,
    );
    const after = getApplication(db, id)!;
    recordAudit(db, { actorId: actor.id, entity: 'application', entityId: id, action: 'restore', before, after, ip });
    return after;
  });
}

interface AuditRow {
  id: number;
  at: string;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  before_json: string | null;
  after_json: string | null;
}

/** Champs de l'application dont on suit les évolutions dans l'historique. */
const TRACKED_FIELDS = [
  'name', 'description', 'businessDomain', 'dataSensitivity', 'aiType', 'status', 'complianceValidUntil',
] as const;

/** Historique d'une application, du plus récent au plus ancien. */
export function getApplicationHistory(db: Db, id: number): AuditEntryDto[] {
  const rows = all<AuditRow>(
    db,
    `SELECT l.id, l.at, l.actor_id, u.display_name AS actor_name, l.action, l.before_json, l.after_json
       FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
      WHERE l.entity = 'application' AND l.entity_id = ?
      ORDER BY l.id DESC`,
    String(id),
  );

  return rows.map((row) => {
    const before = row.before_json ? (JSON.parse(row.before_json) as Record<string, unknown>) : null;
    const after = row.after_json ? (JSON.parse(row.after_json) as Record<string, unknown>) : null;

    const changes: AuditEntryDto['changes'] = [];
    if (before && after) {
      for (const field of TRACKED_FIELDS) {
        if (before[field] !== after[field]) changes.push({ field, before: before[field], after: after[field] });
      }
      // Le Process Owner est un objet : on compare son identifiant.
      const beforeOwner = (before.processOwner as { id: number; displayName: string } | undefined) ?? null;
      const afterOwner = (after.processOwner as { id: number; displayName: string } | undefined) ?? null;
      if (beforeOwner && afterOwner && beforeOwner.id !== afterOwner.id) {
        changes.push({ field: 'processOwner', before: beforeOwner.displayName, after: afterOwner.displayName });
      }
    }

    return {
      id: row.id,
      at: row.at,
      actor: row.actor_id && row.actor_name ? { id: row.actor_id, displayName: row.actor_name } : null,
      action: AUDIT_ACTION_LABELS[row.action] ? row.action : row.action,
      changes,
    };
  });
}

/** Échéance de conformité à poser lors d'une décision « Conforme » (utilisé au lot 4). */
export function complianceDeadline(from: string = nowIso()): string {
  const date = new Date(from);
  date.setUTCMonth(date.getUTCMonth() + COMPLIANCE_VALIDITY_MONTHS);
  return date.toISOString();
}
