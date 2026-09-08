/**
 * Erreurs HTTP typées. Le gestionnaire global (app.ts) les transforme en
 * réponse JSON `{ error: { code, message, fields? } }` — un seul format côté client.
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

export const notFound = (message = 'Ressource introuvable') => new HttpError(404, 'NOT_FOUND', message);

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, 'BAD_REQUEST', message, fields);
