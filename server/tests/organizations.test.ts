/**
 * Organisations : cloisonnement des données, rôle par organisation, plafonds
 * des formules d'abonnement et import de comptes.
 *
 * Le jeu de démonstration contient deux organisations : « Poryg Industries »
 * (8 applications, 8 personnes, formule Entreprise) et « Atelier Nova » (vide,
 * formule Découverte), dont Alice est membre des deux.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApplicationDto, ImportReportDto, MemberDto, OrganizationDto, UserDto } from '@poryg/shared';
import { all, one } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs, userId, validApplication } from './helpers.js';

/** Bascule la session sur une organisation et renvoie le profil mis à jour. */
async function activer(app: FastifyInstance, cookie: string, organizationId: number): Promise<UserDto> {
  const response = await app.inject({
    method: 'POST', url: `/api/organizations/${organizationId}/activate`, headers: { cookie },
  });
  if (response.statusCode !== 200) throw new Error(`activation → ${response.statusCode} ${response.body}`);
  return response.json().user;
}

/** Identifiant d'une organisation par son nom. */
function orgId(app: FastifyInstance, name: string): number {
  return one<{ id: number }>(app.db, 'SELECT id FROM organizations WHERE name = ?', name)!.id;
}

async function listeApplications(app: FastifyInstance, cookie: string): Promise<ApplicationDto[]> {
  const response = await app.inject({ method: 'GET', url: '/api/applications', headers: { cookie } });
  return response.json().applications;
}

describe('organisations', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  // --- Le jeu de démonstration ----------------------------------------------

  it('le seed crée deux organisations, dont une gratuite et vide', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const { organizations, activeId } = (await app.inject({
      method: 'GET', url: '/api/organizations', headers: { cookie },
    })).json() as { organizations: OrganizationDto[]; activeId: number };

    expect(organizations.map((o) => o.name)).toEqual(['Poryg Industries', 'Atelier Nova']);
    expect(activeId).toBe(organizations[0]!.id);

    const [principale, nova] = organizations;
    expect(principale!.plan).toBe('business');
    // 7 et non 8 : « Prévision Stock v1 » est supprimée, elle ne consomme plus de place.
    expect(principale!.usage).toMatchObject({ applications: 7, members: 8, maxApplications: null, maxMembers: null });
    expect(nova!.plan).toBe('free');
    expect(nova!.usage).toMatchObject({ applications: 0, members: 2, maxApplications: 4, maxMembers: 5 });
  });

  // --- Cloisonnement ---------------------------------------------------------

  it("les données d'une organisation sont invisibles depuis l'autre", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const nova = orgId(app, 'Atelier Nova');

    // Vue depuis Poryg Industries : l'inventaire du seed.
    expect(await listeApplications(app, cookie)).toHaveLength(8);

    // Vue depuis Atelier Nova : rien, alors que c'est la même session.
    await activer(app, cookie, nova);
    expect(await listeApplications(app, cookie)).toHaveLength(0);

    // Et pas davantage en visant une application par son identifiant.
    const detail = await app.inject({ method: 'GET', url: '/api/applications/1', headers: { cookie } });
    expect(detail.statusCode).toBe(404); // 404, pas 403 : on ne révèle pas son existence
  });

  it('les compteurs des tableaux de bord suivent le même cloisonnement', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);

    const avant = (await app.inject({ method: 'GET', url: '/api/dashboard/summary', headers: { cookie } })).json();
    expect(avant.applications).toBe(7); // hors application supprimée
    expect(avant.monthlyCostEur).toBeGreaterThan(0);

    await activer(app, cookie, orgId(app, 'Atelier Nova'));
    const apres = (await app.inject({ method: 'GET', url: '/api/dashboard/summary', headers: { cookie } })).json();
    expect(apres.applications).toBe(0);
    expect(apres.compliant).toBe(0);
    // Un compteur ne doit pas laisser fuiter la dépense de l'autre organisation.
    expect(apres.monthlyCostEur).toBe(0);
    expect(apres.recent).toEqual([]);
  });

  it("le rapport FinOps d'une organisation vide ne montre rien de l'autre", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova'));

    const { report } = (await app.inject({ method: 'GET', url: '/api/finops/report', headers: { cookie } })).json();
    expect(report.currentTotal).toBe(0);
    expect(report.windowTotal).toBe(0);
    expect(report.byApplication).toEqual([]);
    expect(report.coverage.total).toBe(0);
    expect(report.frugality.evaluated).toBe(0);
  });

  it("l'annuaire ne liste que les personnes de l'organisation active", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    expect((await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } })).json().users).toHaveLength(8);

    await activer(app, cookie, orgId(app, 'Atelier Nova'));
    const { users } = (await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } })).json();
    expect(users.map((u: { displayName: string }) => u.displayName).sort()).toEqual(['Alice Martin', 'Camille Roux']);
  });

  it("on ne peut pas désigner Process Owner quelqu'un d'une autre organisation", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova'));

    const response = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      // David n'est membre que de Poryg Industries.
      payload: { ...validApplication(app), processOwnerId: userId(app, ACCOUNTS.dpo) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.processOwnerId).toContain("n'appartient pas");
  });

  // --- Le rôle appartient à l'appartenance -----------------------------------

  it("basculer d'organisation change le rôle appliqué", async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);

    // Camille est Application Manager chez Poryg Industries…
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();
    expect(me.user.role).toBe('app_manager');
    expect(me.organizations).toHaveLength(2);

    // …et Application Manager aussi chez Nova : on lui donne un autre rôle.
    const nova = orgId(app, 'Atelier Nova');
    const alice = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, alice, nova);
    await app.inject({
      method: 'PUT', url: `/api/organizations/current/members/${userId(app, ACCOUNTS.appManager)}`,
      headers: { cookie: alice }, payload: { role: 'auditor', status: 'active' },
    });

    const profil = await activer(app, cookie, nova);
    expect(profil.role).toBe('auditor');
    expect(profil.organizationId).toBe(nova);

    // Auditeur : le droit de décider d'une conformité, pas celui de déclarer.
    const refus = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie }, payload: validApplication(app),
    });
    expect(refus.statusCode).toBe(403);

    // De retour chez Poryg Industries, c'est bien l'autre rôle qui s'applique.
    const retour = await activer(app, cookie, orgId(app, 'Poryg Industries'));
    expect(retour.role).toBe('app_manager');
  });

  it("on ne peut pas activer une organisation dont on n'est pas membre", async () => {
    const cookie = await loginAs(app, ACCOUNTS.dpo); // David n'est que chez Poryg Industries
    const response = await app.inject({
      method: 'POST', url: `/api/organizations/${orgId(app, 'Atelier Nova')}/activate`, headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  // --- Créer son organisation ------------------------------------------------

  it("n'importe quel compte connecté crée son organisation et en devient AI Officer", async () => {
    const cookie = await loginAs(app, ACCOUNTS.standard); // Lucas : le rôle le moins doté
    const response = await app.inject({
      method: 'POST', url: '/api/organizations', headers: { cookie },
      payload: { name: 'Studio Léger', plan: 'free' },
    });
    expect(response.statusCode).toBe(201);

    const { organization, user } = response.json() as { organization: OrganizationDto; user: UserDto };
    expect(organization.slug).toBe('studio-leger'); // accents et espaces normalisés
    expect(organization.role).toBe('ai_officer');
    expect(organization.usage.members).toBe(1);

    // La session bascule immédiatement dessus, avec le rôle qui va avec.
    expect(user.organizationId).toBe(organization.id);
    expect(user.role).toBe('ai_officer');

    // Et Lucas, simple utilisateur ailleurs, y déclare désormais des applications.
    const creation = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      payload: { ...validApplication(app), processOwnerId: userId(app, ACCOUNTS.standard) },
    });
    expect(creation.statusCode).toBe(201);
    // La numérotation repart de zéro : chaque registre a la sienne.
    expect(creation.json().application.code).toBe('APP-0001');
  });

  it('deux organisations de même nom reçoivent des identifiants distincts', async () => {
    const cookie = await loginAs(app, ACCOUNTS.standard);
    const creer = (name: string) =>
      app.inject({ method: 'POST', url: '/api/organizations', headers: { cookie }, payload: { name, plan: 'free' } });

    expect((await creer('Atelier Nova')).json().organization.slug).toBe('atelier-nova-2');
    expect((await creer('Atelier Nova')).json().organization.slug).toBe('atelier-nova-3');
  });

  it('deux organisations peuvent avoir chacune leur APP-0001', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova'));

    const creation = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      payload: { ...validApplication(app), processOwnerId: userId(app, ACCOUNTS.aiOfficer) },
    });
    expect(creation.statusCode).toBe(201);
    expect(creation.json().application.code).toBe('APP-0001');

    // Le code n'est unique QUE dans son organisation : APP-0001 existe déjà
    // chez Poryg Industries, et les deux doivent coexister.
    const codes = all<{ organization_id: number; code: string }>(
      app.db, "SELECT organization_id, code FROM applications WHERE code = 'APP-0001' ORDER BY organization_id",
    );
    expect(codes).toHaveLength(2);
    expect(new Set(codes.map((row) => row.organization_id)).size).toBe(2);
  });

  // --- Plafonds des formules -------------------------------------------------

  it('la formule Découverte refuse la 5e application', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova'));
    const payload = { ...validApplication(app), processOwnerId: userId(app, ACCOUNTS.aiOfficer) };

    for (let i = 1; i <= 4; i += 1) {
      const ok = await app.inject({ method: 'POST', url: '/api/applications', headers: { cookie }, payload });
      expect(ok.statusCode, `application ${i}`).toBe(201);
    }

    const refus = await app.inject({ method: 'POST', url: '/api/applications', headers: { cookie }, payload });
    expect(refus.statusCode).toBe(403);
    expect(refus.json().error.code).toBe('PLAN_LIMIT');
    expect(refus.json().error.message).toContain('Découverte');
    // Rien n'a été écrit : le plafond est vérifié AVANT l'insertion.
    expect(await listeApplications(app, cookie)).toHaveLength(4);
  });

  it("une application supprimée libère sa place dans le quota", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova'));
    const payload = { ...validApplication(app), processOwnerId: userId(app, ACCOUNTS.aiOfficer) };

    const ids: number[] = [];
    for (let i = 1; i <= 4; i += 1) {
      ids.push((await app.inject({ method: 'POST', url: '/api/applications', headers: { cookie }, payload })).json().application.id);
    }
    expect((await app.inject({ method: 'POST', url: '/api/applications', headers: { cookie }, payload })).statusCode).toBe(403);

    await app.inject({ method: 'POST', url: `/api/applications/${ids[0]}/delete`, headers: { cookie } });
    expect((await app.inject({ method: 'POST', url: '/api/applications', headers: { cookie }, payload })).statusCode).toBe(201);
  });

  it('changer de formule est refusé tant que le contenu dépasse le nouveau plafond', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);

    // Poryg Industries : 8 applications et 8 personnes, hors des plafonds gratuits.
    const refus = await app.inject({
      method: 'PUT', url: '/api/organizations/current', headers: { cookie },
      payload: { name: 'Poryg Industries', plan: 'free' },
    });
    expect(refus.statusCode).toBe(400);
    expect(refus.json().error.message).toContain('7 applications');
    expect(refus.json().error.message).toContain('8 personnes');

    // La formule Équipe (25/25), elle, accueille tout.
    const ok = await app.inject({
      method: 'PUT', url: '/api/organizations/current', headers: { cookie },
      payload: { name: 'Poryg Industries', plan: 'team' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().organization.plan).toBe('team');
    expect(ok.json().organization.usage.maxApplications).toBe(25);

    expect(
      one<{ n: number }>(app.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'organization_updated'")!.n,
    ).toBe(1);
  });

  it("renommer met à jour l'identifiant lisible, sans se heurter à lui-même", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const renommer = (name: string) =>
      app.inject({ method: 'PUT', url: '/api/organizations/current', headers: { cookie }, payload: { name, plan: 'business' } });

    expect((await renommer('Groupe Méridien')).json().organization.slug).toBe('groupe-meridien');

    // Une variante qui donne le même slug ne doit pas se voir ajouter « -2 » à
    // cause de sa propre ligne.
    expect((await renommer('GROUPE MERIDIEN')).json().organization.slug).toBe('groupe-meridien');

    // Et un nom déjà pris par une AUTRE organisation reste distingué.
    expect((await renommer('Atelier Nova')).json().organization.slug).toBe('atelier-nova-2');
  });

  it('seul un AI Officer change la formule ou renomme', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const response = await app.inject({
      method: 'PUT', url: '/api/organizations/current', headers: { cookie },
      payload: { name: 'Renommée de force', plan: 'business' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  // --- Import de comptes -----------------------------------------------------

  const IMPORT = [
    '# Les nouvelles arrivées',
    'email;nom;role',
    'jean.dupont@nova.fr;Jean Dupont;app_manager',
    'sophie.blanc@nova.fr, Sophie Blanc, Auditeur',
    'marc@nova.fr',
    'pas-une-adresse;Bidule;standard',
    'jean.dupont@nova.fr;Jean en double;standard',
    'alice.martin@poryg.local;Alice Martin;standard',
  ].join('\n');

  async function importer(cookie: string, text: string, dryRun: boolean): Promise<ImportReportDto> {
    const response = await app.inject({
      method: 'POST', url: '/api/organizations/current/members/import', headers: { cookie },
      payload: { text, dryRun },
    });
    if (response.statusCode !== 200) throw new Error(`import → ${response.statusCode} ${response.body}`);
    return response.json().report;
  }

  it("l'aperçu annonce le résultat sans rien écrire", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova'));

    const avant = all(app.db, 'SELECT 1 FROM users').length;
    const rapport = await importer(cookie, IMPORT, true);

    expect(rapport.dryRun).toBe(true);
    expect(rapport.created).toBe(3); // Jean, Sophie, Marc
    expect(rapport.already).toBe(1); // Alice est déjà membre de Nova
    expect(rapport.rejected).toBe(2); // adresse invalide + doublon dans le fichier
    expect(all(app.db, 'SELECT 1 FROM users')).toHaveLength(avant); // rien écrit
  });

  it("l'import crée les comptes, les rattache et journalise", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova'));
    const rapport = await importer(cookie, IMPORT, false);

    expect(rapport.dryRun).toBe(false);
    expect(rapport.created).toBe(3);

    // Le rôle est lu par son code OU par son libellé français.
    const roles = all<{ email: string; role: string }>(
      app.db,
      `SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ? ORDER BY u.email`,
      orgId(app, 'Atelier Nova'),
    );
    expect(roles).toEqual([
      { email: 'alice.martin@poryg.local', role: 'ai_officer' },
      { email: 'camille.roux@poryg.local', role: 'app_manager' },
      { email: 'jean.dupont@nova.fr', role: 'app_manager' },
      { email: 'marc@nova.fr', role: 'standard' }, // rôle absent → standard
      { email: 'sophie.blanc@nova.fr', role: 'auditor' }, // « Auditeur »
    ]);

    // Comptes sans mot de passe : ils entrent par Google, comme l'équipe.
    expect(
      all(app.db, "SELECT 1 FROM users WHERE email LIKE '%@nova.fr' AND password_hash IS NULL"),
    ).toHaveLength(3);
    // Nom déduit de l'adresse quand il n'est pas fourni.
    expect(one<{ display_name: string }>(app.db, "SELECT display_name FROM users WHERE email = 'marc@nova.fr'")!.display_name)
      .toBe('marc');

    expect(all(app.db, "SELECT 1 FROM audit_log WHERE action = 'member_added'")).toHaveLength(3);
    expect(all(app.db, "SELECT 1 FROM audit_log WHERE action = 'user_created'")).toHaveLength(3);
  });

  it("l'import s'arrête au plafond de la formule, ligne par ligne", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova')); // 2 membres, plafond 5

    const texte = ['a@nova.fr', 'b@nova.fr', 'c@nova.fr', 'd@nova.fr', 'e@nova.fr'].join('\n');
    const rapport = await importer(cookie, texte, false);

    expect(rapport.created).toBe(3); // 2 + 3 = 5, le plafond
    expect(rapport.rejected).toBe(2);
    expect(rapport.lines.filter((l) => l.outcome === 'rejected').every((l) => l.message.includes('Découverte'))).toBe(true);
    expect(
      one<{ n: number }>(app.db, "SELECT COUNT(*) AS n FROM memberships WHERE organization_id = ? AND status = 'active'",
        orgId(app, 'Atelier Nova'))!.n,
    ).toBe(5);
  });

  it("un compte existant est rattaché sans être recréé", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    await activer(app, cookie, orgId(app, 'Atelier Nova'));

    const rapport = await importer(cookie, `${ACCOUNTS.dpo};David Nguyen;dpo`, false);
    expect(rapport.created).toBe(0);
    expect(rapport.added).toBe(1);
    expect(all(app.db, 'SELECT 1 FROM users WHERE email = ?', ACCOUNTS.dpo)).toHaveLength(1);
    // David appartient désormais aux deux organisations.
    expect(all(app.db, 'SELECT 1 FROM memberships WHERE user_id = ?', userId(app, ACCOUNTS.dpo))).toHaveLength(2);
  });

  it("seul un AI Officer importe des comptes", async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await app.inject({
      method: 'POST', url: '/api/organizations/current/members/import', headers: { cookie },
      payload: { text: 'x@nova.fr', dryRun: false },
    });
    expect(response.statusCode).toBe(403);
  });

  // --- Membres ---------------------------------------------------------------

  it("retirer quelqu'un le prive de l'organisation sans effacer son passage", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const lucas = userId(app, ACCOUNTS.standard);

    const response = await app.inject({
      method: 'PUT', url: `/api/organizations/current/members/${lucas}`, headers: { cookie },
      payload: { role: 'standard', status: 'disabled' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json().member as MemberDto).status).toBe('disabled');

    // La ligne demeure (règle du projet : pas de suppression physique).
    expect(all(app.db, 'SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = 1', lucas)).toHaveLength(1);

    // Et Lucas, qui n'appartient plus à aucune organisation, n'accède plus à rien.
    const sien = await loginAs(app, ACCOUNTS.standard);
    const refus = await app.inject({ method: 'GET', url: '/api/applications', headers: { cookie: sien } });
    expect(refus.statusCode).toBe(403);
    expect(refus.json().error.code).toBe('NO_ORGANIZATION');
  });

  it("le dernier AI Officer ne peut être ni rétrogradé ni retiré", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const alice = userId(app, ACCOUNTS.aiOfficer);

    // Par elle-même : refusé (on ne se ferme pas la porte).
    const soi = await app.inject({
      method: 'PUT', url: `/api/organizations/current/members/${alice}`, headers: { cookie },
      payload: { role: 'standard', status: 'active' },
    });
    expect(soi.statusCode).toBe(400);
    expect(soi.json().error.message).toContain('votre propre accès');

    // Par un autre AI Officer, une fois qu'il en existe un : autorisé.
    const cleo = one<{ id: number }>(app.db, "SELECT id FROM users WHERE email = 'cleomarinmarie@gmail.com'")!.id;
    const autre = await app.inject({
      method: 'PUT', url: `/api/organizations/current/members/${cleo}`, headers: { cookie },
      payload: { role: 'standard', status: 'active' },
    });
    expect(autre.statusCode).toBe(200);
  });

  it('un compte sans organisation ne voit rien mais peut en créer une', async () => {
    const cookie = await loginAs(app, ACCOUNTS.standard);
    const officier = await loginAs(app, ACCOUNTS.aiOfficer);
    await app.inject({
      method: 'PUT', url: `/api/organizations/current/members/${userId(app, ACCOUNTS.standard)}`,
      headers: { cookie: officier }, payload: { role: 'standard', status: 'disabled' },
    });

    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();
    expect(me.user.organizationId).toBeNull();
    expect(me.organizations).toEqual([]);

    for (const url of ['/api/applications', '/api/dashboard/summary', '/api/users', '/api/organizations/current']) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error.code, url).toBe('NO_ORGANIZATION');
    }

    // La création d'organisation reste ouverte : sinon le compte serait enfermé dehors.
    const creation = await app.inject({
      method: 'POST', url: '/api/organizations', headers: { cookie }, payload: { name: 'Sortie de secours', plan: 'free' },
    });
    expect(creation.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/api/applications', headers: { cookie } })).statusCode).toBe(200);
  });
});
