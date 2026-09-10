/**
 * Évaluations de conformité IA et plans d'action.
 *
 * Point clé : le score et le verdict sont calculés **par le serveur** à la
 * soumission (`scoreEvaluation` de @poryg/shared). Le client affiche le même
 * calcul en direct pour guider la saisie, mais il ne décide de rien.
 */
import {
  DECIDED_STATUSES, QUESTIONNAIRE_VERSION, getQuestion, scoreEvaluation, questionWording,
  type ActionPlanDto, type AnswerValue, type Answers, type EvaluationDto,
  type SaveEvaluationInput, type SectionScore, type UserDto, type Verdict,
} from '@poryg/shared';
import { recordAudit } from '../audit.js';
import { all, one, run, transaction, type Db } from '../db/connection.js';
import { nowIso } from '../lib/time.js';
import { complianceDeadline, getApplication } from './applications.repo.js';

interface EvaluationRow {
  id: number;
  application_id: number;
  questionnaire_version: string;
  status: 'draft' | 'submitted';
  tool_vendor: string;
  purpose: string;
  business_criticality: string | null;
  score: number | null;
  max_score: number;
  verdict: Verdict | null;
  capped_by_json: string;
  blocked_by: string | null;
  sections_json: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  submitted_by: number | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
}

const SELECT_EVALUATION = `
  SELECT e.*, creator.display_name AS created_by_name, submitter.display_name AS submitted_by_name
    FROM evaluations e
    LEFT JOIN users creator   ON creator.id   = e.created_by
    LEFT JOIN users submitter ON submitter.id = e.submitted_by
`;

function toDto(db: Db, row: EvaluationRow): EvaluationDto {
  const answerRows = all<{ question_code: string; value_json: string; comment: string }>(
    db, 'SELECT question_code, value_json, comment FROM evaluation_answers WHERE evaluation_id = ?', row.id,
  );

  const answers: Record<string, AnswerValue> = {};
  const comments: Record<string, string> = {};
  for (const answer of answerRows) {
    answers[answer.question_code] = JSON.parse(answer.value_json) as AnswerValue;
    if (answer.comment) comments[answer.question_code] = answer.comment;
  }

  return {
    id: row.id,
    applicationId: row.application_id,
    questionnaireVersion: row.questionnaire_version,
    status: row.status,
    toolVendor: row.tool_vendor,
    purpose: row.purpose,
    businessCriticality: row.business_criticality,
    answers,
    comments,
    score: row.score,
    maxScore: row.max_score,
    cappedBy: JSON.parse(row.capped_by_json) as string[],
    blockedBy: row.blocked_by,
    verdict: row.verdict,
    sections: JSON.parse(row.sections_json) as SectionScore[],
    createdBy: row.created_by && row.created_by_name ? { id: row.created_by, displayName: row.created_by_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedBy:
      row.submitted_by && row.submitted_by_name ? { id: row.submitted_by, displayName: row.submitted_by_name } : null,
    submittedAt: row.submitted_at,
  };
}

/** Évaluation en cours de saisie, s'il y en a une. */
export function getDraftEvaluation(db: Db, applicationId: number): EvaluationDto | null {
  const row = one<EvaluationRow>(
    db, `${SELECT_EVALUATION} WHERE e.application_id = ? AND e.status = 'draft'`, applicationId,
  );
  return row ? toDto(db, row) : null;
}

/** Toutes les évaluations d'une application, de la plus récente à la plus ancienne. */
export function listEvaluations(db: Db, applicationId: number): EvaluationDto[] {
  const rows = all<EvaluationRow>(db, `${SELECT_EVALUATION} WHERE e.application_id = ? ORDER BY e.id DESC`, applicationId);
  return rows.map((row) => toDto(db, row));
}

export function getEvaluation(db: Db, id: number): EvaluationDto | null {
  const row = one<EvaluationRow>(db, `${SELECT_EVALUATION} WHERE e.id = ?`, id);
  return row ? toDto(db, row) : null;
}

/**
 * Récupère le brouillon en cours, ou en crée un vide (toujours dans la version courante).
 *
 * Un brouillon commencé sous une version antérieure du questionnaire est réétiqueté
 * et vidé de ses réponses stockées. C'est sans conséquence pour l'utilisateur : le
 * formulaire renvoie toujours l'état complet, et ce qu'il a déjà saisi lui a été
 * rendu par la lecture précédente. Un brouillon n'est de toute façon pas une preuve
 * d'audit ; on garde la ligne pour ne pas créer de doublon.
 */
export function getOrCreateDraft(db: Db, applicationId: number, actor: UserDto): EvaluationDto {
  const existing = getDraftEvaluation(db, applicationId);
  if (existing && existing.questionnaireVersion === QUESTIONNAIRE_VERSION) return existing;
  if (existing) {
    run(db, 'DELETE FROM evaluation_answers WHERE evaluation_id = ?', existing.id);
    run(
      db,
      'UPDATE evaluations SET questionnaire_version = ?, max_score = 100, updated_at = ? WHERE id = ?',
      QUESTIONNAIRE_VERSION, nowIso(), existing.id,
    );
    return getEvaluation(db, existing.id)!;
  }

  const result = run(
    db,
    `INSERT INTO evaluations (application_id, questionnaire_version, status, max_score, created_by)
     VALUES (?, ?, 'draft', 100, ?)`,
    applicationId, QUESTIONNAIRE_VERSION, actor.id,
  );
  return getEvaluation(db, Number(result.lastInsertRowid))!;
}

/** Écrit les informations préliminaires et les réponses (remplacement complet). */
function writeEvaluationContent(db: Db, evaluationId: number, input: SaveEvaluationInput): void {
  run(
    db,
    `UPDATE evaluations SET tool_vendor = ?, purpose = ?, business_criticality = ?, updated_at = ? WHERE id = ?`,
    input.toolVendor, input.purpose, input.businessCriticality ?? null, nowIso(), evaluationId,
  );

  // Remplacement intégral : le formulaire envoie toujours l'état complet.
  run(db, 'DELETE FROM evaluation_answers WHERE evaluation_id = ?', evaluationId);
  for (const [code, value] of Object.entries(input.answers)) {
    if (!getQuestion(code)) continue; // ignore un code inconnu (questionnaire changé)
    run(
      db,
      'INSERT INTO evaluation_answers (evaluation_id, question_code, value_json, comment) VALUES (?, ?, ?, ?)',
      evaluationId, code, JSON.stringify(value), input.comments[code] ?? '',
    );
  }
}

/** Enregistre un brouillon, sans calculer de verdict. */
export function saveDraft(
  db: Db, applicationId: number, input: SaveEvaluationInput, actor: UserDto, ip?: string,
): EvaluationDto {
  return transaction(db, () => {
    const draft = getOrCreateDraft(db, applicationId, actor);
    writeEvaluationContent(db, draft.id, input);
    const saved = getEvaluation(db, draft.id)!;
    recordAudit(db, {
      actorId: actor.id, entity: 'application', entityId: applicationId, action: 'evaluation_saved', ip,
      after: { evaluationId: draft.id, answered: Object.keys(saved.answers).length },
    });
    return saved;
  });
}

export interface SubmitResult {
  evaluation: EvaluationDto;
  actionPlans: ActionPlanDto[];
}

/** Statut de l'application pour un verdict donné. */
function statusForVerdict(verdict: Verdict): 'compliant' | 'partially_compliant' | 'non_compliant' {
  if (verdict === 'compliant') return 'compliant';
  if (verdict === 'partially_compliant') return 'partially_compliant';
  return 'non_compliant';
}

/**
 * Soumet l'évaluation : calcule le score, fige l'évaluation, applique le verdict
 * à l'application et génère le plan d'action.
 *
 * Conforme (≥ 86)         → `compliant`, échéance à +12 mois (job d'expiration annuelle).
 * Partiel (61–85)         → `partially_compliant`, sans échéance : reste en test
 *                           jusqu'à une nouvelle évaluation. Plan d'action généré.
 * Non conforme / plafonné → `non_compliant`, plan d'action généré.
 * Refusée (blocage)       → `non_compliant`, une seule action : le motif du refus.
 */
export function submitEvaluation(
  db: Db, applicationId: number, input: SaveEvaluationInput, actor: UserDto, ip?: string,
): SubmitResult {
  return transaction(db, () => {
    const draft = getOrCreateDraft(db, applicationId, actor);
    writeEvaluationContent(db, draft.id, input);

    // Le calcul qui fait foi : celui du serveur, sur les réponses effectivement stockées.
    const stored = getEvaluation(db, draft.id)!;
    const result = scoreEvaluation(stored.answers as Answers);
    const submittedAt = nowIso();

    run(
      db,
      `UPDATE evaluations
          SET status = 'submitted', score = ?, verdict = ?, capped_by_json = ?, blocked_by = ?, sections_json = ?,
              submitted_by = ?, submitted_at = ?, updated_at = ?
        WHERE id = ?`,
      result.score, result.verdict, JSON.stringify(result.cappedBy), result.blockedBy, JSON.stringify(result.sections),
      actor.id, submittedAt, submittedAt, draft.id,
    );

    const applicationBefore = getApplication(db, applicationId)!;
    const status = statusForVerdict(result.verdict);
    run(
      db,
      `UPDATE applications SET status = ?, compliance_valid_until = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
      status, status === 'compliant' ? complianceDeadline(submittedAt) : null, actor.id, submittedAt, applicationId,
    );

    // Plan d'action : une action par recommandation, sauf si l'application est conforme.
    const actionPlans: ActionPlanDto[] = [];
    if (result.verdict === 'blocked') {
      const insert = run(
        db,
        `INSERT INTO action_plans (application_id, evaluation_id, question_code, title, description, owner_id, due_date)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        applicationId, draft.id, result.blockedBy,
        `${result.blockedBy} : évaluation refusée`,
        result.blockMessage ?? "L'application ne peut pas être déployée.",
        applicationBefore.processOwner.id,
      );
      actionPlans.push(getActionPlan(db, Number(insert.lastInsertRowid))!);
    } else if (result.verdict !== 'compliant') {
      for (const recommendation of result.recommendations) {
        const insert = run(
          db,
          `INSERT INTO action_plans (application_id, evaluation_id, question_code, title, description, owner_id, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          applicationId, draft.id, recommendation.code,
          `${recommendation.code} : ${questionWording(recommendation.code)}`,
          recommendation.remediation,
          applicationBefore.processOwner.id,
          // Échéance par défaut : 90 jours pour un critère critique, 180 sinon.
          addDays(submittedAt, recommendation.critical ? 90 : 180),
        );
        actionPlans.push(getActionPlan(db, Number(insert.lastInsertRowid))!);
      }
    }

    const evaluation = getEvaluation(db, draft.id)!;
    recordAudit(db, {
      actorId: actor.id, entity: 'application', entityId: applicationId, action: 'evaluation_submitted', ip,
      before: { status: applicationBefore.status },
      after: {
        status, score: result.score, maxScore: 100, verdict: result.verdict,
        cappedBy: result.cappedBy, blockedBy: result.blockedBy, evaluationId: draft.id,
      },
    });

    return { evaluation, actionPlans };
  });
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

// --- Plans d'action ---------------------------------------------------------

interface ActionPlanRow {
  id: number;
  application_id: number;
  evaluation_id: number | null;
  question_code: string | null;
  title: string;
  description: string;
  status: 'open' | 'done';
  owner_id: number | null;
  owner_name: string | null;
  due_date: string | null;
  created_at: string;
  done_by: number | null;
  done_by_name: string | null;
  done_at: string | null;
}

const SELECT_ACTION_PLAN = `
  SELECT p.*, owner.display_name AS owner_name, doer.display_name AS done_by_name
    FROM action_plans p
    LEFT JOIN users owner ON owner.id = p.owner_id
    LEFT JOIN users doer  ON doer.id  = p.done_by
`;

function toActionPlanDto(row: ActionPlanRow): ActionPlanDto {
  return {
    id: row.id,
    applicationId: row.application_id,
    evaluationId: row.evaluation_id,
    questionCode: row.question_code,
    title: row.title,
    description: row.description,
    status: row.status,
    owner: row.owner_id && row.owner_name ? { id: row.owner_id, displayName: row.owner_name } : null,
    dueDate: row.due_date,
    createdAt: row.created_at,
    doneBy: row.done_by && row.done_by_name ? { id: row.done_by, displayName: row.done_by_name } : null,
    doneAt: row.done_at,
  };
}

export function listActionPlans(db: Db, applicationId: number): ActionPlanDto[] {
  const rows = all<ActionPlanRow>(
    db,
    // Actions ouvertes d'abord, puis par échéance.
    `${SELECT_ACTION_PLAN} WHERE p.application_id = ? ORDER BY p.status = 'done', p.due_date, p.id`,
    applicationId,
  );
  return rows.map(toActionPlanDto);
}

export function getActionPlan(db: Db, id: number): ActionPlanDto | null {
  const row = one<ActionPlanRow>(db, `${SELECT_ACTION_PLAN} WHERE p.id = ?`, id);
  return row ? toActionPlanDto(row) : null;
}

/** Marque une action corrective comme terminée (ou la rouvre). */
/**
 * Coche (ou décoche) une action corrective.
 *
 * Cocher une action change la réalité de l'application : le motif qui avait fait
 * baisser le score n'est plus le même, le verdict rendu ne vaut plus. L'application
 * **repart donc en audit** (`in_progress`) et son échéance de conformité tombe ;
 * elle ne retrouvera un statut qu'après une nouvelle évaluation, préremplie avec
 * les réponses de la précédente.
 *
 * Décocher ne fait pas le chemin inverse : on ne peut pas deviner quel verdict
 * restaurer, et un verdict ne se rend que par une évaluation.
 */
export function setActionPlanDone(db: Db, id: number, done: boolean, actor: UserDto, ip?: string): ActionPlanDto {
  return transaction(db, () => {
    run(
      db,
      'UPDATE action_plans SET status = ?, done_by = ?, done_at = ? WHERE id = ?',
      done ? 'done' : 'open', done ? actor.id : null, done ? nowIso() : null, id,
    );
    const plan = getActionPlan(db, id)!;
    recordAudit(db, {
      actorId: actor.id, entity: 'application', entityId: plan.applicationId, action: 'action_plan_done', ip,
      after: { actionPlanId: id, questionCode: plan.questionCode, done },
    });

    const application = getApplication(db, plan.applicationId)!;
    if (done && DECIDED_STATUSES.includes(application.status)) {
      run(
        db,
        `UPDATE applications
            SET status = 'in_progress', compliance_valid_until = NULL, updated_by = ?, updated_at = ?
          WHERE id = ?`,
        actor.id, nowIso(), plan.applicationId,
      );
      recordAudit(db, {
        actorId: actor.id, entity: 'application', entityId: plan.applicationId,
        action: 'reevaluation_required', ip,
        before: { status: application.status, complianceValidUntil: application.complianceValidUntil },
        after: { status: 'in_progress', trigger: { actionPlanId: id, questionCode: plan.questionCode } },
      });
    }
    return plan;
  });
}
