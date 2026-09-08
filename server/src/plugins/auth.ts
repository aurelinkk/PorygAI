/**
 * Authentification par session + contrôle d'accès (RBAC).
 *
 *  - Sur chaque requête : lit le cookie, résout la session → `request.user` (ou null).
 *  - `app.requireAuth`            : preHandler, 401 si non connecté.
 *  - `app.requirePermission(p)`   : preHandler, 401 si non connecté, 403 si le rôle
 *                                   n'a pas la permission (matrice de @poryg/shared).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { can, type Permission, type UserDto } from '@poryg/shared';
import type { Db } from '../db/connection.js';
import { forbidden, unauthenticated } from '../lib/http-errors.js';
import { resolveSession } from '../auth/session.js';

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyRequest {
    user: UserDto | null;
    sessionId: string | null;
  }
  interface FastifyInstance {
    requireAuth: PreHandler;
    requirePermission: (permission: Permission) => PreHandler;
    /** Test ponctuel d'une permission (pour composer une réponse, pas pour garder une route). */
    hasPermission: (user: UserDto, permission: Permission) => boolean;
  }
}

export interface AuthOptions {
  db: Db;
  cookieName: string;
  ttlHours: number;
}

export function registerAuth(app: FastifyInstance, options: AuthOptions): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request) => {
    const sessionId = request.cookies[options.cookieName];
    if (!sessionId) return;
    const user = resolveSession(options.db, sessionId, options.ttlHours);
    if (user) {
      request.user = user;
      request.sessionId = sessionId;
    }
  });

  app.decorate('requireAuth', async (request: FastifyRequest) => {
    if (!request.user) throw unauthenticated();
  });

  app.decorate('requirePermission', (permission: Permission) => async (request: FastifyRequest) => {
    if (!request.user) throw unauthenticated();
    if (!can(request.user.role, permission)) throw forbidden();
  });

  app.decorate('hasPermission', (user: UserDto, permission: Permission) => can(user.role, permission));
}
