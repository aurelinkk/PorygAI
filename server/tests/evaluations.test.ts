/**
 * Questionnaire v2 : cadrage dynamique, score sur 100, plafonds, blocages,
 * verdict à trois niveaux, recommandations et plan d'action.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMPLIANT_MIN, CRITICAL_CAP, PARTIAL_MIN, QUESTIONNAIRE_VERSION, QUESTIONS, applicableQuestions, applicableSections,
  scoreEvaluation, verdictFor, type Answers, type ApplicationDto, type EvaluationDto, type ActionPlanDto,
} from '@poryg/shared';
import { all, one } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs } from './helpers.js';

// --- Aides -------------------------------------------------------------------

/** Cadrage « chatbot client GenAI, données perso, API tierce, UE » — un parcours médian. */
const FRAMING: Answers = { C1: ['eu'], C2: 'no', C3: ['none'], C4: 'yes', C5: 'both', C6: 'api' };

/**
 * Répond à toutes les questions notées applicables au niveau demandé (2 = Oui).
 * Itère jusqu'à stabilité : une réponse peut en faire apparaître une autre
 * (D1 à « Non » révèle D3, l'AIPD).
 */
function answerAll(framing: Answers, level: '0' | '1' | '2' = '2', overrides: Answers = {}): Answers {
  const answers: Answers = { ...framing, ...overrides };
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of applicableQuestions(answers)) {
      if (question.weight === undefined || answers[question.code] !== undefined) continue;
      answers[question.code] = level;
      changed = true;
    }
  }
  return answers;
}

const PRELIMINARY = {
  toolVendor: 'Copilot — Microsoft',
  purpose: "Assistance à la rédaction des offres d'emploi.",
  businessCriticality: 'medium',
};

function appId(app: FastifyInstance, name: string): number {
  return one<{ id: number }>(app.db, 'SELECT id FROM applications WHERE name = ?', name)!.id;
}

// --- Définition du questionnaire ---------------------------------------------

describe('questionnaire v2 : définition', () => {
  it('a des codes uniques et des poids valides', () => {
    const codes = QUESTIONS.map((q) => q.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const question of QUESTIONS) {
      if (question.weight !== undefined) expect([1, 2, 4]).toContain(question.weight);
      if (question.critical) expect(question.weight).toBe(4);
      if (question.weight !== undefined) expect(question.remediation, question.code).toBeTruthy();
    }
  });

  it('reprend les neuf questions de la v1', () => {
    const legacy = QUESTIONS.filter((q) => q.legacy).map((q) => q.legacy).sort();
    expect(legacy).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2']);
  });

  it('le cadrage oriente le parcours', () => {
    const minimal = applicableQuestions({ C1: ['eu'], C2: 'no', C3: ['none'], C4: 'no', C5: 'none', C6: 'internal' });
    const maximal = applicableQuestions({
      C1: ['eu', 'us', 'cn'], C2: 'no', C3: ['employment', 'health'], C4: 'yes', C5: 'both', C6: 'api',
    });
    expect(minimal.length).toBeLessThan(maximal.length);

    // Sans données personnelles, aucune question RGPD/PIPL.
    const minimalCodes = minimal.map((q) => q.code);
    expect(minimalCodes).not.toContain('D1');
    expect(minimalCodes).not.toContain('UE5');
    // Sans déploiement aux États-Unis ni en Chine, pas de bloc correspondant.
    expect(minimalCodes.some((c) => c.startsWith('US'))).toBe(false);
    expect(minimalCodes.some((c) => c.startsWith('CN'))).toBe(false);

    const maximalCodes = maximal.map((q) => q.code);
    expect(maximalCodes).toContain('US1'); // emploi aux États-Unis
    expect(maximalCodes).toContain('US3'); // santé aux États-Unis
    expect(maximalCodes).toContain('UE3'); // haut risque dans l'UE
    expect(maximalCodes).toContain('CN4'); // données perso en Chine
    expect(maximalCodes).toContain('S2'); // recours, domaine à fort enjeu
  });

  it("n'affiche que les sections utiles", () => {
    const sections = applicableSections({ C1: ['us'], C2: 'no', C3: ['none'], C4: 'no', C5: 'none', C6: 'internal' });
    const codes = sections.map((s) => s.code);
    expect(codes).toContain('framing');
    expect(codes).toContain('US');
    expect(codes).not.toContain('UE');
    expect(codes).not.toContain('CN');
  });

  it('les biais : section propre, questions conditionnées au parcours', () => {
    // Parcours minimal : ni domaine sensible, ni IA générative, modèle interne.
    const minimal: Answers = { C1: ['other'], C2: 'no', C3: ['none'], C4: 'no', C5: 'none', C6: 'internal' };
    const codes = applicableQuestions(minimal).map((q) => q.code);
    expect(applicableSections(minimal).map((s) => s.code)).toContain('BI');
    expect(codes).toEqual(expect.arrayContaining(['BI2', 'BI3', 'BI6', 'BI7', 'BI8']));
    expect(codes).not.toContain('BI1'); // analyse des données : domaines à fort enjeu
    expect(codes).not.toContain('BI4'); // ancrage du prompt : IA générative
    expect(codes).not.toContain('BI5'); // effet de halo : fort enjeu ou contenu généré

    // API tierce : nous n'annotons pas les données d'apprentissage.
    const viaApi = applicableQuestions({ ...minimal, C6: 'api' }).map((q) => q.code);
    expect(viaApi).not.toContain('BI2');

    // Recrutement + assistant génératif : toute la section s'applique.
    const complet = applicableQuestions({ ...minimal, C3: ['employment'], C5: 'both' }).map((q) => q.code);
    expect(complet).toEqual(expect.arrayContaining(['BI1', 'BI2', 'BI3', 'BI4', 'BI5', 'BI6', 'BI7', 'BI8']));
  });

  it("l'analyse des biais dans les données est critique en domaine à fort enjeu", () => {
    const answers = answerAll({ ...FRAMING, C3: ['employment'] }, '2', { BI1: '0' });
    const result = scoreEvaluation(answers);
    expect(result.cappedBy).toEqual(['BI1']);
    expect(result.score).toBe(CRITICAL_CAP);
    expect(result.verdict).toBe('non_compliant');
    expect(result.recommendations[0]).toMatchObject({ code: 'BI1', section: 'BI', pointsRecoverable: 4 });
  });

  it("l'AIPD n'apparaît qu'en cas de risque élevé", () => {
    const sansRisque = applicableQuestions({ ...FRAMING, D1: '2' }).map((q) => q.code);
    expect(sansRisque).not.toContain('D3');
    const donneesSensibles = applicableQuestions({ ...FRAMING, D1: '0' }).map((q) => q.code);
    expect(donneesSensibles).toContain('D3');
    const domaineCritique = applicableQuestions({ ...FRAMING, C3: ['health'], D1: '2' }).map((q) => q.code);
    expect(domaineCritique).toContain('D3');
  });
});

// --- Calcul du score -----------------------------------------------------------

describe('questionnaire v2 : scoring', () => {
  it('tout « Oui » → 100, conforme, aucune recommandation', () => {
    const result = scoreEvaluation(answerAll(FRAMING));
    expect(result).toMatchObject({ score: 100, verdict: 'compliant', complete: true, cappedBy: [], blockedBy: null });
    expect(result.recommendations).toEqual([]);
    expect(result.pointsObtained).toBe(result.pointsApplicable);
  });

  it('les seuils : 86 conforme, 61 à 85 partiel, 60 et moins non conforme', () => {
    expect(verdictFor(100, [])).toBe('compliant');
    expect(verdictFor(COMPLIANT_MIN, [])).toBe('compliant');
    expect(verdictFor(COMPLIANT_MIN - 1, [])).toBe('partially_compliant');
    expect(verdictFor(PARTIAL_MIN, [])).toBe('partially_compliant');
    expect(verdictFor(PARTIAL_MIN - 1, [])).toBe('non_compliant');
    expect(verdictFor(0, [])).toBe('non_compliant');
  });

  it('une question critique à « Non » plafonne le score à 60', () => {
    const result = scoreEvaluation(answerAll(FRAMING, '2', { D1: '0' }));
    expect(result.cappedBy).toEqual(['D1']);
    expect(result.score).toBe(CRITICAL_CAP);
    expect(result.verdict).toBe('non_compliant');
    // Sans le plafond, le score brut serait bien plus haut : l'information est conservée.
    expect(result.pointsObtained / result.pointsApplicable).toBeGreaterThan(0.9);
  });

  it('un « Partiellement » sur une critique ne plafonne pas', () => {
    const result = scoreEvaluation(answerAll(FRAMING, '2', { D1: '1' }));
    expect(result.cappedBy).toEqual([]);
    expect(result.verdict).toBe('compliant');
  });

  it('des réponses partielles donnent un verdict partiel', () => {
    const partial = answerAll(FRAMING, '2', {
      N2: '1', N3: '1', N4: '1', N5: '1', N6: '1', N7: '1',
      D2: '1', T2: '1', S3: '1', S4: '1', F1: '1', F2: '1', F3: '1', F4: '1', F5: '1',
    });
    const result = scoreEvaluation(partial);
    expect(result.score).toBeGreaterThanOrEqual(PARTIAL_MIN);
    expect(result.score).toBeLessThan(COMPLIANT_MIN);
    expect(result.verdict).toBe('partially_compliant');
  });

  it('tout « Non » → non conforme, toutes les critiques en plafond', () => {
    const result = scoreEvaluation(answerAll(FRAMING, '0'));
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('non_compliant');
    expect(result.cappedBy).toEqual(expect.arrayContaining(['N1', 'D1', 'D4', 'T1', 'S1']));
  });

  it('le domaine militaire bloque, sans score', () => {
    const result = scoreEvaluation(answerAll({ ...FRAMING, C2: 'yes' }));
    expect(result.verdict).toBe('blocked');
    expect(result.blockedBy).toBe('C2');
    expect(result.blockMessage).toMatch(/militaire/);
    expect(result.score).toBeNull();
  });

  it("une pratique interdite par l'AI Act bloque, mais seulement si déployé dans l'UE", () => {
    const eu = scoreEvaluation(answerAll(FRAMING, '2', { UE1: 'yes' }));
    expect(eu.verdict).toBe('blocked');
    expect(eu.blockedBy).toBe('UE1');

    const usOnly = scoreEvaluation(answerAll({ ...FRAMING, C1: ['us'] }, '2', { UE1: 'yes' }));
    expect(usOnly.verdict).not.toBe('blocked'); // UE1 n'est pas applicable
  });

  it('classe les recommandations : critiques d’abord, puis par points récupérables', () => {
    const result = scoreEvaluation(answerAll(FRAMING, '2', { D1: '0', N2: '1', F4: '0', S3: '0' }));
    const codes = result.recommendations.map((r) => r.code);
    expect(codes[0]).toBe('D1'); // critique
    // Ensuite S3 (2 pts) avant N2 (1 pt) et F4 (1 pt).
    expect(codes.indexOf('S3')).toBeLessThan(codes.indexOf('N2'));
    const d1 = result.recommendations.find((r) => r.code === 'D1')!;
    expect(d1.pointsRecoverable).toBe(4);
    expect(d1.critical).toBe(true);
    expect(d1.remediation).toMatch(/DPO/);
  });

  it('utilité et ROI : le bloc « nécessité » est posé sur tous les parcours', () => {
    const minimal: Answers = { C1: ['other'], C2: 'no', C3: ['none'], C4: 'no', C5: 'none', C6: 'internal' };
    const codes = applicableQuestions(minimal).map((q) => q.code);
    expect(codes).toEqual(expect.arrayContaining(['N1', 'N4', 'N5', 'N6', 'N7']));
    // N6 (ROI) coûte des points s'il n'est pas estimé, et propose une action chiffrée.
    const sansRoi = scoreEvaluation(answerAll(minimal, '2', { N6: '0' }));
    const reco = sansRoi.recommendations.find((r) => r.code === 'N6')!;
    expect(reco.pointsRecoverable).toBe(2);
    expect(reco.remediation).toMatch(/FinOps/);
  });

  it('le score est un pourcentage des points applicables, pas un total de points', () => {
    // Le formulaire affiche « 4 pt » sur N1 : sur un parcours court, ces 4 points
    // pèsent bien plus de 4 au score. Les deux unités ne doivent jamais être confondues.
    const minimal: Answers = { C1: ['other'], C2: 'no', C3: ['none'], C4: 'no', C5: 'none', C6: 'internal' };
    const result = scoreEvaluation({ ...minimal, N1: '2' });
    expect(result.pointsObtained).toBe(4);
    expect(result.score).toBe(Math.round((4 / result.pointsApplicable) * 100));
    expect(result.score).toBeGreaterThan(4);
  });

  it('signale les questions sans réponse et estime la durée', () => {
    const result = scoreEvaluation({ ...FRAMING, N1: '2' });
    expect(result.complete).toBe(false);
    expect(result.missing).toContain('N2');
    expect(result.missing).not.toContain('N1');
    expect(result.missing).not.toContain('C1');
    expect(result.estimatedMinutes).toBeGreaterThan(5);
  });

  it('calcule un sous-score par section, dont un par pays', () => {
    const result = scoreEvaluation(answerAll({ ...FRAMING, C1: ['eu', 'us'] }, '2', { UE2: '0', US6: '1' }));
    const ue = result.sections.find((s) => s.code === 'UE')!;
    const us = result.sections.find((s) => s.code === 'US')!;
    expect(ue.score).toBeLessThan(100);
    expect(us.score).toBeLessThan(100);
    expect(ue.pointsObtained).toBe(ue.pointsApplicable - 2);
    expect(result.sections.find((s) => s.code === 'N')!.score).toBe(100);
    expect(result.sections.some((s) => s.code === 'CN')).toBe(false);
  });
});

// --- Parcours complet ------------------------------------------------------------

describe('évaluation v2 : parcours', () => {
  let app: FastifyInstance;
  let target: number;

  beforeEach(async () => {
    app = await createTestApp();
    target = appId(app, 'Chatbot Support'); // in_progress, Process Owner : Camille
  });
  afterEach(async () => {
    await app.close();
  });

  const submit = (cookie: string, answers: Answers, id = target) =>
    app.inject({
      method: 'POST', url: `/api/applications/${id}/evaluation/submit`, headers: { cookie },
      payload: { ...PRELIMINARY, answers, comments: {} },
    });

  it('conforme : statut compliant et échéance à 12 mois, aucun plan', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await submit(cookie, answerAll(FRAMING));
    expect(response.statusCode).toBe(200);

    const evaluation: EvaluationDto = response.json().evaluation;
    expect(evaluation).toMatchObject({
      status: 'submitted', questionnaireVersion: QUESTIONNAIRE_VERSION, score: 100, maxScore: 100,
      verdict: 'compliant', cappedBy: [],
    });
    expect(evaluation.sections.length).toBeGreaterThan(5);

    const application: ApplicationDto = response.json().application;
    expect(application.status).toBe('compliant');
    const deadline = new Date(application.complianceValidUntil!);
    const expected = new Date(evaluation.submittedAt!);
    expected.setUTCMonth(expected.getUTCMonth() + 12);
    expect(deadline.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
    expect(response.json().actionPlans).toEqual([]);
  });

  it('partiellement conforme : statut dédié, SANS échéance, plan d’action généré', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const partial = answerAll(FRAMING, '2', {
      N2: '1', N3: '1', N4: '1', N5: '1', N6: '1', N7: '1',
      D2: '1', T2: '1', S3: '1', S4: '1', F1: '1', F2: '1', F3: '1', F4: '1', F5: '1',
    });
    const response = await submit(cookie, partial);
    expect(response.statusCode).toBe(200);
    expect(response.json().evaluation.verdict).toBe('partially_compliant');

    const application: ApplicationDto = response.json().application;
    expect(application.status).toBe('partially_compliant');
    expect(application.complianceValidUntil).toBeNull(); // pas de délai : reste en test jusqu'à réévaluation

    const plans: ActionPlanDto[] = response.json().actionPlans;
    expect(plans.length).toBe(15); // une action par réponse « Partiellement »
    expect(plans.every((plan) => plan.owner?.displayName === 'Camille Roux')).toBe(true);
  });

  it('plafonné par une critique : non conforme, plan avec échéance courte pour la critique', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await submit(cookie, answerAll(FRAMING, '2', { T1: '0', F4: '1' }));

    expect(response.json().evaluation).toMatchObject({ verdict: 'non_compliant', score: 60, cappedBy: ['T1'] });
    expect(response.json().application.status).toBe('non_compliant');

    const plans: ActionPlanDto[] = response.json().actionPlans;
    const t1 = plans.find((plan) => plan.questionCode === 'T1')!;
    const f4 = plans.find((plan) => plan.questionCode === 'F4')!;
    expect(t1.description).toMatch(/mention légale visible/); // texte de la fiche de référence conservé
    expect(t1.dueDate! < f4.dueDate!).toBe(true); // 90 jours contre 180
  });

  it("refusée (domaine militaire) : non conforme, score nul, une action portant le motif", async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    // Un blocage se soumet même si le reste n'est pas rempli.
    const response = await submit(cookie, { ...FRAMING, C2: 'yes' });
    expect(response.statusCode).toBe(200);
    expect(response.json().evaluation).toMatchObject({ verdict: 'blocked', score: null, blockedBy: 'C2' });
    expect(response.json().application.status).toBe('non_compliant');

    const plans: ActionPlanDto[] = response.json().actionPlans;
    expect(plans).toHaveLength(1);
    expect(plans[0]!.description).toMatch(/hors périmètre/);
  });

  it('refuse une soumission incomplète, en disant combien il manque', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await submit(cookie, { ...FRAMING, N1: '2' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.answers).toMatch(/question\(s\) sans réponse/);
    expect(all(app.db, "SELECT 1 FROM evaluations WHERE status = 'submitted'")).toHaveLength(0);
  });

  it('le brouillon conserve tous les types de réponse', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const saved = await app.inject({
      method: 'PUT', url: `/api/applications/${target}/evaluation`, headers: { cookie },
      payload: {
        toolVendor: 'X', purpose: 'Essai', businessCriticality: 'low',
        answers: { C1: ['eu', 'cn'], C2: 'no', C4: 'yes', N1: '1', F3: '2' },
        comments: { N1: 'Comparaison en cours' },
      },
    });
    expect(saved.statusCode).toBe(200);

    const reloaded = await app.inject({ method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie } });
    const draft: EvaluationDto = reloaded.json().draft;
    expect(draft.answers).toEqual({ C1: ['eu', 'cn'], C2: 'no', C4: 'yes', N1: '1', F3: '2' });
    expect(draft.comments.N1).toBe('Comparaison en cours');
    expect(draft.verdict).toBeNull();
  });

  it('une évaluation soumise est figée et une nouvelle en crée une autre', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    await submit(cookie, answerAll(FRAMING, '2', { D1: '0' }));
    const first = one<{ id: number }>(app.db, "SELECT id FROM evaluations WHERE status = 'submitted'")!.id;
    expect(() => app.db.prepare('UPDATE evaluations SET score = 99 WHERE id = ?').run(first)).toThrow(/ne peut plus/);

    await submit(cookie, answerAll(FRAMING));
    const history = (await app.inject({
      method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie },
    })).json().history as EvaluationDto[];
    expect(history.map((e) => e.verdict)).toEqual(['compliant', 'non_compliant']);
  });

  it('modifier un champ évalué d’une application partiellement conforme la remet en audit', async () => {
    const auditor = await loginAs(app, ACCOUNTS.auditor);
    await submit(auditor, answerAll(FRAMING, '2', {
      N2: '1', N3: '1', N4: '1', N5: '1', N6: '1', N7: '1',
      D2: '1', T2: '1', S3: '1', S4: '1', F1: '1', F2: '1', F3: '1', F4: '1', F5: '1',
    }));
    expect(one<{ status: string }>(app.db, 'SELECT status FROM applications WHERE id = ?', target)?.status)
      .toBe('partially_compliant');

    const officer = await loginAs(app, ACCOUNTS.aiOfficer);
    const response = await app.inject({
      method: 'PUT', url: `/api/applications/${target}`, headers: { cookie: officer },
      payload: {
        name: 'Chatbot Support', description: 'idem', businessDomain: 'client',
        dataSensitivity: 'sensitive', aiType: 'genai',
        processOwnerId: one<{ id: number }>(app.db, 'SELECT id FROM users WHERE email = ?', ACCOUNTS.appManager)!.id,
      },
    });
    expect(response.json().reevaluationTriggered).toBe(true);
    expect(response.json().application.status).toBe('in_progress');
  });
});

// --- Autorisations (inchangées) --------------------------------------------------

describe('évaluation v2 : autorisations', () => {
  let app: FastifyInstance;
  let target: number;

  beforeEach(async () => {
    app = await createTestApp();
    target = appId(app, 'Chatbot Support');
  });
  afterEach(async () => {
    await app.close();
  });

  it('un Application Manager saisit mais ne soumet pas ; le DPO consulte ; le standard est exclu', async () => {
    const manager = await loginAs(app, ACCOUNTS.appManager);
    expect((await app.inject({
      method: 'POST', url: `/api/applications/${target}/evaluation/submit`, headers: { cookie: manager },
      payload: { ...PRELIMINARY, answers: answerAll(FRAMING), comments: {} },
    })).statusCode).toBe(403);

    const dpo = await loginAs(app, ACCOUNTS.dpo);
    const read = await app.inject({ method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie: dpo } });
    expect(read.json().permissions).toEqual({ fill: false, submit: false });

    const standard = await loginAs(app, ACCOUNTS.standard);
    expect((await app.inject({ method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie: standard } }))
      .statusCode).toBe(403);
  });

  it("une application en brouillon ou supprimée ne s'évalue pas", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    for (const name of ['Résumé de réunions', 'Prévision Stock v1']) {
      const response = await app.inject({
        method: 'PUT', url: `/api/applications/${appId(app, name)}/evaluation`, headers: { cookie },
        payload: { ...PRELIMINARY, answers: FRAMING, comments: {} },
      });
      expect(response.statusCode, name).toBe(400);
    }
  });
});

// --- Plans d'action ----------------------------------------------------------------

describe("plans d'action v2", () => {
  let app: FastifyInstance;
  let planId: number;

  beforeEach(async () => {
    app = await createTestApp();
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    await app.inject({
      method: 'POST', url: `/api/applications/${appId(app, 'Chatbot Support')}/evaluation/submit`,
      headers: { cookie }, payload: { ...PRELIMINARY, answers: answerAll(FRAMING, '2', { T1: '0' }), comments: {} },
    });
    planId = one<{ id: number }>(app.db, "SELECT id FROM action_plans WHERE question_code = 'T1'")!.id;
  });
  afterEach(async () => {
    await app.close();
  });

  it('le Process Owner coche puis décoche ; un auditeur ne peut pas', async () => {
    const manager = await loginAs(app, ACCOUNTS.appManager);
    const done = await app.inject({
      method: 'POST', url: `/api/action-plans/${planId}/done`, headers: { cookie: manager }, payload: { done: true },
    });
    expect(done.json().actionPlan).toMatchObject({ status: 'done' });
    expect(done.json().actionPlan.doneBy.displayName).toBe('Camille Roux');

    const reopened = await app.inject({
      method: 'POST', url: `/api/action-plans/${planId}/done`, headers: { cookie: manager }, payload: { done: false },
    });
    expect(reopened.json().actionPlan).toMatchObject({ status: 'open', doneBy: null });

    const auditor = await loginAs(app, ACCOUNTS.auditor);
    expect((await app.inject({
      method: 'POST', url: `/api/action-plans/${planId}/done`, headers: { cookie: auditor }, payload: { done: true },
    })).statusCode).toBe(403);
  });
});

// --- Compatibilité avec la v1 -----------------------------------------------------

describe('évaluation v2 : héritage v1', () => {
  let app: FastifyInstance;
  let target: number;

  beforeEach(async () => {
    app = await createTestApp();
    target = appId(app, 'Chatbot Support');
  });
  afterEach(async () => {
    await app.close();
  });

  it('un brouillon v1 est converti en v2 sans doublon, ses anciennes réponses écartées', async () => {
    // Simule un brouillon laissé par l'ancien questionnaire.
    app.db.prepare(
      "INSERT INTO evaluations (application_id, questionnaire_version, status, max_score) VALUES (?, 'v1', 'draft', 18)",
    ).run(target);
    const draftId = one<{ id: number }>(app.db, 'SELECT id FROM evaluations WHERE application_id = ?', target)!.id;
    app.db.prepare("INSERT INTO evaluation_answers (evaluation_id, question_code, value_json) VALUES (?, 'A1', '2')").run(draftId);

    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const saved = await app.inject({
      method: 'PUT', url: `/api/applications/${target}/evaluation`, headers: { cookie },
      payload: { ...PRELIMINARY, answers: { C1: ['eu'], C2: 'no' }, comments: {} },
    });
    expect(saved.statusCode).toBe(200);

    const draft: EvaluationDto = saved.json().evaluation;
    expect(draft.id).toBe(draftId); // même ligne, pas de doublon
    expect(draft.questionnaireVersion).toBe(QUESTIONNAIRE_VERSION);
    expect(draft.maxScore).toBe(100);
    expect(draft.answers).toEqual({ C1: ['eu'], C2: 'no' }); // A1 a disparu
    expect(all(app.db, 'SELECT 1 FROM evaluations WHERE application_id = ?', target)).toHaveLength(1);
  });

  it("une évaluation v1 soumise reste lisible avec son barème d'origine", async () => {
    app.db.prepare(
      `INSERT INTO evaluations (application_id, questionnaire_version, status, max_score, score, verdict, capped_by_json, submitted_at)
       VALUES (?, 'v1', 'submitted', 18, 16, 'non_compliant', '["B1"]', '2026-09-01T10:00:00.000Z')`,
    ).run(target);

    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await app.inject({ method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie } });
    const history: EvaluationDto[] = response.json().history;
    expect(history[0]).toMatchObject({
      questionnaireVersion: 'v1', score: 16, maxScore: 18, verdict: 'non_compliant', cappedBy: ['B1'], blockedBy: null,
    });
  });
});
