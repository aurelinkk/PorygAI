/**
 * Identité vérifiée, quel que soit le moyen de connexion.
 *
 * Règle d'architecture : un fournisseur d'identité répond à UNE question :
 * « qui est cette personne ? ». Tout le reste (sessions, rôle, permissions)
 * appartient à Poryg'AI et vit en base. Le rôle ne vient donc JAMAIS de
 * l'extérieur : c'est l'AI Officer qui l'attribue.
 *
 * Deux moyens de connexion aujourd'hui :
 *  - mot de passe → `local-provider.ts`, via l'interface `AuthProvider` ci-dessous ;
 *  - SSO Google   → `google-sso.ts`, qui est un parcours en deux temps (redirection
 *    puis retour) et ne rentre donc pas dans `authenticate()` ; il produit la même
 *    `Identity`. Voir docs/architecture.md § « Le SSO Google ».
 */

export interface Identity {
  email: string;
  displayName: string;
  /** Identifiant stable côté fournisseur (claim `sub` OIDC). Absent en local. */
  externalId?: string;
}

export type AuthInput = { kind: 'password'; email: string; password: string };

/** Fournisseur d'identité en une seule étape (aujourd'hui : le mot de passe). */
export interface AuthProvider {
  readonly kind: 'local';
  /** Renvoie l'identité vérifiée, ou `null` si les éléments fournis sont invalides. */
  authenticate(input: AuthInput): Promise<Identity | null>;
}
