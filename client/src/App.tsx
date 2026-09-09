/**
 * Routage de l'application.
 *   /login                    page de connexion (publique)
 *   /                              accueil (connecté)
 *   /applications                  inventaire filtrable
 *   /applications/nouvelle         déclaration (permission application:create)
 *   /applications/:id              fiche détaillée
 *   /applications/:id/modifier     édition (permission application:update + propriétaire)
 *   /applications/:id/evaluation   questionnaire de conformité (permission evaluation:read)
 *   /finops                        rapport FinOps (permission finops:read)
 */
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import { AppShell } from './layout/AppShell';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { DeclareAppPage } from './pages/DeclareAppPage';
import { EditAppPage } from './pages/EditAppPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { FinopsPage } from './pages/FinopsPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'applications', element: <ApplicationsPage /> },
      {
        // Doit précéder 'applications/:id' pour que « nouvelle » ne soit pas pris pour un identifiant.
        path: 'applications/nouvelle',
        element: (
          <RequirePermission permission="application:create">
            <DeclareAppPage />
          </RequirePermission>
        ),
      },
      { path: 'applications/:id', element: <ApplicationDetailPage /> },
      {
        path: 'applications/:id/evaluation',
        element: (
          <RequirePermission permission="evaluation:read">
            <EvaluationPage />
          </RequirePermission>
        ),
      },
      {
        path: 'applications/:id/modifier',
        element: (
          <RequirePermission permission="application:update">
            <EditAppPage />
          </RequirePermission>
        ),
      },
      {
        path: 'finops',
        element: (
          <RequirePermission permission="finops:read">
            <FinopsPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
