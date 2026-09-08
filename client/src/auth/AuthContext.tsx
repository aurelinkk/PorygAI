/**
 * État d'authentification global : l'utilisateur courant (ou null) et les
 * actions login/logout. Au démarrage, on interroge /api/auth/me pour restaurer
 * la session existante (le cookie est httpOnly, le JS ne peut pas le lire).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserDto } from '@poryg/shared';
import { clearCache, dedupe } from '../api/cache';
import { api, UNAUTHENTICATED_EVENT } from '../api/client';

interface AuthState {
  user: UserDto | null;
  /** 'loading' tant que /me n'a pas répondu (évite un flash de la page de login) */
  status: 'loading' | 'ready';
  login: (email: string, password: string) => Promise<UserDto>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    // `dedupe` : sans lui, le double montage de StrictMode enverrait deux
    // requêtes /me au démarrage.
    dedupe('/api/auth/me', () => api.get<{ user: UserDto }>('/api/auth/me'))
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setStatus('ready'));
  }, []);

  // Session expirée côté serveur pendant la navigation → retour à l'écran de connexion.
  useEffect(() => {
    const onUnauthenticated = () => setUser(null);
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.post<{ user: UserDto }>('/api/auth/login', { email, password });
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      // Rien du compte précédent ne doit rester en mémoire pour le suivant.
      clearCache();
    }
  }, []);

  const value = useMemo(() => ({ user, status, login, logout }), [user, status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé sous <AuthProvider>');
  return context;
}

/** Dans une zone protégée par <RequireAuth>, l'utilisateur est garanti non nul. */
export function useUser(): UserDto {
  const { user } = useAuth();
  if (!user) throw new Error('useUser appelé hors zone authentifiée');
  return user;
}
