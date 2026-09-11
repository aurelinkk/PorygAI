/**
 * Rapport FinOps : agrégations, couverture, saisie des coûts et autorisations.
 *
 * Le seed alimente le mois courant et les deux précédents, ce qui permet de
 * vérifier la série mensuelle et la variation sans fabriquer de données.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CO2_KG_PER_KWH, CRITICAL_CAP, FINOPS_LEVERS, PARTIAL_MIN, applicableQuestions, estimateCarbonFootprint,
  estimateCo2, hostingIntensity, getQuestion, monthKey, scoreEvaluation, shiftMonth,
  type Answers, type ApplicationFinopsDto, type FinopsReportDto,
} from '@poryg/shared';
import { all, one } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs, validApplication, answerAll } from './helpers.js';

const CURRENT = monthKey(new Date());
const FRAMING: Answers = { C1: ['eu'], C2: 'no', C3: ['none'], C4: 'no', C5: 'none', C6: 'internal' };


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

// --- FinOps responsable : énergie, carbone, frugalité, leviers ---------------

describe('FinOps responsable', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    app = await createTestApp();
    cookie = await loginAs(app, ACCOUNTS.aiOfficer);
  });
  afterEach(async () => {
    await app.close();
  });

  it('suit trois grandeurs : coût, énergie et carbone', async () => {
    const data = await report(app, cookie);

    const attendu = one<{ eur: number; kwh: number; co2: number }>(
      app.db,
      `SELECT SUM(c.amount_eur) AS eur, SUM(c.energy_kwh) AS kwh, SUM(c.co2_kg) AS co2
         FROM finops_costs c JOIN applications a ON a.id = c.application_id
        WHERE c.period_month = ? AND a.status <> 'deleted'`,
      CURRENT,
    )!;

    expect(data.current.amountEur).toBeCloseTo(attendu.eur, 2);
    expect(data.current.energyKwh).toBeCloseTo(attendu.kwh, 2);
    expect(data.current.co2Kg).toBeCloseTo(attendu.co2, 2);
    expect(data.current.energyKwh).toBeGreaterThan(0);

    // Le cumul de la fenêtre est la somme de la série mensuelle, pour les trois.
    expect(data.window.energyKwh).toBeCloseTo(
      data.monthly.reduce((sum, entry) => sum + entry.energyKwh, 0), 2,
    );
    expect(data.window.co2Kg).toBeCloseTo(data.monthly.reduce((sum, entry) => sum + entry.co2Kg, 0), 2);

    // Les répartitions portent aussi l'empreinte, sans la perdre en route.
    expect(data.byApplication.reduce((sum, row) => sum + row.energyKwh, 0)).toBeCloseTo(data.current.energyKwh, 2);
    expect(data.byDomain.reduce((sum, row) => sum + row.co2Kg, 0)).toBeCloseTo(data.current.co2Kg, 2);
  });

  it('distingue la couverture des coûts de celle des empreintes', async () => {
    const data = await report(app, cookie);

    const declarantes = one<{ n: number }>(
      app.db,
      `SELECT COUNT(DISTINCT c.application_id) AS n
         FROM finops_costs c JOIN applications a ON a.id = c.application_id
        WHERE c.period_month = ? AND a.status <> 'deleted' AND c.energy_kwh > 0`,
      CURRENT,
    )!.n;

    expect(data.coverage.withFootprint).toBe(declarantes);
    // Le jeu de démonstration contient les deux cas : sinon l'indicateur ne
    // montrerait jamais rien.
    expect(data.coverage.withFootprint).toBeGreaterThan(0);
    expect(data.coverage.withFootprint).toBeLessThan(data.coverage.withCost);
  });

  it("enregistre l'énergie et le carbone saisis, et les trace", async () => {
    const cible = appId(app, 'Chatbot Support');
    const enregistrement = await app.inject({
      method: 'PUT', url: `/api/applications/${cible}/costs`, headers: { cookie },
      payload: { periodMonth: CURRENT, amountEur: 1000, energyKwh: 2500, co2Kg: 150 },
    });
    expect(enregistrement.statusCode).toBe(200);
    expect(enregistrement.json().cost).toMatchObject({ amountEur: 1000, energyKwh: 2500, co2Kg: 150 });

    const ligne = one<{ kwh: number; co2: number }>(
      app.db,
      `SELECT energy_kwh AS kwh, co2_kg AS co2 FROM finops_costs
        WHERE application_id = ? AND period_month = ? AND source = 'manuel'`,
      cible, CURRENT,
    )!;
    expect(ligne).toEqual({ kwh: 2500, co2: 150 });

    const trace = one<{ after_json: string }>(
      app.db, "SELECT after_json FROM audit_log WHERE entity = 'finops_cost' ORDER BY id DESC",
    )!;
    expect(JSON.parse(trace.after_json)).toMatchObject({ energyKwh: 2500, co2Kg: 150 });
  });

  it("l'empreinte reste facultative : une saisie sans énergie vaut zéro, pas une erreur", async () => {
    const cible = appId(app, 'Chatbot Support');
    const enregistrement = await app.inject({
      method: 'PUT', url: `/api/applications/${cible}/costs`, headers: { cookie },
      payload: { periodMonth: CURRENT, amountEur: 500 },
    });
    expect(enregistrement.statusCode).toBe(200);
    expect(enregistrement.json().cost).toMatchObject({ amountEur: 500, energyKwh: 0, co2Kg: 0 });
  });

  it('refuse une énergie ou une empreinte négative', async () => {
    const cible = appId(app, 'Chatbot Support');
    for (const payload of [
      { periodMonth: CURRENT, amountEur: 10, energyKwh: -1 },
      { periodMonth: CURRENT, amountEur: 10, co2Kg: -1 },
    ]) {
      const response = await app.inject({
        method: 'PUT', url: `/api/applications/${cible}/costs`, headers: { cookie }, payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('croise la dépense avec la note de frugalité du questionnaire', async () => {
    const avant = await report(app, cookie);
    expect(avant.frugality.averageScore, 'aucune évaluation soumise dans le seed').toBeNull();
    expect(avant.frugality.worstOffenders).toEqual([]);

    // Une évaluation où tout le thème « Frugalité » est manqué.
    const cible = appId(app, 'Chatbot Support');
    const auditeur = await loginAs(app, ACCOUNTS.auditor);
    const soumission = await app.inject({
      method: 'POST', url: `/api/applications/${cible}/evaluation/submit`, headers: { cookie: auditeur },
      payload: {
        toolVendor: 'Copilot : Microsoft',
        purpose: 'Support client.',
        businessCriticality: 'medium',
        answers: answerAll(FRAMING, '2', { F1: '0', F2: '0', F3: '0', F4: '0', F5: '0', F6: '0', F7: '0' }),
        comments: {},
      },
    });
    expect(soumission.statusCode).toBe(200);

    const apres = await report(app, cookie);
    expect(apres.frugality.evaluated).toBe(1);
    expect(apres.frugality.averageScore).toBe(0);
    const pointee = apres.frugality.worstOffenders.find((row) => row.id === cible);
    expect(pointee, "l'application chère et non frugale doit être pointée").toBeTruthy();
    expect(pointee!.frugalityScore).toBe(0);
  });

  it('ne propose que les leviers que les données justifient', async () => {
    const data = await report(app, cookie);
    const codes = data.levers.map((lever) => lever.code);

    // Le seed donne un coût à toutes les applications actives, mais laisse
    // certaines sans empreinte : seul le levier de mesure remonte.
    expect(codes).toContain('measure_footprint');
    expect(codes).not.toContain('measure_cost');

    // Une application déclarée puis envoyée à l'audit n'a pas encore de coût :
    // le levier de visibilité apparaît, avec elle nommée dedans.
    const creation = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      payload: { ...validApplication(app), name: 'Outil sans budget' },
    });
    expect(creation.statusCode).toBe(201);
    const nouvelle = creation.json().application.id;
    await app.inject({ method: 'POST', url: `/api/applications/${nouvelle}/submit`, headers: { cookie } });

    const ensuite = await report(app, cookie);
    const visibilite = ensuite.levers.find((lever) => lever.code === 'measure_cost');
    expect(visibilite, "l'application sans coût doit produire un levier de visibilité").toBeTruthy();
    expect(visibilite!.applications.map((entry) => entry.name)).toContain('Outil sans budget');

    for (const lever of data.levers) {
      expect(FINOPS_LEVERS[lever.code], `levier inconnu : ${lever.code}`).toBeTruthy();
      expect(lever.applications.length).toBeGreaterThan(0);
      // Chaque application concernée porte une raison lisible, pas un code.
      for (const application of lever.applications) expect(application.reason.length).toBeGreaterThan(10);
      // Les applications d'un levier sont classées de la plus coûteuse à la moins coûteuse.
      const montants = lever.applications.map((entry) => entry.amountEur);
      expect([...montants].sort((a, b) => b - a)).toEqual(montants);
    }

    // Les leviers les plus lourds en dépense viennent en premier.
    const poids = data.levers.map((lever) => lever.amountEur);
    expect([...poids].sort((a, b) => b - a)).toEqual(poids);
  });

  it('la taille du modèle pèse sur l’estimation, la valeur exacte prime sur la tranche', () => {
    const base = {
      aiType: 'genai', training: 'periodic', inference: 'high', hosting: 'cloud', trainingData: 'standard',
    } as const;

    const petit = estimateCarbonFootprint({ ...base, modelSize: 'small' });
    const moyen = estimateCarbonFootprint({ ...base, modelSize: 'medium' });
    const grand = estimateCarbonFootprint({ ...base, modelSize: 'large' });

    expect(petit.energyKwh).toBeLessThan(moyen.energyKwh);
    expect(grand.energyKwh).toBeGreaterThan(moyen.energyKwh);
    expect(moyen.activeParamsM).toBe(7_000); // 7 Md : hypothèse de la tranche moyenne

    // L'énergie suit le nombre de paramètres : dix fois plus de paramètres, dix
    // fois plus d'énergie (à volume de données d'entraînement constant).
    expect(grand.energyKwh / moyen.energyKwh).toBeCloseTo(10, 1);

    // Une taille exacte remplace la tranche, y compris quand elle la contredit.
    const exact = estimateCarbonFootprint({ ...base, modelSize: 'small', modelParamsM: 70_000 });
    expect(exact.activeParamsM).toBe(70_000);
    expect(exact.energyKwh).toBeGreaterThan(petit.energyKwh);
    expect(exact.assumptions.some((a) => a.value.includes('valeur déclarée'))).toBe(true);

    // Taille inconnue : hypothèse médiane, jamais un blocage.
    const inconnue = estimateCarbonFootprint({ ...base, modelSize: 'unknown' });
    expect(inconnue.activeParamsM).toBe(7_000);
    expect(inconnue.complete).toBe(true);
  });

  it('un pré-entraînement fait décrocher l’empreinte, un ajustement non', () => {
    const base = {
      aiType: 'genai', training: 'once', inference: 'low', hosting: 'cloud', requestSize: 'medium',
    } as const;

    // Ajustement : le volume de données ne dépend pas de la taille du modèle,
    // donc multiplier la taille par dix multiplie l'énergie par dix.
    const ajusteMoyen = estimateCarbonFootprint({ ...base, modelSize: 'medium', trainingData: 'standard' });
    const ajusteGrand = estimateCarbonFootprint({ ...base, modelSize: 'large', trainingData: 'standard' });
    expect(ajusteGrand.energyKwh / ajusteMoyen.energyKwh).toBeCloseTo(10, 1);

    // Pré-entraînement : le volume de données suit la taille (20 tokens par
    // paramètre), donc l'énergie suit son carré : ×100 et non ×10.
    const preMoyen = estimateCarbonFootprint({ ...base, modelSize: 'medium', trainingData: 'pretrain' });
    const preGrand = estimateCarbonFootprint({ ...base, modelSize: 'large', trainingData: 'pretrain' });
    expect(preGrand.energyKwh / preMoyen.energyKwh).toBeCloseTo(100, 0);

    // Et un pré-entraînement pèse beaucoup plus lourd qu'un simple ajustement.
    expect(preMoyen.energyKwh).toBeGreaterThan(ajusteMoyen.energyKwh * 50);
  });

  it("l'hébergement retenu correspond aux régions annoncées à l'utilisateur", () => {
    const base = { aiType: 'genai', training: 'none', inference: 'high', modelSize: 'medium' } as const;
    const intensite = (hosting: string) => estimateCarbonFootprint({ ...base, hosting }).intensity;

    // Les valeurs affichées dans les précisions de GF7 doivent être celles du calcul.
    expect(intensite('onprem')).toBe(CO2_KG_PER_KWH);
    expect(intensite('cloud_low_carbon')).toBe(0.03);
    expect(intensite('cloud')).toBe(0.25);
    expect(intensite('cloud_high_carbon')).toBe(0.6);
    expect(intensite('unknown')).toBe(0.25);

    // Chaque option de GF7 est connue du modèle : pas d'option qui ne calcule rien.
    const gf7 = getQuestion('GF7')!;
    for (const option of gf7.options ?? []) {
      const estimation = estimateCarbonFootprint({ ...base, hosting: option.value });
      expect(estimation.complete, option.value).toBe(true);
      // Et chaque option nomme des régions ou une hypothèse : l'utilisateur doit savoir.
      expect(option.hint, option.value).toBeTruthy();
    }
  });

  it("le rapport d'une application porte son empreinte et sa note de frugalité", async () => {
    const cible = appId(app, 'Assistant Recrutement'); // le seed lui donne une consommation
    const response = await app.inject({
      method: 'GET', url: `/api/applications/${cible}/finops`, headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const rapport: ApplicationFinopsDto = response.json().report;

    expect(rapport.current.energyKwh).toBeGreaterThan(0);
    expect(rapport.current.co2Kg).toBeGreaterThan(0);
    expect(rapport.window.energyKwh).toBeGreaterThanOrEqual(rapport.current.energyKwh);
    // Aucune évaluation soumise pour cette application dans le seed.
    expect(rapport.frugalityScore).toBeNull();
    // Chaque saisie détaillée porte les trois grandeurs.
    expect(rapport.entries.every((entry) => typeof entry.energyKwh === 'number')).toBe(true);
  });
});

// --- Suivi FinOps demandé par le questionnaire, et impact annoncé -----------

describe("impact FinOps annoncé à la fin du questionnaire", () => {
  let app: FastifyInstance;
  let cookie: string;
  let cible: number;

  beforeEach(async () => {
    app = await createTestApp();
    cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    cible = appId(app, 'Chatbot Support');
  });
  afterEach(async () => {
    await app.close();
  });

  const impact = async (id = cible, who = cookie) => {
    const response = await app.inject({
      method: 'GET', url: `/api/applications/${id}/evaluation`, headers: { cookie: who },
    });
    expect(response.statusCode).toBe(200);
    return response.json().finopsImpact;
  };

  it('projette sur douze mois la moyenne des mois réellement déclarés', async () => {
    const projection = await impact();

    const declares = all<{ mois: string; eur: number; kwh: number }>(
      app.db,
      `SELECT period_month AS mois, SUM(amount_eur) AS eur, SUM(energy_kwh) AS kwh
         FROM finops_costs WHERE application_id = ? GROUP BY period_month`,
      cible,
    );
    expect(projection.monthsObserved).toBe(declares.length);
    expect(projection.monthsObserved).toBeGreaterThan(0);

    const moyenne = declares.reduce((sum, row) => sum + row.eur, 0) / declares.length;
    expect(projection.monthly.amountEur).toBeCloseTo(moyenne, 1);
    // La projection est bien douze fois la moyenne mensuelle, pas le cumul observé.
    expect(projection.yearly.amountEur).toBeCloseTo(projection.monthly.amountEur * 12, 1);
    expect(projection.yearly.energyKwh).toBeCloseTo(projection.monthly.energyKwh * 12, 1);
  });

  it("n'invente rien quand aucune donnée n'est déclarée", async () => {
    const creation = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      payload: { ...validApplication(app), name: 'Sans budget ni mesure' },
    });
    expect(creation.statusCode).toBe(201);
    const nouvelle = creation.json().application.id;
    await app.inject({ method: 'POST', url: `/api/applications/${nouvelle}/submit`, headers: { cookie } });

    const projection = await impact(nouvelle);
    expect(projection.monthsObserved).toBe(0);
    expect(projection.yearly).toEqual({ amountEur: 0, energyKwh: 0, co2Kg: 0 });
    expect(projection.co2Derived).toBe(false);
  });

  it("calcule l'empreinte depuis la consommation quand elle n'est pas déclarée, et le dit", async () => {
    // Un mois avec de l'énergie mais aucun carbone déclaré.
    app.db.prepare('UPDATE finops_costs SET co2_kg = 0, energy_kwh = 1000 WHERE application_id = ?').run(cible);

    const projection = await impact();
    expect(projection.co2Derived).toBe(true);
    // Sans évaluation soumise portant GF7, l'hypothèse est défavorable et non le
    // mix français : pour une empreinte, le cas le moins renseigné ne doit pas
    // être le plus flatteur.
    expect(projection.co2Intensity).toBe(hostingIntensity(undefined));
    expect(projection.monthly.co2Kg).toBeCloseTo(1000 * projection.co2Intensity, 2);

    // Dès qu'une empreinte est déclarée, elle est reprise telle quelle.
    app.db.prepare('UPDATE finops_costs SET co2_kg = 500 WHERE application_id = ?').run(cible);
    const declaree = await impact();
    expect(declaree.co2Derived).toBe(false);
    expect(declaree.monthly.co2Kg).toBeCloseTo(500, 2);
  });

  it("l'empreinte déduite suit la région déclarée au questionnaire", async () => {
    app.db.prepare('UPDATE finops_costs SET co2_kg = 0, energy_kwh = 1000 WHERE application_id = ?').run(cible);

    // Avant toute évaluation : hypothèse défavorable.
    expect((await impact()).co2Intensity).toBe(hostingIntensity(undefined));

    // On soumet une évaluation qui déclare un hébergement bas carbone.
    const soumission = await app.inject({
      method: 'POST', url: `/api/applications/${cible}/evaluation/submit`, headers: { cookie },
      payload: {
        toolVendor: 'Copilot : Microsoft',
        purpose: "Support client de premier niveau.",
        businessCriticality: 'medium',
        answers: answerAll(FRAMING, '2', { GF7: 'cloud_low_carbon' }),
        comments: {},
      },
    });
    expect(soumission.statusCode).toBe(200);

    const projection = await impact();
    expect(projection.co2Intensity).toBe(hostingIntensity('cloud_low_carbon'));
    expect(projection.monthly.co2Kg).toBeCloseTo(1000 * hostingIntensity('cloud_low_carbon'), 2);
    // La même application ne doit pas se voir appliquer deux intensités selon l'écran.
    expect(projection.co2Intensity).toBeLessThan(hostingIntensity(undefined));
  });

  it("n'est pas calculé pour un rôle sans accès au FinOps", async () => {
    // Le DPO lit l'évaluation mais n'a pas `finops:read`… si son rôle change un
    // jour, ce test le rappellera.
    const standard = await loginAs(app, ACCOUNTS.standard);
    const refus = await app.inject({
      method: 'GET', url: `/api/applications/${cible}/evaluation`, headers: { cookie: standard },
    });
    expect(refus.statusCode).toBe(403); // `evaluation:read` manque avant même le FinOps

    const auditeur = await impact(cible, await loginAs(app, ACCOUNTS.auditor));
    expect(auditeur.monthsObserved).toBeGreaterThan(0);
  });

  it('la gouvernance FinOps ajoute ou retire des points', () => {
    const exemplaire = scoreEvaluation(answerAll(FRAMING, '2', {
      GF1: 'automated', GF2: 'monthly', GF3: ['cost', 'energy', 'co2'], GF4: 'governance',
    }));
    const absente = scoreEvaluation(answerAll(FRAMING, '2', {
      GF1: 'none', GF2: 'none', GF3: ['none'], GF4: 'none',
    }));
    const neutre = scoreEvaluation(answerAll(FRAMING));

    expect(exemplaire.finops.points).toBe(4);
    expect(absente.finops.points).toBe(-4);
    expect(neutre.finops.points).toBe(0);

    // Les quatre volets du brief sont couverts, chacun avec son libellé.
    expect(absente.finops.details.map((detail) => detail.code)).toEqual(['GF1', 'GF2', 'GF3', 'GF4']);
    expect(absente.finops.details.every((detail) => detail.label.length > 3)).toBe(true);

    // Le score de base est conservé à côté du score ajusté : l'écart est lisible.
    expect(absente.finops.baseScore).toBe(100);
    expect(absente.score).toBe(96);
    expect(exemplaire.score).toBe(100); // le bonus ne dépasse pas 100
  });

  it("le malus FinOps ne rend jamais une application non conforme", () => {
    // Un parcours juste au-dessus du seuil de conformité partielle.
    const faible = answerAll(FRAMING, '2', {
      GF1: 'none', GF2: 'none', GF3: ['none'], GF4: 'none',
      N2: '0', N3: '0', N4: '0', N5: '0', N6: '0', N7: '0', D2: '0', T2: '0', S3: '0', S4: '0', F1: '0', F2: '0',
    });
    const result = scoreEvaluation(faible);

    expect(result.finops.baseScore).toBeGreaterThanOrEqual(PARTIAL_MIN);
    expect(result.finops.points).toBeLessThan(0);
    expect(result.finops.floored, 'le malus doit être limité au seuil').toBe(true);
    expect(result.score).toBe(PARTIAL_MIN);
    expect(result.verdict).toBe('partially_compliant');
  });

  it('le bonus FinOps ne défait pas le plafond d’un critère critique', () => {
    const result = scoreEvaluation(answerAll(FRAMING, '2', {
      GF1: 'automated', GF2: 'monthly', GF3: ['cost', 'energy', 'co2'], GF4: 'governance',
      N1: '0', // critique manquée
    }));
    expect(result.cappedBy).toContain('N1');
    expect(result.finops.points).toBe(4);
    expect(result.score).toBe(CRITICAL_CAP);
    expect(result.verdict).toBe('non_compliant');
  });

  it('les questions de gouvernance sont exigées à la soumission, sans peser sur le score', () => {
    const sansGouvernance = { ...FRAMING };
    for (const question of applicableQuestions(sansGouvernance)) {
      if (question.weight !== undefined) sansGouvernance[question.code] = '2';
    }
    const partiel = scoreEvaluation(sansGouvernance);
    expect(partiel.complete, 'sans les GF, la soumission reste incomplète').toBe(false);
    expect(partiel.missing).toEqual(expect.arrayContaining(['GF1', 'GF2', 'GF3', 'GF4', 'GF5', 'GF6', 'GF7']));

    // Elles ne changent ni le dénominateur, ni les points applicables.
    const complet = scoreEvaluation(answerAll(FRAMING));
    expect(complet.pointsApplicable).toBe(partiel.pointsApplicable);
    expect(complet.sections.some((section) => section.code === 'GF')).toBe(false);
  });

  it("estime l'empreinte d'après le type d'IA, l'usage et l'hébergement", () => {
    const chatbot = estimateCarbonFootprint({
      aiType: 'genai', training: 'none', inference: 'high', hosting: 'cloud',
    });
    expect(chatbot.complete).toBe(true);
    expect(chatbot.energyKwh).toBeGreaterThan(0);
    expect(chatbot.co2Kg).toBeGreaterThan(0);
    // Les hypothèses sont renvoyées : une estimation sans hypothèses ne se discute pas.
    expect(chatbot.assumptions.length).toBeGreaterThanOrEqual(5);

    // Même usage, hébergement bas carbone : moins d'émissions à consommation comparable.
    const basCarbone = estimateCarbonFootprint({
      aiType: 'genai', training: 'none', inference: 'high', hosting: 'cloud_low_carbon',
    });
    expect(basCarbone.co2Kg).toBeLessThan(chatbot.co2Kg);

    // L'entraînement pèse : à volume égal, un réentraînement continu domine.
    const reentraine = estimateCarbonFootprint({
      aiType: 'genai', training: 'continuous', inference: 'low', hosting: 'cloud',
    });
    expect(reentraine.trainingShare).toBeGreaterThan(0.9);

    // Un modèle léger consomme moins qu'un modèle génératif, à usage identique.
    const scoring = estimateCarbonFootprint({
      aiType: 'ml_predictive', training: 'none', inference: 'high', hosting: 'cloud',
    });
    expect(scoring.energyKwh).toBeLessThan(chatbot.energyKwh);

    // Sans les trois réponses, rien n'est affiché : pas de chiffre inventé.
    expect(estimateCarbonFootprint({ aiType: 'genai', inference: 'high' }).complete).toBe(false);
    expect(estimateCarbonFootprint({ aiType: 'genai', inference: 'high' }).co2Kg).toBe(0);
  });
});
