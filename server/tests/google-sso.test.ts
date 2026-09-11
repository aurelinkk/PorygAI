/**
 * Tests du SSO Google. Aucun appel réseau : l'échange du code contre l'ID token
 * est intercepté (`vi.spyOn(globalThis, 'fetch')`) et l'ID token est fabriqué :
 * ce qui est légitime puisque nous ne vérifions pas sa signature (cf. google-sso.ts).
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizationUrl, createPendingLogin, decodeIdTokenPayload, safeEquals,
  validateIdTokenClaims, GoogleAuthError, type GoogleConfig, type PendingLogin,
} from '../src/auth/google-sso.js';
import { all, one } from '../src/db/connection.js';
import { createTestApp } from './helpers.js';

const GOOGLE: GoogleConfig = {
  clientId: 'test-client-id.apps.googleusercontent.com',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:5173/api/auth/google/callback',
};

const base64url = (value: object) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/** Fabrique un ID token (en-tête. charge utile. signature factice). */
function makeIdToken(claims: Record<string, unknown>): string {
  return `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url(claims)}.signature-non-verifiee`;
}

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: GOOGLE.clientId,
    sub: '1234567890',
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: 'nonce-de-test',
    email: 'cleomarinmarie@gmail.com',
    email_verified: true,
    name: 'Cléo Marin',
    ...overrides,
  };
}

// --- Validation des claims (fonction pure) -----------------------------------

describe("validation de l'ID token", () => {
  const options = { clientId: GOOGLE.clientId, nonce: 'nonce-de-test' };

  it('accepte un token valide et normalise l’e-mail', () => {
    const identity = validateIdTokenClaims(validClaims({ email: 'Cleo.Marin@GMAIL.com' }), options);
    expect(identity).toEqual({
      email: 'cleo.marin@gmail.com',
      displayName: 'Cléo Marin',
      externalId: '1234567890',
    });
  });

  it('refuse un émetteur inattendu', () => {
    expect(() => validateIdTokenClaims(validClaims({ iss: 'https://evil.example' }), options))
      .toThrow(GoogleAuthError);
  });

  it("refuse un token destiné à une autre application", () => {
    expect(() => validateIdTokenClaims(validClaims({ aud: 'autre-client-id' }), options))
      .toThrow(/ne vise pas cette application/);
  });

  it('refuse un token expiré', () => {
    const expired = validClaims({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(() => validateIdTokenClaims(expired, options)).toThrow(/expiré/);
  });

  it('refuse un nonce qui ne correspond pas (rejeu)', () => {
    expect(() => validateIdTokenClaims(validClaims({ nonce: 'un-autre-nonce' }), options))
      .toThrow(/ne correspond pas/);
  });

  it('refuse une adresse non vérifiée par Google', () => {
    expect(() => validateIdTokenClaims(validClaims({ email_verified: false }), options))
      .toThrow(/n'est pas vérifiée/);
  });

  it('refuse un token sans identifiant Google', () => {
    const { sub, ...withoutSub } = validClaims();
    expect(() => validateIdTokenClaims(withoutSub, options)).toThrow(/Identifiant Google absent/);
  });

  it('refuse un token malformé', () => {
    expect(() => decodeIdTokenPayload('pas-un-jwt')).toThrow(/malformé/);
  });
});

describe('utilitaires', () => {
  it('safeEquals compare sans se tromper sur les longueurs', () => {
    expect(safeEquals('abc', 'abc')).toBe(true);
    expect(safeEquals('abc', 'abd')).toBe(false);
    expect(safeEquals('abc', 'abcd')).toBe(false);
    expect(safeEquals('', '')).toBe(true);
  });

  it("l'URL d'autorisation contient PKCE, state et nonce", () => {
    const pending = createPendingLogin();
    const url = new URL(buildAuthorizationUrl(GOOGLE, pending));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(GOOGLE.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(GOOGLE.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe(pending.state);
    expect(url.searchParams.get('nonce')).toBe(pending.nonce);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Le verifier lui-même ne doit jamais partir chez Google.
    expect(url.search).not.toContain(pending.codeVerifier);
  });

  it('chaque demande tire des valeurs différentes', () => {
    const a = createPendingLogin();
    const b = createPendingLogin();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

// --- Parcours complet sur l'application --------------------------------------

describe('routes SSO Google', () => {
  let app: FastifyInstance;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    app = await createTestApp({ google: GOOGLE });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  /** Joue /start et relit le cookie signé pour connaître state / nonce / verifier. */
  async function startLogin(): Promise<{ cookie: string; pending: PendingLogin; location: string }> {
    const response = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    expect(response.statusCode).toBe(302);

    const raw = response.cookies.find((c) => c.name === 'poryg_sso');
    if (!raw) throw new Error("cookie d'état absent");
    const unsigned = app.unsignCookie(raw.value);
    const pending = JSON.parse(Buffer.from(unsigned.value!, 'base64url').toString('utf8')) as PendingLogin;
    return { cookie: `poryg_sso=${raw.value}`, pending, location: response.headers.location as string };
  }

  const respondWithIdToken = (claims: Record<string, unknown>) =>
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id_token: makeIdToken(claims) }),
    });

  it('annonce que Google est disponible', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(response.json()).toEqual({ google: true });
  });

  it('/start redirige vers Google et pose un cookie httpOnly SameSite=Lax', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');

    const cookie = response.cookies.find((c) => c.name === 'poryg_sso')!;
    expect(cookie.httpOnly).toBe(true);
    // 'Lax' est indispensable : le retour de Google est une navigation inter-site.
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/api/auth/google');
  });

  it('connecte un compte de l’équipe et mémorise son identifiant Google', async () => {
    const { cookie, pending } = await startLogin();
    respondWithIdToken(validClaims({ nonce: pending.nonce }));

    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=code-google&state=${encodeURIComponent(pending.state)}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');

    // Session ouverte.
    const session = response.cookies.find((c) => c.name === 'poryg_session')!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe('Strict');

    const me = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: { cookie: `poryg_session=${session.value}` },
    });
    expect(me.json().user).toMatchObject({ email: 'cleomarinmarie@gmail.com', role: 'ai_officer' });

    // Identifiant Google enregistré, et tracé.
    const row = one<{ external_id: string }>(
      app.db, 'SELECT external_id FROM users WHERE email = ?', 'cleomarinmarie@gmail.com',
    );
    expect(row?.external_id).toBe('1234567890');
    expect(all(app.db, "SELECT 1 FROM audit_log WHERE action = 'sso_lie'")).toHaveLength(1);
    expect(all(app.db, "SELECT 1 FROM audit_log WHERE action = 'login'")).toHaveLength(1);

    // Le verifier PKCE et le secret sont bien passés côté serveur.
    const body = (fetchMock.mock.calls[0]![1] as { body: URLSearchParams }).body;
    expect(body.get('code_verifier')).toBe(pending.codeVerifier);
    expect(body.get('client_secret')).toBe(GOOGLE.clientSecret);
  });

  /**
   * Inscription libre : une adresse inconnue crée un compte, **sans
   * organisation**. La porte d'entrée est ouverte, pas les données des autres :
   * les tests qui suivent le vérifient jusqu'à l'appel d'API.
   */
  it('crée le compte d’une adresse Google inconnue, sans aucune organisation', async () => {
    const { cookie, pending } = await startLogin();
    respondWithIdToken(validClaims({
      nonce: pending.nonce, email: 'nouvelle@gmail.com', sub: 'sub-nouvelle', name: 'Nouvelle Venue',
    }));

    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=c&state=${encodeURIComponent(pending.state)}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.cookies.find((c) => c.name === 'poryg_session')).toBeDefined();

    const compte = one<{ id: number; display_name: string; password_hash: string | null; external_id: string }>(
      app.db, 'SELECT id, display_name, password_hash, external_id FROM users WHERE email = ?', 'nouvelle@gmail.com',
    );
    expect(compte).toBeDefined();
    expect(compte!.display_name).toBe('Nouvelle Venue'); // claim `name` de Google
    expect(compte!.password_hash).toBeNull(); // il entre par Google, pas par mot de passe
    expect(compte!.external_id).toBe('sub-nouvelle');

    // Aucune appartenance : c'est tout l'intérêt de la règle.
    expect(all(app.db, 'SELECT 1 FROM memberships WHERE user_id = ?', compte!.id)).toHaveLength(0);
    // La première entrée est journalisée, distinctement d'une connexion ordinaire.
    expect(all(app.db, "SELECT 1 FROM audit_log WHERE action = 'signup_sso'")).toHaveLength(1);
    expect(all(app.db, "SELECT 1 FROM audit_log WHERE action = 'login'")).toHaveLength(1);
  });

  it('un compte tout neuf ne voit rien du registre, mais peut ajouter son organisation', async () => {
    const { cookie, pending } = await startLogin();
    respondWithIdToken(validClaims({ nonce: pending.nonce, email: 'nouvelle@gmail.com', sub: 'sub-nouvelle' }));
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=c&state=${encodeURIComponent(pending.state)}`,
      headers: { cookie },
    });
    const session = callback.cookies.find((c) => c.name === 'poryg_session')!;
    const entete = `${session.name}=${session.value}`;

    // Le profil dit exactement ce que l'écran d'accueil doit annoncer.
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: entete } })).json();
    expect(me.user.organizationId).toBeNull();
    expect(me.organizations).toEqual([]);

    // Rien du registre, pas même un compteur.
    for (const url of ['/api/applications', '/api/dashboard/summary', '/api/users']) {
      const refus = await app.inject({ method: 'GET', url, headers: { cookie: entete } });
      expect(refus.statusCode, url).toBe(403);
      expect(refus.json().error.code, url).toBe('NO_ORGANIZATION');
    }

    // Mais la porte de sortie est ouverte : elle ajoute la sienne et entre.
    const creation = await app.inject({
      method: 'POST', url: '/api/organizations', headers: { cookie: entete },
      payload: { name: 'Studio Nouvelle', plan: 'free' },
    });
    expect(creation.statusCode).toBe(201);
    expect(creation.json().organization.role).toBe('ai_officer');
    expect((await app.inject({ method: 'GET', url: '/api/applications', headers: { cookie: entete } })).statusCode).toBe(200);
  });

  it('une seconde connexion retrouve le compte au lieu d’en créer un autre', async () => {
    for (let fois = 0; fois < 2; fois += 1) {
      const { cookie, pending } = await startLogin();
      respondWithIdToken(validClaims({ nonce: pending.nonce, email: 'nouvelle@gmail.com', sub: 'sub-nouvelle' }));
      await app.inject({
        method: 'GET',
        url: `/api/auth/google/callback?code=c&state=${encodeURIComponent(pending.state)}`,
        headers: { cookie },
      });
    }

    expect(all(app.db, "SELECT 1 FROM users WHERE email = 'nouvelle@gmail.com'")).toHaveLength(1);
    expect(all(app.db, "SELECT 1 FROM audit_log WHERE action = 'signup_sso'")).toHaveLength(1);
    expect(all(app.db, "SELECT 1 FROM audit_log WHERE action = 'login'")).toHaveLength(2);
  });

  it('refuse un state qui ne correspond pas (CSRF sur le retour)', async () => {
    const { cookie } = await startLogin();
    const response = await app.inject({
      method: 'GET', url: '/api/auth/google/callback?code=c&state=state-force-par-un-attaquant',
      headers: { cookie },
    });
    expect(response.headers.location).toBe('/login?erreur=sso_etat');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse un retour sans cookie d’état (lien rejoué plus tard)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/google/callback?code=c&state=x' });
    expect(response.headers.location).toBe('/login?erreur=sso_expire');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse un cookie d’état altéré (signature invalide)', async () => {
    const { pending } = await startLogin();
    const forged = Buffer.from(JSON.stringify(pending), 'utf8').toString('base64url');
    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=c&state=${encodeURIComponent(pending.state)}`,
      headers: { cookie: `poryg_sso=${forged}.signature-bidon` },
    });
    expect(response.headers.location).toBe('/login?erreur=sso_expire');
  });

  it('gère le refus de l’utilisateur chez Google', async () => {
    const { cookie } = await startLogin();
    const response = await app.inject({
      method: 'GET', url: '/api/auth/google/callback?error=access_denied', headers: { cookie },
    });
    expect(response.headers.location).toBe('/login?erreur=sso_annule');
  });

  it('gère un refus de Google lors de l’échange du code', async () => {
    const { cookie, pending } = await startLogin();
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });

    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=c&state=${encodeURIComponent(pending.state)}`,
      headers: { cookie },
    });
    expect(response.headers.location).toBe('/login?erreur=sso_echange');
  });

  it('refuse un compte désactivé', async () => {
    app.db.prepare('UPDATE users SET is_active = 0 WHERE email = ?').run('chatet.maelle@gmail.com');
    const { cookie, pending } = await startLogin();
    respondWithIdToken(validClaims({ nonce: pending.nonce, email: 'chatet.maelle@gmail.com', sub: 'sub-maelle' }));

    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=c&state=${encodeURIComponent(pending.state)}`,
      headers: { cookie },
    });
    expect(response.headers.location).toBe('/login?erreur=compte_desactive');
  });
});

describe('SSO Google non configuré', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp(); // google: null par défaut
  });
  afterEach(async () => {
    await app.close();
  });

  it('annonce que Google est indisponible et refuse les routes', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/providers' })).json()).toEqual({ google: false });
    expect((await app.inject({ method: 'GET', url: '/api/auth/google/start' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/auth/google/callback?code=c&state=s' })).statusCode).toBe(404);
  });
});

describe('comptes de l’équipe (migration 002)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  // Le rôle a quitté `users` pour `memberships` (migration 006) : il se lit
  // désormais dans l'organisation d'accueil, où la migration a versé l'équipe.
  it('existent avec des rôles distincts et sans mot de passe', () => {
    const rows = all<{ email: string; role: string; password_hash: string | null }>(
      app.db,
      `SELECT u.email, m.role, u.password_hash
         FROM users u JOIN memberships m ON m.user_id = u.id
        WHERE u.email LIKE '%@gmail.com' AND m.organization_id = 1
        ORDER BY u.email`,
    );
    expect(rows).toEqual([
      { email: 'aurelien.chiquet44@gmail.com', role: 'app_manager', password_hash: null },
      { email: 'chatet.maelle@gmail.com', role: 'dpo', password_hash: null },
      { email: 'cleomarinmarie@gmail.com', role: 'ai_officer', password_hash: null },
    ]);
  });

  it('ne peuvent pas se connecter par mot de passe', async () => {
    for (const password of ['', 'Poryg2026!', 'nimportequoi']) {
      const response = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { email: 'cleomarinmarie@gmail.com', password: password || 'x' },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('le jeu de démo est bien présent malgré les comptes de l’équipe', () => {
    expect(all(app.db, 'SELECT 1 FROM applications')).toHaveLength(8);
    expect(all(app.db, 'SELECT 1 FROM users')).toHaveLength(8); // 5 démo + 3 équipe
  });
});
