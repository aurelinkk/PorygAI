/**
 * Rapport FinOps : agrégations, couverture, saisie des coûts et autorisations.
 *
 * Le seed alimente le mois courant et les deux précédents, ce qui permet de
 * vérifier la série mensuelle et la variation sans fabriquer de données.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { monthKey, shiftMonth, type ApplicationFinopsDto, type FinopsReportDto } from '@poryg/shared';
import { all, one } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs } from './helpers.js';

const CURRENT = monthKey(new Date());

function appId(app: FastifyInstance, name: string): number {
  return one<{ id: number }>(app.db, 'SELECT id FROM applications WHERE name = ?', name)!.id;
}

async function report(app: FastifyInstance, cookie: string, query = ''): Promise<FinopsReportDto> {
  const response = await app.inject({ method: 'GET', url: `/api/finops/report${query}`, headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return response.json().report;
}

describe('rapport FinOps', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    app = await createTestApp();
    cookie = await loginAs(app, ACCOUNTS.aiOfficer);
  });
  afterEach(async () => {
    await app.close();
  });

  it('totalise le mois courant en excluant les applications supprimées', async () => {
    const data = await report(app, cookie);

    // Somme attendue : tous les coûts du mois, hors application supprimée.
    const attendu = one<{ total: number }>(
      app.db,
      `SELECT SUM(c.amount_eur) AS total FROM finops_costs c JOIN applications a ON a.id = c.application_id
        WHERE c.period_month = ? AND a.status <> 'deleted'`,
      CURRENT,
    )!.total;

    expect(data.currentMonth).toBe(CURRENT);
    expect(data.currentTotal).toBe(attendu);

    // « Prévision Stock v1 » est supprimée : elle ne doit apparaître nulle part.
    expect(data.byApplication.some((row) => row.label === 'Prévision Stock v1')).toBe(false);
  });

  it('construit une série mensuelle continue, mois vides inclus', async () => {
    const data = await report(app, cookie, '?months=6');
    expect(data.monthly).toHaveLength(6);

    // Les mois se suivent sans trou.
    for (let i = 1; i < data.monthly.length; i += 1) {
      expect(data.monthly[i]!.month).toBe(shiftMonth(data.monthly[i - 1]!.month, 1));
    }
    expect(data.monthly.at(-1)!.month).toBe(CURRENT);

    // Le seed n'alimente que 3 mois : les plus anciens sont à zéro.
    expect(data.monthly[0]!.amountEur).toBe(0);
    expect(data.monthly.at(-1)!.amountEur).toBe(data.currentTotal);
    expect(data.windowTotal).toBeGreaterThan(data.currentTotal);
  });

  it('calcule la variation par rapport au mois précédent', async () => {
    const data = await report(app, cookie);
    // Le seed met le mois précédent à 90 % du mois courant : la dépense augmente.
    expect(data.previousTotal).toBeGreaterThan(0);
    expect(data.variationPct).toBeCloseTo(((data.currentTotal - data.previousTotal) / data.previousTotal) * 100, 1);
    expect(data.variationPct!).toBeGreaterThan(0);
  });

  it('renvoie null en variation quand le mois précédent est à zéro', async () => {
    // Les coûts ne peuvent pas être supprimés (trigger « pas de suppression
    // physique ») : on remet les montants du mois précédent à zéro.
    app.db.prepare('UPDATE finops_costs SET amount_eur = 0 WHERE period_month = ?').run(shiftMonth(CURRENT, -1));
    const data = await report(app, cookie);
    expect(data.previousTotal).toBe(0);
    expect(data.variationPct).toBeNull();
  });

  it('classe les applications de la plus coûteuse à la moins coûteuse', async () => {
    const data = await report(app, cookie);
    const montants = data.byApplication.map((row) => row.amountEur);
    expect(montants).toEqual([...montants].sort((a, b) => b - a));
    expect(data.byApplication[0]!.label).toBe('Assistant Recrutement'); // 18 500 € dans le seed

    // Les parts sont cohérentes et totalisent 100 %.
    const partTotale = data.byApplication.reduce((sum, row) => sum + row.share, 0);
    expect(partTotale).toBeCloseTo(1, 5);
  });

  it('ventile par domaine métier et par statut de conformité', async () => {
    const data = await report(app, cookie);

    const finance = data.byDomain.find((row) => row.key === 'finance')!;
    expect(finance.label).toBe('Finance');
    expect(finance.applications).toBe(2); // Scoring Crédit + Détection Fraude

    // Le croisement clé : la dépense portée par les applications non conformes.
    const nonConforme = data.byStatus.find((row) => row.key === 'non_compliant');
    expect(nonConforme?.label).toBe('Non conforme');
    expect(nonConforme!.amountEur).toBeGreaterThan(0);

    // Chaque ventilation retombe sur le total du mois.
    for (const rows of [data.byDomain, data.byStatus]) {
      expect(rows.reduce((sum, row) => sum + row.amountEur, 0)).toBeCloseTo(data.currentTotal, 2);
    }
    expect(data.byStatus.some((row) => row.key === 'deleted')).toBe(false);
  });

  it('signale les applications actives sans coût saisi', async () => {
    const chatbot = appId(app, 'Chatbot Support');
    // On déplace la ligne sur un mois ancien plutôt que de la supprimer.
    app.db
      .prepare("UPDATE finops_costs SET period_month = '2019-01' WHERE application_id = ? AND period_month = ?")
      .run(chatbot, CURRENT);

    const data = await report(app, cookie);
    expect(data.coverage.missing.map((item) => item.name)).toContain('Chatbot Support');
    expect(data.coverage.withCost).toBe(data.coverage.total - data.coverage.missing.length);
    // Les brouillons ne sont pas comptés : ils ne tournent pas encore.
    expect(data.coverage.missing.some((item) => item.name === 'Résumé de réunions')).toBe(false);
  });

  it('respecte la fenêtre demandée et refuse les valeurs aberrantes', async () => {
    expect((await report(app, cookie, '?months=1')).monthly).toHaveLength(1);
    expect((await report(app, cookie, '?months=12')).monthly).toHaveLength(12);

    const invalide = await app.inject({ method: 'GET', url: '/api/finops/report?months=999', headers: { cookie } });
    expect(invalide.statusCode).toBe(400);
  });

  it("un utilisateur standard n'accède pas au rapport (403)", async () => {
    const standard = await loginAs(app, ACCOUNTS.standard);
    const response = await app.inject({ method: 'GET', url: '/api/finops/report', headers: { cookie: standard } });
    expect(response.statusCode).toBe(403);
  });

  it('le DPO et l’auditeur peuvent consulter', async () => {
    for (const compte of [ACCOUNTS.dpo, ACCOUNTS.auditor]) {
      const session = await loginAs(app, compte);
      const response = await app.inject({ method: 'GET', url: '/api/finops/report', headers: { cookie: session } });
      expect(response.statusCode).toBe(200);
    }
  });
});

describe('saisie des coûts', () => {
  let app: FastifyInstance;
  let target: number;

  beforeEach(async () => {
    app = await createTestApp();
    target = appId(app, 'Chatbot Support'); // Process Owner : Camille
  });
  afterEach(async () => {
    await app.close();
  });

  const save = (cookie: string, body: Record<string, unknown>, id = target) =>
    app.inject({ method: 'PUT', url: `/api/applications/${id}/costs`, headers: { cookie }, payload: body });

  it('enregistre un coût, puis le corrige sans créer de doublon', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);

    const created = await save(cookie, { periodMonth: '2026-01', amountEur: 1200 });
    expect(created.statusCode).toBe(200);
    expect(created.json().cost).toMatchObject({ periodMonth: '2026-01', amountEur: 1200, source: 'manuel' });

    const updated = await save(cookie, { periodMonth: '2026-01', amountEur: 1500 });
    expect(updated.json().cost.amountEur).toBe(1500);

    const rows = all(
      app.db,
      "SELECT 1 FROM finops_costs WHERE application_id = ? AND period_month = '2026-01' AND source = 'manuel'",
      target,
    );
    expect(rows).toHaveLength(1);

    // Ajout puis correction sont distingués dans le journal d'audit.
    const actions = all<{ action: string }>(
      app.db, "SELECT action FROM audit_log WHERE entity = 'finops_cost' ORDER BY id",
    ).map((row) => row.action);
    expect(actions).toEqual(['cost_added', 'cost_updated']);
  });

  it('valide le format du mois et le montant', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);

    for (const mois of ['2026-13', '26-01', '2026/01', '']) {
      const response = await save(cookie, { periodMonth: mois, amountEur: 100 });
      expect(response.statusCode, mois).toBe(400);
      expect(response.json().error.fields.periodMonth).toBeDefined();
    }

    const negatif = await save(cookie, { periodMonth: '2026-01', amountEur: -5 });
    expect(negatif.statusCode).toBe(400);
    expect(negatif.json().error.fields.amountEur).toBeDefined();
  });

  it("un Application Manager ne saisit que sur ses propres applications", async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const autre = appId(app, 'Détection Fraude'); // Process Owner : Alice

    const refuse = await save(cookie, { periodMonth: '2026-01', amountEur: 100 }, autre);
    expect(refuse.statusCode).toBe(403);

    // L'AI Officer, lui, peut saisir partout.
    const officier = await loginAs(app, ACCOUNTS.aiOfficer);
    expect((await save(officier, { periodMonth: '2026-01', amountEur: 100 }, autre)).statusCode).toBe(200);
  });

  it('refuse la saisie sur une application supprimée et pour un auditeur', async () => {
    const officier = await loginAs(app, ACCOUNTS.aiOfficer);
    const supprimee = appId(app, 'Prévision Stock v1');
    const surSupprimee = await save(officier, { periodMonth: '2026-01', amountEur: 100 }, supprimee);
    expect(surSupprimee.statusCode).toBe(403);

    const auditeur = await loginAs(app, ACCOUNTS.auditor);
    expect((await save(auditeur, { periodMonth: '2026-01', amountEur: 100 })).statusCode).toBe(403);
  });

  it('liste les coûts d’une application avec la permission de saisie', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const response = await app.inject({ method: 'GET', url: `/api/applications/${target}/costs`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual({ edit: true });
    expect(response.json().costs.length).toBeGreaterThan(0);
    // Du mois le plus récent au plus ancien.
    const mois = response.json().costs.map((cost: { periodMonth: string }) => cost.periodMonth);
    expect(mois).toEqual([...mois].sort().reverse());
  });
});

// --- Rapport d'une seule application ----------------------------------------

describe("rapport FinOps d'une application", () => {
  let app: FastifyInstance;
  let cookie: string;
  let target: number;

  beforeEach(async () => {
    app = await createTestApp();
    cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    target = appId(app, 'Assistant Recrutement'); // 18 500 € : la plus coûteuse du seed
  });
  afterEach(async () => {
    await app.close();
  });

  const fetchReport = async (id = target, query = '') => {
    const response = await app.inject({
      method: 'GET', url: `/api/applications/${id}/finops${query}`, headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json().report as ApplicationFinopsDto;
  };

  it('ne compte que les coûts de cette application', async () => {
    const report = await fetchReport();
    const attendu = one<{ total: number }>(
      app.db, 'SELECT SUM(amount_eur) AS total FROM finops_costs WHERE application_id = ? AND period_month = ?',
      target, CURRENT,
    )!.total;

    expect(report.applicationId).toBe(target);
    expect(report.currentTotal).toBe(attendu);
    expect(report.currentTotal).toBeLessThan(report.companyTotal);
  });

  it("situe l'application : part de la dépense et rang", async () => {
    const report = await fetchReport();
    expect(report.shareOfCompany).toBeCloseTo(report.currentTotal / report.companyTotal, 5);
    expect(report.rank).toBe(1); // la plus coûteuse du jeu de démonstration
    expect(report.rankedOver).toBeGreaterThan(1);

    // Une application moins chère est logiquement moins bien classée.
    const autre = await fetchReport(appId(app, 'Détection Fraude'));
    expect(autre.rank!).toBeGreaterThan(1);
  });

  it('ventile par source sur toute la fenêtre', async () => {
    await app.inject({
      method: 'PUT', url: `/api/applications/${target}/costs`, headers: { cookie },
      payload: { periodMonth: CURRENT, amountEur: 500 },
    });

    const report = await fetchReport();
    const sources = Object.fromEntries(report.bySource.map((row) => [row.key, row.amountEur]));
    expect(sources.manuel).toBe(500);
    expect(sources.seed).toBeGreaterThan(0);
    expect(report.bySource.reduce((sum, row) => sum + row.amountEur, 0)).toBeCloseTo(report.windowTotal, 2);
  });

  it('liste les saisies du mois le plus récent au plus ancien', async () => {
    const report = await fetchReport();
    const mois = report.entries.map((entry) => entry.periodMonth);
    expect(mois).toEqual([...mois].sort().reverse());
    expect(report.entries.every((entry) => entry.applicationId === target)).toBe(true);
  });

  it('renvoie un rapport vide, sans erreur, pour une application sans coût', async () => {
    const sansCout = appId(app, 'Prévision Stock v1'); // supprimée : aucun coût dans le seed
    const report = await fetchReport(sansCout);
    expect(report.currentTotal).toBe(0);
    expect(report.windowTotal).toBe(0);
    expect(report.entries).toEqual([]);
    expect(report.bySource).toEqual([]);
    expect(report.rank).toBeNull();
    expect(report.shareOfCompany).toBe(0);
    expect(report.variationPct).toBeNull();
  });

  it('respecte la fenêtre demandée', async () => {
    expect((await fetchReport(target, '?months=3')).monthly).toHaveLength(3);
    expect((await fetchReport(target, '?months=24')).monthly).toHaveLength(24);
  });

  it("refuse l'accès à un utilisateur standard et 404 sur un brouillon d'autrui", async () => {
    const standard = await loginAs(app, ACCOUNTS.standard);
    expect((await app.inject({
      method: 'GET', url: `/api/applications/${target}/finops`, headers: { cookie: standard },
    })).statusCode).toBe(403);

    const auditeur = await loginAs(app, ACCOUNTS.auditor);
    expect((await app.inject({
      method: 'GET', url: `/api/applications/${appId(app, 'Résumé de réunions')}/finops`,
      headers: { cookie: auditeur },
    })).statusCode).toBe(404);
  });
});

// --- Coût du mois porté par les applications --------------------------------

describe("coût du mois dans l'inventaire", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  const list = async (email: string) => {
    const cookie = await loginAs(app, email);
    const response = await app.inject({ method: 'GET', url: '/api/applications', headers: { cookie } });
    return response.json().applications as { name: string; monthlyCostEur: number | null }[];
  };

  it('expose le coût du mois aux rôles qui ont finops:read', async () => {
    const applications = await list(ACCOUNTS.aiOfficer);
    const recrutement = applications.find((a) => a.name === 'Assistant Recrutement')!;

    const attendu = one<{ total: number }>(
      app.db, 'SELECT SUM(amount_eur) AS total FROM finops_costs WHERE application_id = (SELECT id FROM applications WHERE name = ?) AND period_month = ?',
      'Assistant Recrutement', CURRENT,
    )!.total;
    expect(recrutement.monthlyCostEur).toBe(attendu);

    // Une application sans coût sur le mois vaut 0, pas null.
    const supprimee = applications.find((a) => a.name === 'Prévision Stock v1')!;
    expect(supprimee.monthlyCostEur).toBe(0);
  });

  it("ne calcule aucun coût pour un rôle sans finops:read", async () => {
    const applications = await list(ACCOUNTS.standard);
    expect(applications.length).toBeGreaterThan(0);
    expect(applications.every((a) => a.monthlyCostEur === null)).toBe(true);
  });

  it('la fiche détaillée suit la même règle', async () => {
    const id = appId(app, 'Assistant Recrutement');
    const fiche = async (email: string) => {
      const cookie = await loginAs(app, email);
      const response = await app.inject({ method: 'GET', url: `/api/applications/${id}`, headers: { cookie } });
      return response.json().application.monthlyCostEur;
    };
    expect(await fiche(ACCOUNTS.auditor)).toBeGreaterThan(0);
    expect(await fiche(ACCOUNTS.standard)).toBeNull();
  });

  it('le coût suit une nouvelle saisie', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const id = appId(app, 'Chatbot Support');
    const avant = (await list(ACCOUNTS.aiOfficer)).find((a) => a.name === 'Chatbot Support')!.monthlyCostEur!;

    await app.inject({
      method: 'PUT', url: `/api/applications/${id}/costs`, headers: { cookie },
      payload: { periodMonth: CURRENT, amountEur: 1000 },
    });

    const apres = (await list(ACCOUNTS.aiOfficer)).find((a) => a.name === 'Chatbot Support')!.monthlyCostEur!;
    expect(apres).toBe(avant + 1000); // source 'manuel' ajoutée à la source 'seed'
  });
});
