/**
 * Assemblage de l'application Fastify. Séparé de `server.ts` pour que les tests
 * puissent construire une instance complète sur une base en mémoire.
 *
 * Ordre : cookies → sécurité (helmet, rate-limit, CSRF) → auth (session, RBAC)
 *         → gestion d'erreurs → routes → (prod) front statique.
 */
import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { createLocalAuthProvider } from './auth/local-provider.js';
import type { GoogleConfig } from './auth/google-sso.js';
import type { AuthProvider } from './auth/provider.js';
import { config, isGoogleEnabled } from './config.js';
import { openDatabase, type Db } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { HttpError } from './lib/http-errors.js';
import { registerApplicationsRoutes } from './modules/applications.routes.js';
import { registerAuthRoutes } from './modules/auth.routes.js';
import { registerDashboardRoutes } from './modules/dashboard.routes.js';
import { registerEvaluationsRoutes } from './modules/evaluations.routes.js';
import { registerFinopsRoutes } from './modules/finops.routes.js';
import { registerOrganizationsRoutes } from './modules/organizations.routes.js';
import { registerUsersRoutes } from './modules/users.routes.js';
import { registerAuth } from './plugins/auth.js';
import { registerSecurity } from './plugins/security.js';

export interface AppOptions {
  dbPath?: string;
  logger?: boolean;
  authProvider?: (db: Db) => AuthProvider;
  loginRateLimit?: { max: number; timeWindow: string };
  /** Force la configuration Google (tests). Par défaut : celle de l'environnement. */
  google?: GoogleConfig | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const db = openDatabase(options.dbPath ?? config.dbPath);
  runMigrations(db, (message) => options.logger !== false && console.log(message));

  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: false, // à passer à true derrière un reverse proxy (pour request.ip)
  });
  app.decorate('db', db);
  app.addHook('onClose', async () => db.close());

  // `secret` sert à signer le cookie d'état du SSO (voir modules/auth.routes.ts).
  await app.register(cookie, { secret: config.cookieSecret });
  await registerSecurity(app);
  registerAuth(app, { db, cookieName: config.session.cookieName, ttlHours: config.session.ttlHours });
  registerErrorHandling(app);

  const provider = (options.authProvider ?? createLocalAuthProvider)(db);
  registerAuthRoutes(app, {
    db,
    provider,
    cookieName: config.session.cookieName,
    ttlHours: config.session.ttlHours,
    secureCookie: config.isProduction,
    loginRateLimit: options.loginRateLimit ?? config.loginRateLimit,
    google: options.google !== undefined ? options.google : isGoogleEnabled ? config.google : null,
  });
  registerOrganizationsRoutes(app, { db, ttlHours: config.session.ttlHours });
  registerUsersRoutes(app, { db });
  registerApplicationsRoutes(app, { db });
  registerEvaluationsRoutes(app, { db });
  registerFinopsRoutes(app, { db });
  registerDashboardRoutes(app, { db });

  // En production, l'API sert aussi le front compilé (`npm run build`) : un seul processus.
  const servesClient = config.isProduction && existsSync(config.clientDistDir);
  if (servesClient) {
    await app.register(fastifyStatic, { root: config.clientDistDir, wildcard: false });
  }

  // Fastify n'accepte qu'UN SEUL gestionnaire de 404 par instance : il est donc
  // enregistré ici, une fois, en tenant compte des deux cas.
  app.setNotFoundHandler(async (request, reply) => {
    if (servesClient && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html'); // routage côté client (React Router)
    }
    throw new HttpError(404, 'NOT_FOUND', 'Route inconnue');
  });

  return app;
}

/** Toutes les erreurs sortent au même format JSON ; jamais de stack trace au client. */
function registerErrorHandling(app: FastifyInstance): void {

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
      });
    }
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Trop de tentatives, réessayez dans une minute' } });
    }
    if (statusCode >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne' } });
    }
    // Erreurs 4xx émises par Fastify lui-même (JSON malformé, payload trop gros…)
    const message = error instanceof Error ? error.message : 'Requête invalide';
    return reply.code(statusCode).send({ error: { code: 'BAD_REQUEST', message } });
  });
}
