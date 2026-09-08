/**
 * Routes de l'inventaire des applications IA.
 *   GET  /api/applications       liste visible par l'utilisateur
 *   GET  /api/applications/:id   détail
 *   POST /api/applications       déclaration (→ statut draft)
 */
import type { FastifyInstance } from 'fastify';
import { createApplicationSchema } from '@poryg/shared';
import { one, type Db } from '../db/connection.js';
import { badRequest, notFound } from '../lib/http-errors.js';
import { validate } from '../lib/validate.js';
import { createApplication, getApplication, listApplications, visibilityClause } from './applications.repo.js';

export function registerApplicationsRoutes(app: FastifyInstance, options: { db: Db }): void {
  const { db } = options;

  app.get('/api/applications', { preHandler: app.requirePermission('application:read') }, async (request) => ({
    applications: listApplications(db, request.user!),
  }));

  app.get<{ Params: { id: string } }>(
    '/api/applications/:id',
    { preHandler: app.requirePermission('application:read') },
    async (request) => {
      const id = Number(request.params.id);
      const application = Number.isInteger(id) ? getApplication(db, id) : null;
      if (!application) throw notFound('Application introuvable');

      // Même règle de visibilité que la liste (un brouillon d'autrui renvoie 404, pas 403 : on ne révèle rien).
      const visibility = visibilityClause(request.user!);
      const visible = one<{ ok: number }>(
        db, `SELECT 1 AS ok FROM applications a WHERE a.id = ? AND ${visibility.sql}`, id, ...visibility.params,
      );
      if (!visible) throw notFound('Application introuvable');
      return { application };
    },
  );

  app.post('/api/applications', { preHandler: app.requirePermission('application:create') }, async (request, reply) => {
    const input = validate(createApplicationSchema, request.body);

    const owner = one<{ id: number }>(db, 'SELECT id FROM users WHERE id = ? AND is_active = 1', input.processOwnerId);
    if (!owner) throw badRequest('Process Owner inconnu', { processOwnerId: 'Utilisateur inconnu ou désactivé' });

    const application = createApplication(db, input, request.user!, request.ip);
    return reply.code(201).send({ application });
  });
}
