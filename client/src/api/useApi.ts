/**
 * Hook de lecture : charge `url` au montage et expose { data, error, loading, reload }.
 * Volontairement simple (pas de cache) : suffisant pour des pages qui se chargent une fois.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './client';

interface State<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

export function useApi<T>(url: string) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    api
      .get<T>(url)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error: ApiError) => !cancelled && setState({ data: null, error, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
