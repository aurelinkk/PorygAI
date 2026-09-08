/**
 * Routes d'authentification.
 *   POST /api/auth/login   { email, password } → { user }  + cookie de session
 *   POST /api/auth/logout                       → 204      + cookie supprimé
 *   GET  /api/auth/me                           → { user } (user = null si pas de session)
 */
import type { FastifyInstance } from 'fastify';
import { loginSchema, type UserDto } from '@poryg/shared';
import type { AuthProvider } from '../auth/provider.js';
import { createSession, deleteSession } from '../auth/session.js';
import { recordAudit } from '../audit.js';
import { one, type Db } from '../db/connection.js';
import { HttpError } from '../lib/http-errors.js';
import { validate } from '../lib/validate.js';

export interface AuthRoutesOptions {
  db: Db;
  provider: AuthProvider;
  cookieName: string;
  ttlHours: number;
  secureCookie: boolean;
  loginRateLimit: { max: number; timeWindow: string };
}

interface UserRow {
  id: number;
  email: string;
  display_name: string;
  role: UserDto['role'];
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const cookieOptions = {
    path: '/',
    httpOnly: true, // inaccessible en JavaScript (XSS ne peut pas voler la session)
    sameSite: 'strict' as const, // jamais envoyé depuis un autre site (CSRF)
    secure: options.secureCookie, // HTTPS uniquement en production
    maxAge: options.ttlHours * 3600,
  };

  app.post(
    '/api/auth/login',
    { config: { rateLimit: options.loginRateLimit } },
    async (request, reply) => {
      const credentials = validate(loginSchema, request.body);

      const identity = await options.provider.authenticate({ kind: 'password', ...credentials });
      if (!identity) {
        recordAudit(options.db, {
          actorId: null, entity: 'user', entityId: credentials.email, action: 'login_failed', ip: request.ip,
        });
        // Message volontairement identique que l'e-mail existe ou non.
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect');
      }

      const row = one<UserRow>(
        options.db, 'SELECT id, email, display_name, role FROM users WHERE email = ?', identity.email,
      );
      if (!row) throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect');

      const sessionId = createSession(options.db, row.id, options.ttlHours, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      recordAudit(options.db, { actorId: row.id, entity: 'user', entityId: row.id, action: 'login', ip: request.ip });

      const user: UserDto = { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
      return reply.setCookie(options.cookieName, sessionId, cookieOptions).send({ user });
    },
  );

  app.post('/api/auth/logout', { preHandler: app.requireAuth }, async (request, reply) => {
    if (request.sessionId) deleteSession(options.db, request.sessionId);
    recordAudit(options.db, {
      actorId: request.user!.id, entity: 'user', entityId: request.user!.id, action: 'logout', ip: request.ip,
    });
    return reply.clearCookie(options.cookieName, { path: '/' }).code(204).send();
  });

  // Pas de 401 ici : le client l'appelle au chargement pour savoir s'il y a une session.
  app.get('/api/auth/me', async (request) => ({ user: request.user }));
}
