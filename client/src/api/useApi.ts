/**
 * Hook de lecture : charge `url` au montage et expose { data, error, loading, reload }.
 *
 * S'appuie sur `api/cache.ts` : une URL déjà chargée récemment s'affiche sans
 * requête ni écran d'attente, et deux demandes simultanées de la même URL ne
 * partent qu'une fois (ce qui neutralise le double montage de StrictMode).
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './client';
import { dedupe, invalidate, readCache } from './cache';

interface State<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

/**
 * Résultat de `useApi`. Type exporté pour qu'une page puisse lancer une requête
 * et en passer le résultat à un sous-composant : c'est ce qui permet de faire
 * partir plusieurs requêtes en parallèle plutôt qu'en cascade.
 */
export interface ApiQuery<T> extends State<T> {
  reload: () => void;
}

/**
 * `url` peut être vide ou `null` : la requête n'est alors pas lancée. Cela permet
 * à un composant de conditionner un chargement (« charge les coûts seulement
 * quand une application est choisie ») sans enfreindre les règles des hooks.
 */
export function useApi<T>(url: string | null): ApiQuery<T> {
  // Une donnée déjà en cache est affichée d'emblée : pas de scintillement.
  const [state, setState] = useState<State<T>>(() => {
    const cached = url ? readCache<T>(url) : undefined;
    return { data: cached ?? null, error: null, loading: Boolean(url) && cached === undefined };
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!url) {
      setState({ data: null, error: null, loading: false });
      return;
    }

    const cached = version === 0 ? readCache<T>(url) : undefined;
    if (cached !== undefined) {
      setState({ data: cached, error: null, loading: false });
      return;
    }

    setState((previous) => ({ ...previous, loading: true, error: null }));
    dedupe(url, () => api.get<T>(url))
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((error: ApiError) => {
        if (!cancelled) setState({ data: null, error, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [url, version]);

  /** Force un rechargement en ignorant le cache. */
  const reload = useCallback(() => {
    if (url) invalidate(url);
    setVersion((current) => current + 1);
  }, [url]);

  return { ...state, reload };
}
