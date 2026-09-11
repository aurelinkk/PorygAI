/**
 * Erreurs HTTP typées. Le gestionnaire global (app.ts) les transforme en
 * réponse JSON `{ error: { code, message, fields? } }` : un seul format côté client.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'Authentification requise');

export const forbidden = (message = 'Action non autorisée pour votre rôle') =>
  new HttpError(403, 'FORBIDDEN', message);

/**
 * Plafond d'abonnement atteint. Code distinct de FORBIDDEN : ce n'est pas une
 * question de rôle mais de formule, et le client propose alors d'en changer.
 */
export const planLimit = (message: string) => new HttpError(403, 'PLAN_LIMIT', message);

/**
 * Connecté, mais sans organisation active : rien du registre n'est accessible.
 * Code distinct de FORBIDDEN pour que le client renvoie vers « Mes
 * organisations » au lieu d'afficher une page « accès refusé ».
 */
export const noOrganization = () =>
  new HttpError(403, 'NO_ORGANIZATION', 'Créez votre organisation ou rejoignez-en une pour accéder au registre');

export const notFound = (message = 'Ressource introuvable') => new HttpError(404, 'NOT_FOUND', message);

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, 'BAD_REQUEST', message, fields);
