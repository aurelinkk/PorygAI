/**
 * Routes FinOps.
 *
 *   GET /api/finops/report?months=6      rapport agrégé (phase « Inform »)
 *   GET /api/applications/:id/costs      coûts mensuels d'une application
 *   PUT /api/applications/:id/costs      saisit / corrige le coût d'un mois
 *
 * Comme ailleurs : la permission de rôle d'abord, puis la règle « propriétaire »
 * pour l'Application Manager (`canEditCosts`).
 */
import type { FastifyInstance } from 'fastify';
import { canEditCosts, finopsQuerySchema, saveCostSchema, type ApplicationDto, type UserDto } from '@poryg/shared';
import type { Db } from '../db/connection.js';
import { forbidden, notFound } from '../lib/http-errors.js';
import { validate } from '../lib/validate.js';
import { getApplication, isVisible } from './applications.repo.js';
import { buildApplicationFinops, buildFinopsReport, listApplicationCosts, saveCost } from './finops.repo.js';

export function registerFinopsRoutes(app: FastifyInstance, options: { db: Db }): void {
  const { db } = options;

  function loadVisible(user: UserDto, rawId: string): ApplicationDto {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Application introuvable');
    const application = getApplication(db, id);
    if (!application || !isVisible(db, user, id)) throw notFound('Application introuvable');
    return application;
  }

  app.get('/api/finops/report', { preHandler: app.requirePermission('finops:read') }, async (request) => {
    const { months } = validate(finopsQuerySchema, request.query);
    return { report: buildFinopsReport(db, request.user!, months) };
  });

  app.get<{ Params: { id: string } }>(
    '/api/applications/:id/finops',
    { preHandler: app.requirePermission('finops:read') },
    async (request) => {
      const user = request.user!;
      const application = loadVisible(user, request.params.id);
      const { months } = validate(finopsQuerySchema, request.query);
      return {
        report: buildApplicationFinops(db, user, application.id, months),
        permissions: { edit: canEditCosts(user, application) },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/applications/:id/costs',
    { preHandler: app.requirePermission('finops:read') },
    async (request) => {
      const user = request.user!;
      const application = loadVisible(user, request.params.id);
      return {
        costs: listApplicationCosts(db, application.id),
        permissions: { edit: canEditCosts(user, application) },
      };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/applications/:id/costs',
    { preHandler: app.requirePermission('finops:write') },
    async (request) => {
      const user = request.user!;
      const application = loadVisible(user, request.params.id);
      if (!canEditCosts(user, application)) {
        throw forbidden(
          application.status === 'deleted'
            ? "Une application supprimée n'accepte plus de saisie de coût"
            : 'Vous ne pouvez saisir des coûts que sur vos propres applications',
        );
      }
      const input = validate(saveCostSchema, request.body);
      return { cost: saveCost(db, application.id, input, user, request.ip) };
    },
  );
}
