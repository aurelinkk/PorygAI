/**
 * Routes des organisations.
 *
 *   GET  /api/organizations                        mes organisations + celle qui est active
 *   POST /api/organizations                        créer la mienne (et l'activer)
 *   POST /api/organizations/:id/activate           changer d'organisation active
 *   GET  /api/organizations/current                fiche de l'organisation active + membres
 *   PUT  /api/organizations/current                renommer / changer de formule
 *   POST /api/organizations/current/members/import importer des comptes
 *   PUT  /api/organizations/current/members/:userId  rôle et présence d'une personne
 *
 * Deux niveaux, comme ailleurs : la permission de rôle d'abord (`requirePermission`),
 * puis l'appartenance à l'organisation visée. Créer une organisation est la seule
 * action ouverte à toute personne connectée : sans cela, un compte neuf serait
 * enfermé dehors, sans aucun moyen d'entrer.
 */
import type { FastifyInstance } from 'fastify';
import {
  createOrganizationSchema, importMembersSchema, updateMemberSchema, updateOrganizationSchema,
  type UserDto,
} from '@poryg/shared';
import { resolveSession, setSessionOrganization } from '../auth/session.js';
import type { Db } from '../db/connection.js';
import { badRequest, notFound } from '../lib/http-errors.js';
import { validate } from '../lib/validate.js';
import {
  createOrganization, currentOrganizationId, getOrganization, importMembers, listMembers,
  listUserOrganizations, membershipRole, updateMember, updateOrganization,
} from './organizations.repo.js';

export interface OrganizationsRoutesOptions {
  db: Db;
  /** Même durée que les sessions : relire le profil après un changement d'organisation. */
  ttlHours: number;
}

export function registerOrganizationsRoutes(app: FastifyInstance, options: OrganizationsRoutesOptions): void {
  const { db } = options;

  /**
   * Profil à jour après un changement d'organisation active. Le rôle en dépend :
   * le client doit repartir du profil renvoyé, pas de celui qu'il avait.
   */
  function refreshedUser(sessionId: string | null, fallback: UserDto): UserDto {
    return (sessionId && resolveSession(db, sessionId, options.ttlHours)) || fallback;
  }

  // --- Mes organisations -----------------------------------------------------

  app.get('/api/organizations', { preHandler: app.requireAuth }, async (request) => {
    const user = request.user!;
    return { organizations: listUserOrganizations(db, user.id), activeId: user.organizationId };
  });

  app.post('/api/organizations', { preHandler: app.requireAuth }, async (request, reply) => {
    const input = validate(createOrganizationSchema, request.body);
    const organization = createOrganization(db, input, request.user!, request.ip);

    // On bascule dessus immédiatement : personne ne crée une organisation pour
    // rester dans une autre.
    if (request.sessionId) setSessionOrganization(db, request.sessionId, organization.id);

    return reply.code(201).send({ organization, user: refreshedUser(request.sessionId, request.user!) });
  });

  app.post<{ Params: { id: string } }>(
    '/api/organizations/:id/activate',
    { preHandler: app.requireAuth },
    async (request) => {
      const user = request.user!;
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) throw notFound('Organisation introuvable');

      // 404 et non 403 : on ne révèle pas l'existence d'une organisation dont
      // l'utilisateur n'est pas membre (même règle que les brouillons d'autrui).
      const organization = getOrganization(db, id, user.id);
      if (!organization) throw notFound('Organisation introuvable');

      if (request.sessionId) setSessionOrganization(db, request.sessionId, id);
      return { organization, user: refreshedUser(request.sessionId, user) };
    },
  );

  // --- L'organisation active -------------------------------------------------

  app.get('/api/organizations/current', { preHandler: app.requirePermission('organization:read') }, async (request) => {
    const user = request.user!;
    const organizationId = currentOrganizationId(user);
    const organization = getOrganization(db, organizationId, user.id);
    if (!organization) throw notFound('Organisation introuvable');

    return {
      organization,
      members: listMembers(db, organizationId),
      // Le client n'affiche que les actions réellement possibles ; l'API refuse
      // les autres de toute façon.
      permissions: {
        manage: app.hasPermission(user, 'organization:manage'),
        members: app.hasPermission(user, 'organization:members'),
      },
    };
  });

  app.put('/api/organizations/current', { preHandler: app.requirePermission('organization:manage') }, async (request) => {
    const user = request.user!;
    const input = validate(updateOrganizationSchema, request.body);
    return { organization: updateOrganization(db, currentOrganizationId(user), input, user, request.ip) };
  });

  // --- Les personnes ---------------------------------------------------------

  app.post(
    '/api/organizations/current/members/import',
    { preHandler: app.requirePermission('organization:members') },
    async (request) => {
      const user = request.user!;
      const input = validate(importMembersSchema, request.body);
      const report = importMembers(db, currentOrganizationId(user), input.text, input.dryRun, user, request.ip);
      return { report };
    },
  );

  app.put<{ Params: { userId: string } }>(
    '/api/organizations/current/members/:userId',
    { preHandler: app.requirePermission('organization:members') },
    async (request) => {
      const user = request.user!;
      const organizationId = currentOrganizationId(user);
      const targetId = Number(request.params.userId);
      if (!Number.isInteger(targetId) || targetId <= 0) throw notFound('Personne introuvable');

      // Se retirer soi-même de l'organisation que l'on administre est le meilleur
      // moyen de s'enfermer dehors : c'est refusé, il faut passer par quelqu'un d'autre.
      const input = validate(updateMemberSchema, request.body);
      if (targetId === user.id && (input.status === 'disabled' || input.role !== 'ai_officer')) {
        throw badRequest(
          "Vous ne pouvez pas retirer ni rétrograder votre propre accès : demandez-le à un autre AI Officer de l'organisation.",
        );
      }
      if (!membershipRole(db, targetId, organizationId) && targetId !== user.id) {
        // La personne peut exister mais avoir été désactivée : updateMember le gère.
        const connue = listMembers(db, organizationId).some((member) => member.id === targetId);
        if (!connue) throw notFound("Cette personne n'appartient pas à l'organisation");
      }

      return { member: updateMember(db, organizationId, targetId, input, user, request.ip) };
    },
  );
}
