/**
 * Client HTTP minimal (fetch). Le cookie de session est envoyé automatiquement
 * (même origine). Toute erreur API devient une `ApiError` typée.
 */
import type { ApiErrorBody } from '@poryg/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Émis quand l'API répond 401 hors connexion : la session a expiré côté serveur. */
export const UNAUTHENTICATED_EVENT = 'poryg:unauthenticated';

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Impossible de joindre le serveur. Vérifiez qu'il est démarré.");
  }

  if (response.status === 204) return undefined as T;

  const data = (await response.json().catch(() => null)) as (ApiErrorBody & T) | null;
  if (!response.ok) {
    const error = data?.error;
    if (response.status === 401 && !url.startsWith('/api/auth/login')) {
      window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    }
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? `Erreur ${response.status}`, error?.fields);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
};
