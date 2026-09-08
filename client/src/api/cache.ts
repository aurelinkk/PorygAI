/**
 * Petit cache mémoire pour les lectures GET, avec déduplication des requêtes
 * en vol. Une trentaine de lignes, aucune dépendance — inutile de sortir une
 * bibliothèque de gestion de données pour ce besoin.
 *
 * Il résout trois choses :
 *  1. le double appel de React StrictMode en développement (deux montages
 *     successifs = une seule requête réseau grâce à `inFlight`) ;
 *  2. la navigation « retour », qui réaffiche instantanément une page déjà vue ;
 *  3. deux composants qui demandent la même URL en même temps.
 *
 * Cohérence : toute écriture (POST/PUT) vide l'intégralité du cache
 * (`clearCache()` appelé depuis api/client.ts). C'est grossier, mais sûr et
 * sans surprise — à l'échelle de cette application, rien ne justifie une
 * invalidation plus fine.
 */

interface Entry {
  data: unknown;
  storedAt: number;
}

/** Au-delà, la donnée est considérée périmée et refetchée. */
const FRESH_MS = 15_000;

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

/** Donnée en cache si elle est encore fraîche, sinon `undefined`. */
export function readCache<T>(url: string): T | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > FRESH_MS) {
    cache.delete(url);
    return undefined;
  }
  return entry.data as T;
}

/**
 * Exécute `fetcher` en garantissant qu'une seule requête part par URL, même si
 * plusieurs appelants la demandent simultanément.
 */
export function dedupe<T>(url: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(url);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((data) => {
      cache.set(url, { data, storedAt: Date.now() });
      return data;
    })
    .finally(() => {
      inFlight.delete(url);
    });

  inFlight.set(url, promise);
  return promise;
}

/** Oublie une URL précise (utilisé par `reload()`). */
export function invalidate(url: string): void {
  cache.delete(url);
}

/** Vide tout : appelé après chaque écriture, et à la déconnexion. */
export function clearCache(): void {
  cache.clear();
}
