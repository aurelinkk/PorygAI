/**
 * Gardes de route. Rappel : ce sont des protections d'affichage ; la vraie
 * autorisation est faite par l'API (401/403).
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
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
