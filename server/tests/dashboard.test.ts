/**
 * Tableaux de bord BI (lot 6).
 *
 * Ce qui est vérifié : les agrégats sont cohérents avec l'inventaire, la fenêtre
 * d'historique est complète (mois vides compris), une évaluation soumise remonte
 * dans l'historique et dans les thèmes faibles, et : le plus important : un
 * tableau de bord ne laisse pas fuiter ce que l'utilisateur n'a pas le droit de
 * voir : ni le brouillon d'un autre, ni les coûts pour qui n'a pas `finops:read`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  APP_STATUSES, applicableQuestions, monthKey, shiftMonth, type Answers, type BiReportDto,
} from '@poryg/shared';
import { one } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs, userId, validApplication, answerAll } from './helpers.js';


const FRAMING: Answers = { C1: ['eu'], C2: 'no', C3: ['none'], C4: 'no', C5: 'none', C6: 'internal' };
const PRELIMINARY = {
  toolVendor: 'Outil interne : équipe Data',
  purpose: "Résumé automatique des comptes rendus d'entretien.",
  businessCriticality: 'medium',
};

async function report(app: FastifyInstance, cookie: string, months = 12): Promise<BiReportDto> {
  const response = await app.inject({
    method: 'GET', url: `/api/dashboard/bi?months=${months}`, headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json().report;
}

describe('tableaux de bord BI', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("décrit le parc : total, répartitions et taux de conformité", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const bi = await report(app, cookie);

    const active = one<{ n: number }>(app.db, "SELECT COUNT(*) AS n FROM applications WHERE status <> 'deleted'")!;
    expect(bi.portfolio.total).toBe(active.n);

    // Les répartitions couvrent exactement le parc, sans perdre ni compter deux fois.
    for (const rows of [bi.portfolio.byStatus, bi.portfolio.byDomain, bi.portfolio.bySensitivity, bi.portfolio.byAiType]) {
      expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(bi.portfolio.total);
    }

    // Les catégories vides restent listées : « aucune application » est une information.
    expect(bi.portfolio.byStatus.map((row) => row.key)).toEqual(
      APP_STATUSES.filter((status) => status !== 'deleted'),
    );

    const compliant = bi.portfolio.byStatus.find((row) => row.key === 'compliant')!.count;
    const decided = bi.portfolio.byStatus
      .filter((row) => ['compliant', 'partially_compliant', 'non_compliant'].includes(row.key))
      .reduce((sum, row) => sum + row.count, 0);
    expect(bi.portfolio.complianceRate).toBeCloseTo(compliant / decided, 2);
  });

  it("renvoie une fenêtre d'historique complète, mois vides compris", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const bi = await report(app, cookie, 6);

    expect(bi.months).toBe(6);
    expect(bi.history).toHaveLength(6);
    expect(bi.activity.byMonth).toHaveLength(6);

    const current = monthKey(new Date());
    expect(bi.history[5]!.month).toBe(current);
    expect(bi.history[0]!.month).toBe(shiftMonth(current, -5));
    expect(bi.currentMonth).toBe(current);
  });

  it("une évaluation soumise apparaît dans l'historique, les thèmes faibles et les manques", async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const target = one<{ id: number }>(app.db, "SELECT id FROM applications WHERE name = 'Chatbot Support'")!.id;

    const avant = await report(app, cookie);
    const submitted = await app.inject({
      method: 'POST', url: `/api/applications/${target}/evaluation/submit`, headers: { cookie },
      // Tout à « Non » : score au plancher, donc des thèmes faibles et des manques garantis.
      payload: { ...PRELIMINARY, answers: answerAll(FRAMING, '0'), comments: {} },
    });
    expect(submitted.statusCode).toBe(200);

    const apres = await report(app, cookie);
    const mois = monthKey(new Date());
    const ligne = apres.history.find((row) => row.month === mois)!;
    expect(ligne.submitted).toBe(avant.history.find((row) => row.month === mois)!.submitted + 1);
    expect(ligne.nonCompliant).toBeGreaterThan(0);

    expect(apres.quality.submitted).toBeGreaterThan(avant.quality.submitted);
    expect(apres.quality.averageScore).not.toBeNull();
    expect(apres.quality.weakestSections.length).toBeGreaterThan(0);
    expect(apres.quality.weakestSections[0]!.averageScore).toBeLessThanOrEqual(
      apres.quality.weakestSections.at(-1)!.averageScore,
    );

    // Les manques sont classés du plus fréquent au moins fréquent.
    expect(apres.quality.topGaps.length).toBeGreaterThan(0);
    const counts = apres.quality.topGaps.map((gap) => gap.missed);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(apres.quality.topGaps[0]!.wording).not.toBe(apres.quality.topGaps[0]!.code);

    // Le plan d'action généré par cette évaluation est comptabilisé.
    expect(apres.actions.open).toBeGreaterThan(avant.actions.open);
  });

  it("ne révèle pas le brouillon d'un autre", async () => {
    const camille = await loginAs(app, ACCOUNTS.appManager);
    const lucas = await loginAs(app, ACCOUNTS.standard);
    const alice = await loginAs(app, ACCOUNTS.aiOfficer);

    const mois = monthKey(new Date());
    const declarées = (bi: BiReportDto) => bi.history.find((row) => row.month === mois)!.declared;
    const avant = {
      camille: await report(app, camille),
      lucas: await report(app, lucas),
      alice: await report(app, alice),
    };

    // Camille déclare une application : elle reste en brouillon, visible d'elle seule.
    const created = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie: camille },
      payload: { ...validApplication(app), name: 'Brouillon confidentiel' },
    });
    expect(created.statusCode).toBe(201);

    const apres = {
      camille: await report(app, camille),
      lucas: await report(app, lucas),
      alice: await report(app, alice),
    };

    // Propriétaire et AI Officer (`application:read_all_drafts`) voient le brouillon…
    expect(apres.camille.portfolio.total).toBe(avant.camille.portfolio.total + 1);
    expect(apres.alice.portfolio.total).toBe(avant.alice.portfolio.total + 1);
    expect(declarées(apres.camille)).toBe(declarées(avant.camille) + 1);

    // …un tiers ne voit rien bouger, ni dans le parc, ni dans l'historique, ni dans l'activité.
    expect(apres.lucas.portfolio.total).toBe(avant.lucas.portfolio.total);
    expect(declarées(apres.lucas)).toBe(declarées(avant.lucas));
    const événements = (bi: BiReportDto) => bi.activity.byAction.reduce((sum, row) => sum + row.count, 0);
    expect(événements(apres.lucas)).toBe(événements(avant.lucas));
    expect(événements(apres.camille)).toBe(événements(avant.camille) + 1);
  });

  it('ne calcule le coût que pour les rôles qui ont accès au FinOps', async () => {
    const officer = await report(app, await loginAs(app, ACCOUNTS.aiOfficer));
    const standard = await report(app, await loginAs(app, ACCOUNTS.standard));

    expect(officer.monthlyCostEur).not.toBeNull();
    expect(standard.monthlyCostEur).toBeNull();
  });

  it('refuse une fenêtre hors bornes et se ferme aux visiteurs', async () => {
    const cookie = await loginAs(app, ACCOUNTS.standard);
    const trop = await app.inject({ method: 'GET', url: '/api/dashboard/bi?months=99', headers: { cookie } });
    expect(trop.statusCode).toBe(400);

    const anonyme = await app.inject({ method: 'GET', url: '/api/dashboard/bi' });
    expect(anonyme.statusCode).toBe(401);
  });

  it("compte les échéances de conformité qui approchent", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const target = one<{ id: number }>(
      app.db, "SELECT id FROM applications WHERE status = 'compliant' LIMIT 1",
    )!.id;
    // Échéance rapprochée à 10 jours : elle doit remonter dans l'alerte.
    app.db
      .prepare("UPDATE applications SET compliance_valid_until = datetime('now', '+10 days') WHERE id = ?")
      .run(target);

    const bi = await report(app, cookie);
    const ligne = bi.compliance.expiringSoon.find((row) => row.id === target);
    expect(ligne, "l'application doit apparaître dans les échéances proches").toBeTruthy();
    expect(ligne!.daysLeft).toBeGreaterThan(0);
    expect(ligne!.daysLeft).toBeLessThanOrEqual(11);

    // Une échéance lointaine sort de l'horizon des 90 jours.
    app.db
      .prepare("UPDATE applications SET compliance_valid_until = datetime('now', '+200 days') WHERE id = ?")
      .run(target);
    const loin = await report(app, cookie);
    expect(loin.compliance.expiringSoon.some((row) => row.id === target)).toBe(false);
  });

  it("résume l'activité de la plateforme sans exposer d'autre chose que des compteurs", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const avant = await report(app, cookie);

    const created = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      payload: { ...validApplication(app), name: 'Nouvel outil' },
    });
    expect(created.statusCode).toBe(201);

    const apres = await report(app, cookie);
    const total = (bi: BiReportDto) => bi.activity.byAction.reduce((sum, row) => sum + row.count, 0);
    expect(total(apres)).toBe(total(avant) + 1);
    expect(apres.activity.activeUsers).toBeGreaterThan(0);

    const creation = apres.activity.byAction.find((row) => row.key === 'create')!;
    expect(creation.label).toBe('Déclaration');
    expect(creation.share).toBeGreaterThan(0);
    expect(Object.keys(creation)).toEqual(['key', 'label', 'count', 'share']);
  });
});

describe('accès aux tableaux de bord', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('est ouvert à tous les rôles (dashboard:read)', async () => {
    for (const email of Object.values(ACCOUNTS)) {
      const cookie = await loginAs(app, email);
      const response = await app.inject({ method: 'GET', url: '/api/dashboard/bi', headers: { cookie } });
      expect(response.statusCode, email).toBe(200);
      // La fenêtre par défaut est de 12 mois.
      expect(response.json().report.months).toBe(12);
    }
    expect(userId(app, ACCOUNTS.standard)).toBeGreaterThan(0);
  });
});
