/**
 * Routes de l'évaluation de conformité IA.
 *
 *   GET  /api/applications/:id/evaluation          brouillon en cours + historique + plans d'action
 *   PUT  /api/applications/:id/evaluation          enregistre le brouillon (pas de verdict)
 *   POST /api/applications/:id/evaluation/submit   soumet : score, verdict, plan d'action
 *   POST /api/action-plans/:id/done                marque une action corrective terminée / à refaire
 *
 * Le verdict est calculé par le serveur, jamais reçu du client.
 */
import type { FastifyInstance } from 'fastify';
import {
  DECIDED_STATUSES, can, saveEvaluationSchema, submitEvaluationSchema, scoreEvaluation,
  type ApplicationDto, type UserDto,
} from '@poryg/shared';
import { z } from 'zod';
import { one, type Db } from '../db/connection.js';
import { badRequest, forbidden, notFound } from '../lib/http-errors.js';
import { validate } from '../lib/validate.js';
import { getApplication, isVisible } from './applications.repo.js';
import {
  getDraftEvaluation, listActionPlans, listEvaluations, saveDraft, setActionPlanDone, submitEvaluation,
} from './evaluations.repo.js';
import { estimateFinopsImpact } from './finops.repo.js';

const doneSchema = z.object({ done: z.boolean() });

export function registerEvaluationsRoutes(app: FastifyInstance, options: { db: Db }): void {
  const { db } = options;

  function loadVisible(user: UserDto, rawId: string): ApplicationDto {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Application introuvable');
    const application = getApplication(db, id);
    if (!application || !isVisible(db, user, id)) throw notFound('Application introuvable');
    return application;
  }

  /** Une application supprimée ou encore en brouillon ne s'évalue pas. */
  /**
   * Une évaluation ne se saisit que sur une application **en cours d'audit**.
   *
   * Un verdict déjà rendu ne se rejoue pas à volonté : pour réévaluer, il faut
   * qu'un événement l'ait justifié : une action corrective cochée, l'expiration
   * annuelle de la conformité, ou une modification qui remet l'application en
   * audit. Tous ramènent le statut à `in_progress`.
   */
  const isEvaluable = (application: ApplicationDto): boolean =>
    application.status !== 'deleted'
    && application.status !== 'draft'
    && !DECIDED_STATUSES.includes(application.status);

  function assertEvaluable(application: ApplicationDto): void {
    if (application.status === 'deleted') throw badRequest("Une application supprimée ne peut pas être évaluée");
    if (application.status === 'draft') {
      throw badRequest("Cette application doit d'abord être envoyée à l'audit avant d'être évaluée");
    }
    if (DECIDED_STATUSES.includes(application.status)) {
      throw badRequest(
        "Cette application a déjà reçu un verdict. Terminez une action de son plan d'action pour la remettre "
        + 'en audit et la réévaluer.',
      );
    }
  }

  app.get<{ Params: { id: string } }>(
    '/api/applications/:id/evaluation',
    { preHandler: app.requirePermission('evaluation:read') },
    async (request) => {
      const user = request.user!;
      const application = loadVisible(user, request.params.id);
      return {
        draft: getDraftEvaluation(db, application.id),
        history: listEvaluations(db, application.id).filter((evaluation) => evaluation.status === 'submitted'),
        actionPlans: listActionPlans(db, application.id),
        // Annoncé à la fin du questionnaire. `null` sans `finops:read` : on ne
        // calcule pas une donnée pour la masquer ensuite côté client.
        finopsImpact: can(user.role, 'finops:read') ? estimateFinopsImpact(db, application.id) : null,
        // Le client masque ce que le serveur refuserait : mêmes conditions des deux côtés.
        permissions: {
          fill: app.hasPermission(user, 'evaluation:fill') && isEvaluable(application),
          submit: app.hasPermission(user, 'evaluation:decide') && isEvaluable(application),
        },
      };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/applications/:id/evaluation',
    { preHandler: app.requirePermission('evaluation:fill') },
    async (request) => {
      const application = loadVisible(request.user!, request.params.id);
      assertEvaluable(application);
      const input = validate(saveEvaluationSchema, request.body);
      return { evaluation: saveDraft(db, application.id, input, request.user!, request.ip) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/applications/:id/evaluation/submit',
    { preHandler: app.requirePermission('evaluation:decide') },
    async (request) => {
      const application = loadVisible(request.user!, request.params.id);
      assertEvaluable(application);

      // À la soumission, les informations préliminaires deviennent obligatoires…
      const input = validate(submitEvaluationSchema, request.body);

      // … et toutes les questions applicables au parcours doivent avoir une réponse.
      // Un blocage (domaine militaire, pratique interdite) se soumet tel quel : il
      // n'y a plus rien à répondre après lui.
      const preview = scoreEvaluation(input.answers);
      if (!preview.complete && preview.verdict !== 'blocked') {
        throw badRequest('Toutes les questions doivent recevoir une réponse avant la soumission', {
          answers: `Questionnaire incomplet : ${preview.missing.length} question(s) sans réponse`,
        });
      }

      const { evaluation, actionPlans } = submitEvaluation(db, application.id, input, request.user!, request.ip);
      return { evaluation, actionPlans, application: getApplication(db, application.id) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/action-plans/:id/done',
    { preHandler: app.requirePermission('action_plan:execute') },
    async (request) => {
      const id = Number(request.params.id);
      const plan = Number.isInteger(id) ? one<{ application_id: number }>(
        db, 'SELECT application_id FROM action_plans WHERE id = ?', id,
      ) : undefined;
      if (!plan) throw notFound('Action corrective introuvable');

      // Même règle de visibilité que l'application porteuse.
      if (!isVisible(db, request.user!, plan.application_id)) throw notFound('Action corrective introuvable');

      const application = getApplication(db, plan.application_id)!;
      if (application.status === 'deleted') throw forbidden('Application supprimée');

      const { done } = validate(doneSchema, request.body);
      return { actionPlan: setActionPlanDone(db, id, done, request.user!, request.ip) };
    },
  );
}
