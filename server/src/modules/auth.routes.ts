/**
 * Routes d'authentification.
 *
 *   Mot de passe (comptes locaux / de démo)
 *     POST /api/auth/login             { email, password } → { user } + cookie de session
 *     POST /api/auth/logout                                → 204      + cookie supprimé
 *     GET  /api/auth/me                                    → { user } (null si pas de session)
 *     GET  /api/auth/providers                             → { google: bool }
 *
 *   SSO Google (voir auth/google-sso.ts)
 *     GET  /api/auth/google/start      → redirige vers Google
 *     GET  /api/auth/google/callback   → crée la session puis redirige vers /
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { loginSchema, type UserDto } from '@poryg/shared';
import {
  buildAuthorizationUrl, createPendingLogin, decodeIdTokenPayload, exchangeCodeForIdToken,
  safeEquals, validateIdTokenClaims, GoogleAuthError, type GoogleConfig, type PendingLogin,
} from '../auth/google-sso.js';
import type { AuthProvider, Identity } from '../auth/provider.js';
import { createSession, deleteSession } from '../auth/session.js';
import { recordAudit } from '../audit.js';
import { one, run, type Db } from '../db/connection.js';
import { HttpError, notFound } from '../lib/http-errors.js';
import { validate } from '../lib/validate.js';

export interface AuthRoutesOptions {
  db: Db;
  provider: AuthProvider;
  cookieName: string;
  ttlHours: number;
  secureCookie: boolean;
  loginRateLimit: { max: number; timeWindow: string };
  /** `null` quand le SSO Google n'est pas configuré. */
  google: GoogleConfig | null;
}

interface UserRow {
  id: number;
  email: string;
  display_name: string;
  role: UserDto['role'];
  is_active: number;
  external_id: string | null;
}

/** Cookie temporaire portant l'état d'une connexion Google en cours. */
const PENDING_COOKIE = 'poryg_sso';
const PENDING_TTL_SECONDS = 600; // 10 minutes pour aller au bout du parcours Google

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const { db } = options;

  const sessionCookieOptions = {
    path: '/',
    httpOnly: true, // inaccessible en JavaScript (XSS ne peut pas voler la session)
    sameSite: 'strict' as const, // jamais envoyé depuis un autre site (CSRF)
    secure: options.secureCookie, // HTTPS uniquement en production
    maxAge: options.ttlHours * 3600,
  };

  /** Ouvre la session applicative et pose le cookie. Commun au mot de passe et au SSO. */
  function openSession(reply: FastifyReply, row: UserRow, ip: string, userAgent?: string): UserDto {
    const sessionId = createSession(db, row.id, options.ttlHours, { ip, userAgent });
    recordAudit(db, { actorId: row.id, entity: 'user', entityId: row.id, action: 'login', ip });
    reply.setCookie(options.cookieName, sessionId, sessionCookieOptions);
    return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
  }

  // --- Connexion par mot de passe -------------------------------------------

  app.post(
    '/api/auth/login',
    { config: { rateLimit: options.loginRateLimit } },
    async (request, reply) => {
      const credentials = validate(loginSchema, request.body);

      const identity = await options.provider.authenticate({ kind: 'password', ...credentials });
      if (!identity) {
        recordAudit(db, {
          actorId: null, entity: 'user', entityId: credentials.email, action: 'login_failed', ip: request.ip,
        });
        // Message volontairement identique que l'e-mail existe ou non.
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect');
      }

      const row = findUserByEmail(db, identity.email);
      if (!row) throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect');

      const user = openSession(reply, row, request.ip, request.headers['user-agent']);
      return reply.send({ user });
    },
  );

  app.post('/api/auth/logout', { preHandler: app.requireAuth }, async (request, reply) => {
    if (request.sessionId) deleteSession(db, request.sessionId);
    recordAudit(db, {
      actorId: request.user!.id, entity: 'user', entityId: request.user!.id, action: 'logout', ip: request.ip,
    });
    return reply.clearCookie(options.cookieName, { path: '/' }).code(204).send();
  });

  // Pas de 401 ici : le client l'appelle au chargement pour savoir s'il y a une session.
  app.get('/api/auth/me', async (request) => ({ user: request.user }));

  // Indique au front s'il doit afficher le bouton « Continuer avec Google ».
  app.get('/api/auth/providers', async () => ({ google: options.google !== null }));

  // --- SSO Google ------------------------------------------------------------

  const googleCookieOptions = {
    // Limité aux routes du SSO : le cookie n'est pas envoyé au reste de l'application.
    path: '/api/auth/google',
    httpOnly: true,
    // 'lax' est indispensable : le retour de Google est une navigation inter-site,
    // et 'strict' empêcherait le navigateur de renvoyer ce cookie sur le callback.
    sameSite: 'lax' as const,
    secure: options.secureCookie,
    signed: true,
    maxAge: PENDING_TTL_SECONDS,
  };

  app.get('/api/auth/google/start', async (request, reply) => {
    const google = options.google;
    if (!google) throw notFound('La connexion Google n’est pas configurée sur ce serveur');

    const pending = createPendingLogin();
    const encoded = Buffer.from(JSON.stringify(pending), 'utf8').toString('base64url');
    return reply
      .setCookie(PENDING_COOKIE, encoded, googleCookieOptions)
      .redirect(buildAuthorizationUrl(google, pending), 302);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/google/callback',
    async (request, reply) => {
      const google = options.google;
      if (!google) throw notFound('La connexion Google n’est pas configurée sur ce serveur');

      // Le cookie n'a plus d'utilité passé ce point, quel que soit le résultat.
      reply.clearCookie(PENDING_COOKIE, { path: googleCookieOptions.path });

      const fail = (code: string) => reply.redirect(`/login?erreur=${encodeURIComponent(code)}`, 302);

      try {
        // Google renvoie `error` si l'utilisateur a refusé ou annulé.
        if (request.query.error) return fail('sso_annule');

        const pending = readPendingCookie(request.cookies[PENDING_COOKIE], (value) => request.unsignCookie(value));
        if (!pending) return fail('sso_expire');

        const { code, state } = request.query;
        if (!code || !state || !safeEquals(state, pending.state)) return fail('sso_etat');

        const idToken = await exchangeCodeForIdToken(google, code, pending.codeVerifier);
        const identity = validateIdTokenClaims(decodeIdTokenPayload(idToken), {
          clientId: google.clientId,
          nonce: pending.nonce,
        });

        const row = findUserForIdentity(db, identity);
        if (!row) {
          // Pas de création automatique de compte : le registre ne s'ouvre pas à
          // n'importe quel compte Google. C'est l'AI Officer qui inscrit les personnes.
          recordAudit(db, {
            actorId: null, entity: 'user', entityId: identity.email,
            action: 'login_failed_sso_inconnu', ip: request.ip,
          });
          return fail('sso_inconnu');
        }
        if (!row.is_active) {
          recordAudit(db, {
            actorId: null, entity: 'user', entityId: row.id, action: 'login_failed_desactive', ip: request.ip,
          });
          return fail('compte_desactive');
        }

        // Première connexion SSO : on mémorise l'identifiant Google pour les suivantes.
        if (!row.external_id) {
          run(db, 'UPDATE users SET external_id = ? WHERE id = ?', identity.externalId!, row.id);
          recordAudit(db, {
            actorId: row.id, entity: 'user', entityId: row.id, action: 'sso_lie', ip: request.ip,
            after: { provider: 'google' },
          });
        }

        openSession(reply, row, request.ip, request.headers['user-agent']);
        return reply.redirect('/', 302);
      } catch (error) {
        request.log.warn({ err: error }, 'Échec de connexion Google');
        return fail(error instanceof GoogleAuthError ? error.code : 'sso_erreur');
      }
    },
  );
}

// --- Aides ------------------------------------------------------------------

const USER_COLUMNS = 'id, email, display_name, role, is_active, external_id';

function findUserByEmail(db: Db, email: string): UserRow | undefined {
  return one<UserRow>(db, `SELECT ${USER_COLUMNS} FROM users WHERE email = ?`, email);
}

/**
 * Retrouve le compte correspondant à une identité Google : d'abord par
 * identifiant Google (stable même si l'adresse change), sinon par e-mail.
 */
function findUserForIdentity(db: Db, identity: Identity): UserRow | undefined {
  if (identity.externalId) {
    const byExternalId = one<UserRow>(db, `SELECT ${USER_COLUMNS} FROM users WHERE external_id = ?`, identity.externalId);
    if (byExternalId) return byExternalId;
  }
  return findUserByEmail(db, identity.email);
}

type Unsigner = (value: string) => { valid: boolean; value: string | null };

/** Relit et valide le cookie d'état ; renvoie `null` s'il est absent, altéré ou illisible. */
function readPendingCookie(raw: string | undefined, unsign: Unsigner): PendingLogin | null {
  if (!raw) return null;
  const unsigned = unsign(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as Partial<PendingLogin>;
    if (!parsed.state || !parsed.nonce || !parsed.codeVerifier) return null;
    return parsed as PendingLogin;
  } catch {
    return null;
  }
}
