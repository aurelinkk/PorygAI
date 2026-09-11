/**
 * État d'authentification global : l'utilisateur courant (ou null), les
 * organisations dont il est membre, et les actions login / logout / bascule.
 *
 * Au démarrage, on interroge /api/auth/me pour restaurer la session existante
 * (le cookie est httpOnly, le JS ne peut pas le lire).
 *
 * **Le rôle dépend de l'organisation active** : `user.role` est le rôle tenu
 * dans `user.organizationId`, et il change quand on bascule. C'est le serveur
 * qui mémorise ce choix (dans la session) et qui renvoie le profil recalculé :
 * le client se contente de l'afficher, il ne décide de rien.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OrganizationDto, UserDto } from '@poryg/shared';
import { clearCache, dedupe } from '../api/cache';
import { api, UNAUTHENTICATED_EVENT } from '../api/client';

/** Réponse commune à /api/auth/me et /api/auth/login. */
interface Profile {
  user: UserDto | null;
  organizations: OrganizationDto[];
}

interface AuthState {
  user: UserDto | null;
  /** Toutes mes organisations, dans l'ordre d'adhésion. */
  organizations: OrganizationDto[];
  /** Celle qui est active, ou `null` si je n'appartiens à aucune. */
  organization: OrganizationDto | null;
  /** 'loading' tant que /me n'a pas répondu (évite un flash de la page de login) */
  status: 'loading' | 'ready';
  login: (email: string, password: string) => Promise<UserDto>;
  logout: () => Promise<void>;
  /** Bascule l'organisation active. Le rôle renvoyé peut être différent. */
  switchOrganization: (organizationId: number) => Promise<UserDto>;
  /** Relit le profil : après création d'organisation, import, changement de formule. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationDto[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    // `dedupe` : sans lui, le double montage de StrictMode enverrait deux
    // requêtes /me au démarrage.
    dedupe('/api/auth/me', () => api.get<Profile>('/api/auth/me'))
      .then((profile) => {
        setUser(profile.user);
        setOrganizations(profile.organizations);
      })
      .catch(() => setUser(null))
      .finally(() => setStatus('ready'));
  }, []);

  // Session expirée côté serveur pendant la navigation → retour à l'écran de connexion.
  useEffect(() => {
    const onUnauthenticated = () => {
      setUser(null);
      setOrganizations([]);
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const profile = await api.post<Profile>('/api/auth/login', { email, password });
    setUser(profile.user);
    setOrganizations(profile.organizations);
    return profile.user!;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      setOrganizations([]);
      // Rien du compte précédent ne doit rester en mémoire pour le suivant.
      clearCache();
    }
  }, []);

  const refresh = useCallback(async () => {
    const profile = await api.get<Profile>('/api/auth/me');
    setUser(profile.user);
    setOrganizations(profile.organizations);
  }, []);

  const switchOrganization = useCallback(async (organizationId: number) => {
    const response = await api.post<{ organization: OrganizationDto; user: UserDto }>(
      `/api/organizations/${organizationId}/activate`,
    );
    // `api.post` vide déjà le cache de lecture : les données de l'organisation
    // précédente ne doivent surtout pas être resservies sous la nouvelle.
    setUser(response.user);
    await refresh();
    return response.user;
  }, [refresh]);

  const organization = useMemo(
    () => organizations.find((item) => item.id === user?.organizationId) ?? null,
    [organizations, user?.organizationId],
  );

  const value = useMemo(
    () => ({ user, organizations, organization, status, login, logout, switchOrganization, refresh }),
    [user, organizations, organization, status, login, logout, switchOrganization, refresh],
  );
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

/** Dans une zone protégée par <RequireOrganization>, l'organisation est garantie. */
export function useOrganization(): OrganizationDto {
  const { organization } = useAuth();
  if (!organization) throw new Error('useOrganization appelé hors zone à organisation');
  return organization;
}
