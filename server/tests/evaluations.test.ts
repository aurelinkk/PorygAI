/**
 * Fiche d'évaluation de conformité IA : scoring hybride (score + critères
 * éliminatoires), verdict automatique, plan d'action généré.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CRITICAL_QUESTIONS, MAX_SCORE, PASS_SCORE, QUESTIONS, scoreEvaluation,
  type ActionPlanDto, type AnswerValue, type ApplicationDto, type EvaluationDto,
} from '@poryg/shared';
import { all, one } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs } from './helpers.js';

/** Réponses parfaites : toutes les questions à « Oui ». */
const allYes = (): Record<string, AnswerValue> =>
  Object.fromEntries(QUESTIONS.map((question) => [question.code, 2 as AnswerValue]));

const PRELIMINARY = {
  toolVendor: 'Copilot — Microsoft',
  purpose: "Assistance à la rédaction des offres d'emploi.",
  businessCriticality: 'medium',
};

function appId(app: FastifyInstance, name: string): number {
  return one<{ id: number }>(app.db, 'SELECT id FROM applications WHERE name = ?', name)!.id;
}

// --- Le calcul, isolé --------------------------------------------------------

describe('scoring du questionnaire', () => {
  it('compte 9 questions pour 18 points, seuil à 14', () => {
    expect(QUESTIONS).toHaveLength(9);
    expect(MAX_SCORE).toBe(18);
    expect(PASS_SCORE).toBe(14);
    expect(CRITICAL_QUESTIONS.map((q) => q.code)).toEqual(['A1', 'A2', 'B1', 'C1']);
  });

  it('18/18 sans éliminatoire → conforme', () => {
    const result = scoreEvaluation(allYes());
    expect(result).toMatchObject({ score: 18, complete: true, redFlags: [], decision: 'compliant' });
    expect(result.toImprove).toEqual([]);
  });

  it('14/18 exactement → conforme (le seuil est inclusif)', () => {
    // 4 points en moins sur des questions NON éliminatoires : A3, B2, C2, D1 à 1 pt.
    const answers = { ...allYes(), A3: 1, B2: 1, C2: 1, D1: 1 } as Record<string, AnswerValue>;
    const result = scoreEvaluation(answers);
    expect(result.score).toBe(14);
    expect(result.decision).toBe('compliant');
  });

  it('13/18 → non conforme même sans éliminatoire', () => {
    const answers = { ...allYes(), A3: 1, B2: 1, C2: 1, D1: 1, D2: 1 } as Record<string, AnswerValue>;
    const result = scoreEvaluation(answers);
    expect(result.score).toBe(13);
    expect(result.redFlags).toEqual([]);
    expect(result.decision).toBe('non_compliant');
  });

  it('un seul éliminatoire à 0 fait basculer, malgré un score élevé', () => {
    // 16/18 mais B1 (transparence, éliminatoire) répondu « Non ».
    const answers = { ...allYes(), B1: 0 } as Record<string, AnswerValue>;
    const result = scoreEvaluation(answers);
    expect(result.score).toBe(16);
    expect(result.score).toBeGreaterThanOrEqual(PASS_SCORE);
    expect(result.redFlags).toEqual(['B1']);
    expect(result.decision).toBe('non_compliant');
  });

  it("un éliminatoire à 1 point (« Partiellement ») n'est pas un red flag", () => {
    const result = scoreEvaluation({ ...allYes(), B1: 1 } as Record<string, AnswerValue>);
    expect(result.redFlags).toEqual([]);
    expect(result.decision).toBe('compliant');
  });

  it('signale un questionnaire incomplet et liste les questions à améliorer', () => {
    const partial = scoreEvaluation({ A1: 2, A2: 1 });
    expect(partial.complete).toBe(false);
    expect(partial.toImprove).toEqual(['A2']);
  });
});

// --- Le parcours complet -----------------------------------------------------

describe('évaluation : parcours', () => {
  let app: FastifyInstance;
  let target: number;

  beforeEach(async () => {
    app = await createTestApp();
    target = appId(app, 'Chatbot Support'); // statut in_progress
  });
  afterEach(async () => {
    await app.close();
  });

  const submit = (cookie: string, answers: Record<string, AnswerValue>, id = target) =>
    app.inject({
      method: 'POST', url: `/api/applications/${id}/evaluation/submit`, headers: { cookie },
      payload: { ...PRELIMINARY, answers, comments: {} },
    });

  it('un auditeur soumet une évaluation réussie : application conforme + échéance à 12 mois', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await submit(cookie, allYes());

    expect(response.statusCode).toBe(200);
    const evaluation: EvaluationDto = response.json().evaluation;
    expect(evaluation).toMatchObject({ status: 'submitted', score: 18, decision: 'compliant', redFlags: [] });
    expect(evaluation.submittedBy?.displayName).toBe('Emma Bernard');

    const application: ApplicationDto = response.json().application;
    expect(application.status).toBe('compliant');
    expect(response.json().actionPlans).toEqual([]);

    // Échéance à +12 mois, ce qui alimentera le job d'expiration annuelle.
    const deadline = new Date(application.complianceValidUntil!);
    const expected = new Date(evaluation.submittedAt!);
    expected.setUTCMonth(expected.getUTCMonth() + 12);
    expect(deadline.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  });

  it('un échec génère le plan d’action, une action par question insuffisante', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    // B1 « Non » (éliminatoire) et C2 « Partiellement ».
    const response = await submit(cookie, { ...allYes(), B1: 0, C2: 1 } as Record<string, AnswerValue>);

    expect(response.statusCode).toBe(200);
    expect(response.json().evaluation).toMatchObject({ decision: 'non_compliant', redFlags: ['B1'] });
    expect(response.json().application.status).toBe('non_compliant');
    expect(response.json().application.complianceValidUntil).toBeNull();

    const plans: ActionPlanDto[] = response.json().actionPlans;
    expect(plans.map((plan) => plan.questionCode).sort()).toEqual(['B1', 'C2']);

    // Le texte de remédiation reprend littéralement l'exemple de la fiche d'évaluation.
    const transparency = plans.find((plan) => plan.questionCode === 'B1')!;
    expect(transparency.description).toBe(
      "Ajouter une mention légale visible sur l'interface de l'application indiquant que les résultats sont générés par intelligence artificielle, puis soumettre à nouveau.",
    );
    expect(transparency.status).toBe('open');
    expect(transparency.owner?.displayName).toBe('Camille Roux'); // Process Owner
    // Échéance plus courte pour un critère éliminatoire (90 j contre 180 j).
    const nonCritical = plans.find((plan) => plan.questionCode === 'C2')!;
    expect(transparency.dueDate! < nonCritical.dueDate!).toBe(true);
  });

  it('refuse une soumission incomplète ou sans informations préliminaires', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);

    const incomplete = await app.inject({
      method: 'POST', url: `/api/applications/${target}/evaluation/submit`, headers: { cookie },
      payload: { ...PRELIMINARY, answers: { A1: 2 }, comments: {} },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error.fields.answers).toBeDefined();

    const noPreliminary = await app.inject({
      method: 'POST', url: `/api/applications/${target}/evaluation/submit`, headers: { cookie },
      payload: { toolVendor: '', purpose: '', businessCriticality: null, answers: allYes(), comments: {} },
    });
    expect(noPreliminary.statusCode).toBe(400);
    expect(Object.keys(noPreliminary.json().error.fields).sort())
      .toEqual(['businessCriticality', 'purpose', 'toolVendor']);

    // Aucune évaluation soumise n'a été créée.
    expect(all(app.db, "SELECT 1 FROM evaluations WHERE status = 'submitted'")).toHaveLength(0);
    expect(one<{ status: string }>(app.db, 'SELECT status FROM applications WHERE id = ?', target)?.status)
      .toBe('in_progress');
  });

  it('le brouillon se sauvegarde puis se recharge, sans rendre de verdict', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);

    const saved = await app.inject({
      method: 'PUT', url: `/api/applications/${target}/evaluation`, headers: { cookie },
      payload: { toolVendor: 'Outil X', purpose: 'Essai', businessCriticality: 'low',
        answers: { A1: 2, A2: 1 }, comments: { A2: 'À confirmer avec le DPO' } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().evaluation).toMatchObject({ status: 'draft', score: null, decision: null });

    const reloaded = await app.inject({
      method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie },
    });
    expect(reloaded.json().draft.answers).toEqual({ A1: 2, A2: 1 });
    expect(reloaded.json().draft.comments.A2).toBe('À confirmer avec le DPO');
    expect(reloaded.json().history).toEqual([]);

    // Le statut de l'application n'a pas bougé.
    expect(one<{ status: string }>(app.db, 'SELECT status FROM applications WHERE id = ?', target)?.status)
      .toBe('in_progress');
  });

  it('un second enregistrement met à jour le même brouillon (pas de doublon)', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const body = (answers: Record<string, AnswerValue>) => ({
      method: 'PUT' as const, url: `/api/applications/${target}/evaluation`, headers: { cookie },
      payload: { ...PRELIMINARY, answers, comments: {} },
    });

    await app.inject(body({ A1: 2 }));
    await app.inject(body({ A1: 0, A2: 2 }));

    expect(all(app.db, 'SELECT 1 FROM evaluations WHERE application_id = ?', target)).toHaveLength(1);
    const reloaded = await app.inject({
      method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie },
    });
    expect(reloaded.json().draft.answers).toEqual({ A1: 0, A2: 2 });
  });

  it('une évaluation soumise est figée en base', async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    await submit(cookie, allYes());
    const evaluationId = one<{ id: number }>(app.db, "SELECT id FROM evaluations WHERE status = 'submitted'")!.id;

    expect(() => app.db.prepare('UPDATE evaluations SET score = 0 WHERE id = ?').run(evaluationId))
      .toThrow(/ne peut plus être modifiée/);
    expect(() => app.db.prepare('DELETE FROM evaluations WHERE id = ?').run(evaluationId))
      .toThrow(/Suppression physique interdite/);
  });

  it("une nouvelle soumission crée une nouvelle évaluation et conserve l'historique", async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    await submit(cookie, { ...allYes(), B1: 0 } as Record<string, AnswerValue>); // non conforme
    await submit(cookie, allYes()); // corrigée

    const response = await app.inject({
      method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie },
    });
    const history: EvaluationDto[] = response.json().history;
    expect(history).toHaveLength(2);
    expect(history[0]!.decision).toBe('compliant'); // la plus récente d'abord
    expect(history[1]!.decision).toBe('non_compliant');
    expect(response.json().draft).toBeNull();
  });
});

// --- Autorisations -----------------------------------------------------------

describe('évaluation : autorisations', () => {
  let app: FastifyInstance;
  let target: number;

  beforeEach(async () => {
    app = await createTestApp();
    target = appId(app, 'Chatbot Support');
  });
  afterEach(async () => {
    await app.close();
  });

  it("un utilisateur standard n'accède pas au questionnaire (403)", async () => {
    const cookie = await loginAs(app, ACCOUNTS.standard);
    expect((await app.inject({ method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie } }))
      .statusCode).toBe(403);
  });

  it('un Application Manager peut saisir mais pas soumettre', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);

    const read = await app.inject({ method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie } });
    expect(read.json().permissions).toEqual({ fill: true, submit: false });

    const save = await app.inject({
      method: 'PUT', url: `/api/applications/${target}/evaluation`, headers: { cookie },
      payload: { ...PRELIMINARY, answers: allYes(), comments: {} },
    });
    expect(save.statusCode).toBe(200);

    const submitted = await app.inject({
      method: 'POST', url: `/api/applications/${target}/evaluation/submit`, headers: { cookie },
      payload: { ...PRELIMINARY, answers: allYes(), comments: {} },
    });
    expect(submitted.statusCode).toBe(403);
  });

  it('le DPO consulte sans pouvoir saisir', async () => {
    const cookie = await loginAs(app, ACCOUNTS.dpo);
    const read = await app.inject({ method: 'GET', url: `/api/applications/${target}/evaluation`, headers: { cookie } });
    expect(read.statusCode).toBe(200);
    expect(read.json().permissions).toEqual({ fill: false, submit: false });

    const save = await app.inject({
      method: 'PUT', url: `/api/applications/${target}/evaluation`, headers: { cookie },
      payload: { ...PRELIMINARY, answers: allYes(), comments: {} },
    });
    expect(save.statusCode).toBe(403);
  });

  it("une application en brouillon ou supprimée ne s'évalue pas", async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);

    const draft = await app.inject({
      method: 'PUT', url: `/api/applications/${appId(app, 'Résumé de réunions')}/evaluation`, headers: { cookie },
      payload: { ...PRELIMINARY, answers: allYes(), comments: {} },
    });
    expect(draft.statusCode).toBe(400);
    expect(draft.json().error.message).toMatch(/envoyée à l'audit/);

    const deleted = await app.inject({
      method: 'PUT', url: `/api/applications/${appId(app, 'Prévision Stock v1')}/evaluation`, headers: { cookie },
      payload: { ...PRELIMINARY, answers: allYes(), comments: {} },
    });
    expect(deleted.statusCode).toBe(400);
  });
});

// --- Plans d'action ----------------------------------------------------------

describe("plans d'action", () => {
  let app: FastifyInstance;
  let planId: number;

  beforeEach(async () => {
    app = await createTestApp();
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    await app.inject({
      method: 'POST', url: `/api/applications/${appId(app, 'Chatbot Support')}/evaluation/submit`,
      headers: { cookie }, payload: { ...PRELIMINARY, answers: { ...allYes(), B1: 0 }, comments: {} },
    });
    planId = one<{ id: number }>(app.db, "SELECT id FROM action_plans WHERE question_code = 'B1'")!.id;
  });
  afterEach(async () => {
    await app.close();
  });

  it('le Process Owner coche puis décoche une action corrective', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);

    const done = await app.inject({
      method: 'POST', url: `/api/action-plans/${planId}/done`, headers: { cookie }, payload: { done: true },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().actionPlan).toMatchObject({ status: 'done' });
    expect(done.json().actionPlan.doneBy.displayName).toBe('Camille Roux');

    const reopened = await app.inject({
      method: 'POST', url: `/api/action-plans/${planId}/done`, headers: { cookie }, payload: { done: false },
    });
    expect(reopened.json().actionPlan).toMatchObject({ status: 'open', doneBy: null, doneAt: null });
  });

  it("un auditeur ne coche pas les actions (c'est au Process Owner de les exécuter)", async () => {
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await app.inject({
      method: 'POST', url: `/api/action-plans/${planId}/done`, headers: { cookie }, payload: { done: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it('une action inconnue renvoie 404', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const response = await app.inject({
      method: 'POST', url: '/api/action-plans/9999/done', headers: { cookie }, payload: { done: true },
    });
    expect(response.statusCode).toBe(404);
  });
});
