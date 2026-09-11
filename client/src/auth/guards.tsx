/**
 * Gardes de route. Rappel : ce sont des protections d'affichage ; la vraie
 * autorisation est faite par l'API (401 / 403).
 */
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { can, type Permission } from '@poryg/shared';
import { LoadingScreen } from '../components/ui/Loading';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <LoadingScreen message="Ouverture de votre session…" />
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !can(user.role, permission)) return <ForbiddenPage />;
  return children;
}

/**
 * Tout le registre appartient à une organisation : sans organisation active,
 * l'API refuse (403 NO_ORGANIZATION) et il n'y aurait rien à afficher. On
 * renvoie donc vers « Mes organisations », d'où l'on peut en créer une.
 *
 * Route de mise en page (sans chemin) : elle rend `<Outlet />`, ce qui évite
 * d'envelopper une à une les routes qu'elle protège.
 */
export function RequireOrganization() {
  const { user } = useAuth();
  if (user && user.organizationId === null) return <Navigate to="/organisations" replace />;
  return <Outlet />;
}
