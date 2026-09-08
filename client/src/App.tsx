/**
 * Routage de l'application.
 *   /login                    page de connexion (publique)
 *   /                         accueil (connecté)
 *   /applications/nouvelle    déclaration d'une application (permission application:create)
 */
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import { AppShell } from './layout/AppShell';
import { DeclareAppPage } from './pages/DeclareAppPage';
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
      {
        path: 'applications/nouvelle',
        element: (
          <RequirePermission permission="application:create">
            <DeclareAppPage />
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
