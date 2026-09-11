/**
 * Lot 2 : inventaire : filtres, modification, envoi à l'audit,
 * suppression logique, restauration, historique.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApplicationDto, AuditEntryDto } from '@poryg/shared';
import { all, one } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs, userId, validApplication } from './helpers.js';

/** Identifiants des applications du seed, retrouvés par nom. */
function appId(app: FastifyInstance, name: string): number {
  return one<{ id: number }>(app.db, 'SELECT id FROM applications WHERE name = ?', name)!.id;
}

async function list(app: FastifyInstance, cookie: string, query = ''): Promise<ApplicationDto[]> {
  const response = await app.inject({ method: 'GET', url: `/api/applications${query}`, headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return response.json().applications;
}

describe('inventaire : filtres', () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeEach(async () => {
    app = await createTestApp();
    cookie = await loginAs(app, ACCOUNTS.aiOfficer);
  });
  afterEach(async () => {
    await app.close();
  });

  it('recherche sur le nom, le code et la description', async () => {
    expect((await list(app, cookie, '?q=Recrutement')).map((a) => a.name)).toEqual(['Assistant Recrutement']);
    expect((await list(app, cookie, '?q=APP-0002')).map((a) => a.name)).toEqual(['Scoring Crédit']);

    const byDescription = await list(app, cookie, '?q=transactions%20suspectes');
    expect(byDescription.map((a) => a.name)).toEqual(['Détection Fraude']);
  });

  it('la recherche est insensible à la casse et ne traite pas % comme un joker', async () => {
    expect((await list(app, cookie, '?q=chatbot')).map((a) => a.name)).toEqual(['Chatbot Support']);
    // Sans échappement, '%' remonterait toutes les applications.
    expect(await list(app, cookie, '?q=%25')).toHaveLength(0);
  });

  it('filtre par statut, domaine et sensibilité', async () => {
    const compliant = await list(app, cookie, '?status=compliant');
    expect(compliant.every((a) => a.status === 'compliant')).toBe(true);
    expect(compliant.length).toBeGreaterThan(0);

    const rh = await list(app, cookie, '?domain=rh');
    expect(rh.map((a) => a.name).sort()).toEqual(['Assistant Recrutement', 'Tri automatique des CV']);

    const sensitive = await list(app, cookie, '?sensitivity=sensitive');
    expect(sensitive.map((a) => a.name)).toEqual(['Tri automatique des CV']);
  });

  it('combine les filtres', async () => {
    expect(await list(app, cookie, '?domain=rh&status=compliant')).toHaveLength(1);
    expect(await list(app, cookie, '?domain=finance&sensitivity=sensitive')).toHaveLength(0);
  });

  it('ignore les paramètres vides et rejette les valeurs inconnues', async () => {
    expect(await list(app, cookie, '?q=&status=&domain=')).toHaveLength(8);

    const invalid = await app.inject({ method: 'GET', url: '/api/applications?status=inexistant', headers: { cookie } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('les filtres respectent la visibilité des brouillons', async () => {
    const auditorCookie = await loginAs(app, ACCOUNTS.auditor);
    expect(await list(app, auditorCookie, '?status=draft')).toHaveLength(0);
    expect(await list(app, cookie, '?status=draft')).toHaveLength(1); // AI Officer
  });
});

describe('inventaire : modification', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  const payload = (app: FastifyInstance, overrides: Record<string, unknown> = {}) => ({
    ...validApplication(app),
    name: 'Chatbot Support',
    description: 'Description mise à jour.',
    businessDomain: 'client',
    dataSensitivities: ['internal', 'personal'],
    aiType: 'genai',
    ...overrides,
  });

  it("un Application Manager modifie ses propres applications", async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const id = appId(app, 'Chatbot Support');

    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie }, payload: payload(app),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().application.description).toBe('Description mise à jour.');
    expect(response.json().reevaluationTriggered).toBe(false);

    const audit = one<{ action: string }>(
      app.db, "SELECT action FROM audit_log WHERE entity_id = ? AND action = 'update'", String(id),
    );
    expect(audit).toBeDefined();
  });

  it("un Application Manager ne peut pas modifier l'application d'un autre (403)", async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const id = appId(app, 'Détection Fraude'); // Process Owner : Alice (AI Officer)

    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: payload(app, { name: 'Détection Fraude' }),
    });
    expect(response.statusCode).toBe(403);
    expect(one<{ name: string }>(app.db, 'SELECT name FROM applications WHERE id = ?', id)?.name)
      .toBe('Détection Fraude');
  });

  it("l'AI Officer peut modifier n'importe quelle application", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Chatbot Support');
    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie }, payload: payload(app),
    });
    expect(response.statusCode).toBe(200);
  });

  it('un auditeur ne peut pas modifier (403 sur la permission de rôle)', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${appId(app, 'Chatbot Support')}`, headers: { cookie }, payload: payload(app),
    });
    expect(response.statusCode).toBe(403);
  });

  it('changer un champ évalué replace une application conforme en cours d’audit', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Assistant Recrutement'); // conforme, échéance en 2027

    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: {
        name: 'Assistant Recrutement', description: 'idem', businessDomain: 'rh',
        dataSensitivities: ['internal', 'personal', 'sensitive'], // ← champ évalué modifié
        aiType: 'genai', processOwnerId: userId(app, ACCOUNTS.appManager),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reevaluationTriggered).toBe(true);
    expect(response.json().application.status).toBe('in_progress');
    expect(response.json().application.complianceValidUntil).toBeNull();
  });

  it('changer un champ non évalué conserve la conformité', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Assistant Recrutement');
    const before = one<{ compliance_valid_until: string }>(
      app.db, 'SELECT compliance_valid_until FROM applications WHERE id = ?', id,
    )!;

    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: {
        name: 'Assistant Recrutement v2', description: 'Nouvelle description.', businessDomain: 'rh',
        dataSensitivities: ['internal', 'personal'], aiType: 'genai', processOwnerId: userId(app, ACCOUNTS.appManager),
      },
    });

    expect(response.json().reevaluationTriggered).toBe(false);
    expect(response.json().application.status).toBe('compliant');
    expect(response.json().application.complianceValidUntil).toBe(before.compliance_valid_until);
  });

  it('valide les champs et le Process Owner', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Chatbot Support');

    const invalid = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: { name: 'A', businessDomain: 'nope', dataSensitivities: [], aiType: 'genai', processOwnerId: 1 },
    });
    expect(invalid.statusCode).toBe(400);

    const unknownOwner = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: payload(app, { processOwnerId: 9999 }),
    });
    expect(unknownOwner.statusCode).toBe(400);
    expect(unknownOwner.json().error.fields.processOwnerId).toBeDefined();
  });
});

describe('inventaire : natures de données multiples', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('enregistre toute la sélection et en dérive le niveau le plus élevé', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const response = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      payload: { ...validApplication(app), dataSensitivities: ['personal', 'public', 'internal'] },
    });
    expect(response.statusCode).toBe(201);

    const creee: ApplicationDto = response.json().application;
    // Rangée dans l'ordre du référentiel, quel que soit l'ordre de saisie.
    expect(creee.dataSensitivities).toEqual(['public', 'internal', 'personal']);
    // Le niveau est calculé, jamais reçu du client.
    expect(creee.dataSensitivity).toBe('personal');
  });

  it('refuse une sélection vide', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const response = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      payload: { ...validApplication(app), dataSensitivities: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.dataSensitivities).toContain('au moins une');
  });

  it('le filtre trouve une nature de données même quand ce n’est pas la plus élevée', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);

    // « Tri automatique des CV » traite de l'interne, du personnel et du sensible.
    const internes = await list(app, cookie, '?sensitivity=internal');
    expect(internes.map((a) => a.name)).toContain('Tri automatique des CV');

    // La même application reste trouvable par son niveau le plus élevé.
    const sensibles = await list(app, cookie, '?sensitivity=sensitive');
    expect(sensibles.map((a) => a.name)).toEqual(['Tri automatique des CV']);
  });

  it('changer la liste sans changer le maximum déclenche quand même une réévaluation', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Assistant Recrutement'); // conforme, ['internal', 'personal']

    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: {
        name: 'Assistant Recrutement', description: 'idem', businessDomain: 'rh', aiType: 'genai',
        // On ajoute « confidentielles » : le maximum reste « personnelles »…
        dataSensitivities: ['internal', 'confidential', 'personal'],
        processOwnerId: userId(app, ACCOUNTS.appManager),
      },
    });

    expect(response.json().application.dataSensitivity).toBe('personal');
    // …mais ce qui a été audité a changé : retour en audit.
    expect(response.json().reevaluationTriggered).toBe(true);
    expect(response.json().application.status).toBe('in_progress');
  });

  it('réordonner la même sélection ne déclenche rien', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Assistant Recrutement');

    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: {
        name: 'Assistant Recrutement', description: 'idem', businessDomain: 'rh', aiType: 'genai',
        dataSensitivities: ['personal', 'internal'], // même contenu, autre ordre
        processOwnerId: userId(app, ACCOUNTS.appManager),
      },
    });

    expect(response.json().reevaluationTriggered).toBe(false);
    expect(response.json().application.status).toBe('compliant');
  });
});

describe('inventaire : cycle de vie', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("envoie un brouillon à l'audit", async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const id = appId(app, 'Résumé de réunions'); // draft, Process Owner : Camille

    const response = await app.inject({ method: 'POST', url: `/api/applications/${id}/submit`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().application.status).toBe('in_progress');

    // Deuxième envoi impossible : ce n'est plus un brouillon.
    const again = await app.inject({ method: 'POST', url: `/api/applications/${id}/submit`, headers: { cookie } });
    expect(again.statusCode).toBe(403);
  });

  it("seul l'AI Officer peut supprimer, et la suppression est logique", async () => {
    const managerCookie = await loginAs(app, ACCOUNTS.appManager);
    const id = appId(app, 'Chatbot Support');

    const refused = await app.inject({ method: 'POST', url: `/api/applications/${id}/delete`, headers: { cookie: managerCookie } });
    expect(refused.statusCode).toBe(403);

    const officerCookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const response = await app.inject({ method: 'POST', url: `/api/applications/${id}/delete`, headers: { cookie: officerCookie } });
    expect(response.statusCode).toBe(200);

    const deleted: ApplicationDto = response.json().application;
    expect(deleted.status).toBe('deleted');
    expect(deleted.deletedBy?.displayName).toBe('Alice Martin');
    expect(deleted.deletedAt).not.toBeNull();

    // La ligne est toujours en base : rien n'a été supprimé physiquement.
    expect(all(app.db, 'SELECT 1 FROM applications WHERE id = ?', id)).toHaveLength(1);
    // Et elle reste visible dans l'inventaire.
    expect((await list(app, officerCookie)).some((a) => a.id === id)).toBe(true);
  });

  it('une application supprimée ne peut plus être modifiée', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Prévision Stock v1'); // déjà supprimée dans le seed

    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: {
        name: 'Tentative', description: '', businessDomain: 'supply', dataSensitivities: ['internal'],
        aiType: 'ml_predictive', processOwnerId: userId(app, ACCOUNTS.appManager),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/supprimée/);
  });

  it('restaure une application dans son statut précédent', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Assistant Recrutement'); // conforme

    await app.inject({ method: 'POST', url: `/api/applications/${id}/delete`, headers: { cookie } });
    const restored = await app.inject({ method: 'POST', url: `/api/applications/${id}/restore`, headers: { cookie } });

    expect(restored.statusCode).toBe(200);
    const application: ApplicationDto = restored.json().application;
    expect(application.status).toBe('compliant'); // et non 'draft'
    expect(application.deletedAt).toBeNull();
    expect(application.deletedBy).toBeNull();
  });

  it('refuse de restaurer une application qui ne l’est pas, et de supprimer deux fois', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Chatbot Support');

    const restore = await app.inject({ method: 'POST', url: `/api/applications/${id}/restore`, headers: { cookie } });
    expect(restore.statusCode).toBe(400);

    await app.inject({ method: 'POST', url: `/api/applications/${id}/delete`, headers: { cookie } });
    const twice = await app.inject({ method: 'POST', url: `/api/applications/${id}/delete`, headers: { cookie } });
    expect(twice.statusCode).toBe(400);
  });
});

describe('inventaire : fiche et historique', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('la fiche annonce les actions réellement permises', async () => {
    const id = appId(app, 'Résumé de réunions'); // brouillon de Camille

    const manager = await app.inject({
      method: 'GET', url: `/api/applications/${id}`, headers: { cookie: await loginAs(app, ACCOUNTS.appManager) },
    });
    expect(manager.json().permissions).toEqual({
      edit: true, submit: true, delete: false, restore: false, history: true,
    });

    const officer = await app.inject({
      method: 'GET', url: `/api/applications/${id}`, headers: { cookie: await loginAs(app, ACCOUNTS.aiOfficer) },
    });
    expect(officer.json().permissions).toMatchObject({ edit: true, submit: true, delete: true, restore: false });

    const standard = await app.inject({
      method: 'GET', url: `/api/applications/${appId(app, 'Chatbot Support')}`,
      headers: { cookie: await loginAs(app, ACCOUNTS.standard) },
    });
    expect(standard.json().permissions).toEqual({
      edit: false, submit: false, delete: false, restore: false, history: false,
    });
  });

  it("l'historique liste les événements et détaille les champs modifiés", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Chatbot Support');

    await app.inject({
      method: 'PUT', url: `/api/applications/${id}`, headers: { cookie },
      payload: {
        name: 'Chatbot Support', description: 'Nouvelle description.', businessDomain: 'client',
        dataSensitivities: ['confidential'], aiType: 'genai', processOwnerId: userId(app, ACCOUNTS.aiOfficer),
      },
    });

    const response = await app.inject({ method: 'GET', url: `/api/applications/${id}/history`, headers: { cookie } });
    expect(response.statusCode).toBe(200);

    const history: AuditEntryDto[] = response.json().history;
    expect(history[0]!.action).toBe('update'); // le plus récent d'abord
    expect(history[0]!.actor?.displayName).toBe('Alice Martin');

    const changed = Object.fromEntries(history[0]!.changes.map((c) => [c.field, c]));
    // Le niveau dérivé bouge, et la liste saisie aussi : l'historique montre les deux.
    expect(changed.dataSensitivity).toMatchObject({ before: 'personal', after: 'confidential' });
    expect(changed.dataSensitivities).toMatchObject({
      before: ['internal', 'personal'], after: ['confidential'],
    });
    expect(changed.description!.after).toBe('Nouvelle description.');
    expect(changed.processOwner).toMatchObject({ before: 'Camille Roux', after: 'Alice Martin' });
    // Un champ inchangé n'apparaît pas.
    expect(changed.name).toBeUndefined();
  });

  it("un utilisateur standard n'accède pas à l'historique (403)", async () => {
    const response = await app.inject({
      method: 'GET', url: `/api/applications/${appId(app, 'Chatbot Support')}/history`,
      headers: { cookie: await loginAs(app, ACCOUNTS.standard) },
    });
    expect(response.statusCode).toBe(403);
  });

  it("l'historique d'un brouillon d'autrui renvoie 404", async () => {
    const response = await app.inject({
      method: 'GET', url: `/api/applications/${appId(app, 'Résumé de réunions')}/history`,
      headers: { cookie: await loginAs(app, ACCOUNTS.auditor) },
    });
    expect(response.statusCode).toBe(404);
  });

  it('un identifiant invalide renvoie 404 sans planter', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    for (const path of ['abc', '-1', '99999']) {
      expect((await app.inject({ method: 'GET', url: `/api/applications/${path}`, headers: { cookie } })).statusCode)
        .toBe(404);
    }
  });
});
