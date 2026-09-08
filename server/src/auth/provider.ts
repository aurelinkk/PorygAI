/**
 * Abstraction du fournisseur d'identité.
 *
 * Le provider répond à UNE question : « qui est cette personne ? ». Tout le
 * reste (sessions, rôle, permissions) appartient à Poryg'AI et vit en base.
 * Le rôle ne vient donc JAMAIS de l'IdP : c'est l'AI Officer qui l'attribue.
 *
 * Aujourd'hui : `local-provider.ts` (e-mail + mot de passe).
 * Demain (SSO) : un `oidc-provider.ts` qui implémente la même interface avec
 * `kind: 'oidc_code'` — voir docs/architecture.md § "Brancher un SSO".
 */

export interface Identity {
  email: string;
  displayName: string;
  /** Identifiant stable côté IdP (claim `sub`). Absent en local. */
  externalId?: string;
}

export type AuthInput =
  | { kind: 'password'; email: string; password: string }
  | { kind: 'oidc_code'; code: string; state: string };

export interface AuthProvider {
  readonly kind: 'local' | 'oidc';
  /** Renvoie l'identité vérifiée, ou `null` si les éléments fournis sont invalides. */
  authenticate(input: AuthInput): Promise<Identity | null>;
}
