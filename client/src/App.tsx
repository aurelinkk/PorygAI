/**
 * Routage de l'application.
 *   /login                         page de connexion (publique)
 *   /organisations                 mes organisations + création (sans organisation active)
 *   /organisations/nouvelle        créer mon organisation
 *   /organisation                  fiche de l'organisation active : formule, membres
 *   /organisation/import           import de comptes (permission organization:members)
 *   /                              accueil (connecté)
 *   /applications                  inventaire filtrable
 *   /applications/nouvelle         déclaration (permission application:create)
 *   /applications/:id              fiche détaillée
 *   /applications/:id/modifier     édition (permission application:update + propriétaire)
 *   /applications/:id/evaluation   questionnaire de conformité (permission evaluation:read)
 *   /applications/:id/finops       rapport FinOps de l'application (permission finops:read)
 *   /finops                        rapport FinOps (permission finops:read)
 */
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequireOrganization, RequirePermission } from './auth/guards';
import { AppShell } from './layout/AppShell';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage';
import { ApplicationFinopsPage } from './pages/ApplicationFinopsPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { DeclareAppPage } from './pages/DeclareAppPage';
import { EditAppPage } from './pages/EditAppPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { EvaluationReportPage } from './pages/EvaluationReportPage';
import { DashboardsPage } from './pages/DashboardsPage';
import { FinopsPage } from './pages/FinopsPage';
import { HomePage } from './pages/HomePage';
import { CreateOrganizationPage } from './pages/CreateOrganizationPage';
import { ImportMembersPage } from './pages/ImportMembersPage';
import { OrganizationPage } from './pages/OrganizationPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
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
      // Hors périmètre d'une organisation : accessibles même sans en avoir,
      // sans quoi un compte neuf n'aurait aucun moyen d'entrer.
      { path: 'organisations', element: <OrganizationsPage /> },
      { path: 'organisations/nouvelle', element: <CreateOrganizationPage /> },

      // Tout le reste appartient à une organisation : sans organisation
      // active, l'API refuse (403 NO_ORGANIZATION) et il n'y a rien à montrer.
      {
        element: <RequireOrganization />,
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
        path: 'applications/:id/finops',
        element: (
          <RequirePermission permission="finops:read">
            <ApplicationFinopsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'applications/:id/evaluation',
        element: (
          <RequirePermission permission="evaluation:read">
            <EvaluationPage />
          </RequirePermission>
        ),
      },
      {
        path: 'applications/:id/rapport',
        element: (
          <RequirePermission permission="evaluation:read">
            <EvaluationReportPage />
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
      // `dashboard:read` est ouvert à tous les rôles : pas de garde ici, la page
      // s'adapte (le coût n'est renvoyé qu'à ceux qui ont `finops:read`).
      { path: 'tableaux-de-bord', element: <DashboardsPage /> },
      {
        path: 'finops',
        element: (
          <RequirePermission permission="finops:read">
            <FinopsPage />
          </RequirePermission>
        ),
      },
      { path: 'organisation', element: <OrganizationPage /> },
      {
        path: 'organisation/import',
        element: (
          <RequirePermission permission="organization:members">
            <ImportMembersPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
        ],
      },
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
