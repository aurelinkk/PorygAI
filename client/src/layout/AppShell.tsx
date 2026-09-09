/**
 * Gabarit des pages connectées : lien d'évitement, en-tête (logo, navigation
 * selon le rôle, utilisateur), zone principale, pied de page.
 * À chaque changement de page, le focus est replacé sur <main>.
 */
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { can } from '@poryg/shared';
import { useAuth, useUser } from '../auth/AuthContext';
import { RoleBadge } from '../components/ui/Badges';
import { Button } from '../components/ui/Button';

export function AppShell() {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);

  // Focus sur <main> uniquement lors d'un vrai changement de page (pas au chargement initial).
  // On compare au chemin précédent plutôt qu'un drapeau "premier rendu" : robuste au double
  // appel des effets en StrictMode.
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    mainRef.current?.focus();
  }, [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Aller au contenu principal
      </a>

      <header className="app-header">
        <div className="container app-header__inner">
          <Link to="/" className="brand">
            <img src="/logo-96.png" alt="" width={40} height={40} className="brand__logo" />
            <span className="brand__name">Poryg'AI</span>
          </Link>

          <nav aria-label="Navigation principale">
            <ul className="nav">
              <li>
                <NavLink to="/" end className="nav__link">
                  Accueil
                </NavLink>
              </li>
              <li>
                {/* `end` absent : le lien reste actif sur les fiches et le formulaire. */}
                <NavLink to="/applications" className="nav__link">
                  Inventaire
                </NavLink>
              </li>
              <li>
                <NavLink to="/tableaux-de-bord" className="nav__link">
                  Tableaux de bord
                </NavLink>
              </li>
              {can(user.role, 'finops:read') && (
                <li>
                  <NavLink to="/finops" className="nav__link">
                    FinOps
                  </NavLink>
                </li>
              )}
              {can(user.role, 'application:create') && (
                <li>
                  <NavLink to="/applications/nouvelle" className="nav__link">
                    Déclarer une app
                  </NavLink>
                </li>
              )}
            </ul>
          </nav>

          <div className="user-menu">
            <span className="user-menu__name">{user.displayName}</span>
            <RoleBadge role={user.role} />
            <Button variant="ghost" small onClick={handleLogout}>
              Se déconnecter
            </Button>
          </div>
        </div>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className="container app-main">
        <Outlet />
      </main>

      <footer className="container app-footer">
        <span className="mono">Poryg'AI · v0.1 · registre des applications IA</span>
      </footer>
    </>
  );
}
