/**
 * Connexion via Google (OpenID Connect, flux "Authorization Code" + PKCE).
 *
 * Aucune bibliothèque : `fetch` et `node:crypto` suffisent. Le déroulé est :
 *
 *   1. /api/auth/google/start     → on tire au sort state + nonce + code_verifier,
 *                                    on les mémorise dans un cookie court, et on
 *                                    redirige l'utilisateur vers Google.
 *   2. l'utilisateur s'authentifie chez Google, qui le renvoie sur notre callback
 *                                    avec un `code` et le `state`.
 *   3. /api/auth/google/callback  → on vérifie le state, on échange le code contre
 *                                    un ID token (appel serveur→serveur), on valide
 *                                    ses claims, et on obtient l'identité.
 *
 * Pourquoi on ne vérifie pas la signature du JWT : l'ID token n'arrive pas par le
 * navigateur mais par notre propre appel HTTPS au point de terminaison de Google.
 * La spécification OIDC (§3.1.3.7, point 6) autorise explicitement à s'appuyer sur
 * la validation TLS du serveur dans ce cas. Cela nous évite une dépendance JWT/JWKS.
 * En revanche on valide toujours : émetteur, destinataire, expiration, nonce et
 * `email_verified`.
 *
 * Rappel d'architecture : Google répond seulement à « qui est cette personne ? ».
 * Le rôle, lui, vient de notre base et n'est jamais déduit de Google.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Identity } from './provider.js';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Doit être déclarée à l'identique dans la console Google Cloud. */
  redirectUri: string;
}

/** Données tirées au sort au début du flux et rejouées au retour de Google. */
export interface PendingLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Erreur de connexion SSO. `code` sert de message court dans l'URL de retour
 * (`/login?erreur=<code>`) ; le libellé français est côté client.
 */
export class GoogleAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export function createPendingLogin(): PendingLogin {
  return {
    state: randomBytes(32).toString('base64url'), // anti-CSRF sur le retour
    nonce: randomBytes(16).toString('base64url'), // lie l'ID token à CETTE demande
    codeVerifier: randomBytes(32).toString('base64url'), // PKCE
  };
}

/** URL vers laquelle rediriger l'utilisateur pour qu'il s'authentifie chez Google. */
export function buildAuthorizationUrl(config: GoogleConfig, pending: PendingLogin): string {
  const codeChallenge = createHash('sha256').update(pending.codeVerifier).digest('base64url');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account', // laisse choisir le compte plutôt que reprendre le dernier
  });
  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

/** Comparaison en temps constant, insensible aux différences de longueur. */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Échange le code d'autorisation contre un ID token (appel serveur → Google). */
export async function exchangeCodeForIdToken(
  config: GoogleConfig,
  code: string,
  codeVerifier: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleAuthError('sso_indisponible', "Impossible de joindre Google");
  }

  if (!response.ok) {
    throw new GoogleAuthError('sso_echange', `Google a refusé l'échange du code (HTTP ${response.status})`);
  }

  const payload = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!payload || typeof payload.id_token !== 'string') {
    throw new GoogleAuthError('sso_echange', "Réponse de Google inattendue (id_token absent)");
  }
  return payload.id_token;
}

/** Décode la charge utile d'un JWT (sans vérifier la signature : voir l'en-tête du fichier). */
export function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) throw new GoogleAuthError('sso_token', 'ID token malformé');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new GoogleAuthError('sso_token', 'ID token illisible');
  }
}

export interface ClaimCheckOptions {
  clientId: string;
  nonce: string;
  /** Instant de référence en secondes (injecté par les tests). */
  nowSeconds?: number;
}

/**
 * Vérifie les claims de l'ID token et en extrait l'identité.
 * Lève une `GoogleAuthError` au premier contrôle qui échoue.
 */
export function validateIdTokenClaims(payload: Record<string, unknown>, options: ClaimCheckOptions): Identity {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (typeof payload.iss !== 'string' || !VALID_ISSUERS.has(payload.iss)) {
    throw new GoogleAuthError('sso_token', 'Émetteur du token inattendu');
  }
  if (payload.aud !== options.clientId) {
    throw new GoogleAuthError('sso_token', "Le token ne vise pas cette application");
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new GoogleAuthError('sso_token', 'Token expiré');
  }
  if (typeof payload.nonce !== 'string' || !safeEquals(payload.nonce, options.nonce)) {
    throw new GoogleAuthError('sso_token', 'Le token ne correspond pas à cette demande de connexion');
  }
  if (payload.email_verified !== true) {
    throw new GoogleAuthError('sso_email', "L'adresse Google n'est pas vérifiée");
  }
  if (typeof payload.email !== 'string' || !payload.email) {
    throw new GoogleAuthError('sso_email', 'Adresse e-mail absente du token');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new GoogleAuthError('sso_token', 'Identifiant Google absent du token');
  }

  const displayName = typeof payload.name === 'string' && payload.name ? payload.name : payload.email;
  return { email: payload.email.toLowerCase(), displayName, externalId: payload.sub };
}
