/**
 * Routes de l'inventaire des applications IA.
 *
 *   GET  /api/applications              liste filtrée (?q=&status=&domain=&sensitivity=)
 *   POST /api/applications              déclaration (→ statut draft)
 *   GET  /api/applications/:id          détail
 *   PUT  /api/applications/:id          modification
 *   GET  /api/applications/:id/history  journal d'audit de cette application
 *   POST /api/applications/:id/submit   brouillon → en cours d'audit
 *   POST /api/applications/:id/delete   suppression LOGIQUE
 *   POST /api/applications/:id/restore  restauration
 *
 * Les autorisations suivent deux niveaux :
 *   1. la permission de rôle (`requirePermission`) ;
 *   2. la règle « propriétaire » (canEditApplication / canSubmitApplication), car
 *      un Application Manager ne modifie que SES applications.
 */
import type { FastifyInstance } from 'fastify';
import {
  applicationFiltersSchema, canEditApplication, canSubmitApplication,
  createApplicationSchema, updateApplicationSchema, type ApplicationDto, type UserDto,
} from '@poryg/shared';
import { one, type Db } from '../db/connection.js';
import { badRequest, forbidden, notFound } from '../lib/http-errors.js';
import { validate } from '../lib/validate.js';
import {
  createApplication, getApplication, getApplicationHistory, isVisible, listApplications,
  restoreApplication, softDeleteApplication, submitApplication, updateApplication,
} from './applications.repo.js';
import { assertRoom, currentOrganizationId } from './organizations.repo.js';

export function registerApplicationsRoutes(app: FastifyInstance, options: { db: Db }): void {
  const { db } = options;

  /**
   * Charge une application visible par l'utilisateur, ou lève 404.
   * Un brouillon d'autrui renvoie 404 (et non 403) : on ne révèle pas son existence.
   */
  function loadVisible(user: UserDto, rawId: string): ApplicationDto {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Application introuvable');
    // L'utilisateur est passé : le coût du mois n'est calculé que s'il y a droit.
    const application = getApplication(db, id, user);
    if (!application || !isVisible(db, user, id)) throw notFound('Application introuvable');
    return application;
  }

  /**
   * Vérifie que le Process Owner désigné existe, est actif, et appartient à
   * l'organisation courante : sans cette dernière condition, on pourrait
   * désigner responsable quelqu'un d'une autre organisation, qui ne verrait
   * jamais l'application dont il est censé répondre.
   */
  function assertOwnerExists(user: UserDto, processOwnerId: number): void {
    const owner = one<{ id: number }>(
      db,
      `SELECT u.id FROM users u
         JOIN memberships m ON m.user_id = u.id
        WHERE u.id = ? AND u.is_active = 1 AND m.organization_id = ? AND m.status = 'active'`,
      processOwnerId, currentOrganizationId(user),
    );
    if (!owner) {
      throw badRequest('Process Owner inconnu', { processOwnerId: "Cette personne n'appartient pas à votre organisation" });
    }
  }

  // --- Lecture ---------------------------------------------------------------

  app.get('/api/applications', { preHandler: app.requirePermission('application:read') }, async (request) => {
    const filters = validate(applicationFiltersSchema, request.query);
    return { applications: listApplications(db, request.user!, filters) };
  });

  app.get<{ Params: { id: string } }>(
    '/api/applications/:id',
    { preHandler: app.requirePermission('application:read') },
    async (request) => {
      const user = request.user!;
      const application = loadVisible(user, request.params.id);
      return {
        application,
        // Le client s'en sert pour n'afficher que les actions réellement possibles.
        permissions: {
          edit: canEditApplication(user, application),
          submit: canSubmitApplication(user, application),
          delete: app.hasPermission(user, 'application:delete') && application.status !== 'deleted',
          restore: app.hasPermission(user, 'application:restore') && application.status === 'deleted',
          history: app.hasPermission(user, 'application:history'),
        },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/applications/:id/history',
    { preHandler: app.requirePermission('application:history') },
    async (request) => {
      const application = loadVisible(request.user!, request.params.id);
      return { history: getApplicationHistory(db, application.id) };
    },
  );

  // --- Écriture --------------------------------------------------------------

  app.post('/api/applications', { preHandler: app.requirePermission('application:create') }, async (request, reply) => {
    const input = validate(createApplicationSchema, request.body);
    assertOwnerExists(request.user!, input.processOwnerId);
    // Plafond de la formule d'abonnement : vérifié AVANT l'écriture, côté serveur.
    assertRoom(db, currentOrganizationId(request.user!), 'applications');
    const application = createApplication(db, input, request.user!, request.ip);
    return reply.code(201).send({ application });
  });

  app.put<{ Params: { id: string } }>(
    '/api/applications/:id',
    { preHandler: app.requirePermission('application:update') },
    async (request) => {
      const user = request.user!;
      const existing = loadVisible(user, request.params.id);
      if (!canEditApplication(user, existing)) {
        throw forbidden(
          existing.status === 'deleted'
            ? 'Une application supprimée ne peut pas être modifiée'
            : "Vous ne pouvez modifier que les applications dont vous êtes Process Owner",
        );
      }

      const input = validate(updateApplicationSchema, request.body);
      assertOwnerExists(user, input.processOwnerId);
      const { application, reevaluationTriggered } = updateApplication(db, existing.id, input, user, request.ip);
      return { application, reevaluationTriggered };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/applications/:id/submit',
    { preHandler: app.requirePermission('application:submit') },
    async (request) => {
      const user = request.user!;
      const existing = loadVisible(user, request.params.id);
      if (!canSubmitApplication(user, existing)) {
        throw forbidden(
          existing.status === 'draft'
            ? "Vous ne pouvez envoyer à l'audit que vos propres applications"
            : "Seul un brouillon peut être envoyé à l'audit",
        );
      }
      return { application: submitApplication(db, existing.id, user, request.ip) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/applications/:id/delete',
    { preHandler: app.requirePermission('application:delete') },
    async (request) => {
      const existing = loadVisible(request.user!, request.params.id);
      if (existing.status === 'deleted') throw badRequest('Cette application est déjà supprimée');
      // Suppression logique : la ligne reste en base, avec qui et quand.
      return { application: softDeleteApplication(db, existing.id, request.user!, request.ip) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/applications/:id/restore',
    { preHandler: app.requirePermission('application:restore') },
    async (request) => {
      const existing = loadVisible(request.user!, request.params.id);
      if (existing.status !== 'deleted') throw badRequest("Cette application n'est pas supprimée");
      return { application: restoreApplication(db, existing.id, request.user!, request.ip) };
    },
  );
}
