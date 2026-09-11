/**
 * Gabarit des pages connectées : lien d'évitement, en-tête (logo, sélecteur
 * d'organisation, navigation selon le rôle, utilisateur), zone principale, pied
 * de page. À chaque changement de page, le focus est replacé sur <main>.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PLAN_LABELS, can } from '@poryg/shared';
import { useAuth, useUser } from '../auth/AuthContext';
import { RoleBadge } from '../components/ui/Badges';
import { Button } from '../components/ui/Button';

export function AppShell() {
  const user = useUser();
  const { logout, organizations, organization, switchOrganization } = useAuth();
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

          <OrganizationSwitch />

          {organization && (
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
                <li>
                  <NavLink to="/organisation" className="nav__link">
                    Organisation
                  </NavLink>
                </li>
              </ul>
            </nav>
          )}

          <div className="user-menu">
            <span className="user-menu__name">{user.displayName}</span>
            {organization && <RoleBadge role={user.role} />}
            <Button variant="ghost" small onClick={handleLogout}>
              Se déconnecter
            </Button>
          </div>
        </div>
      </header>

      {/*
        `key` : changer d'organisation remonte toute la zone de contenu. Sans
        cela, une page déjà affichée garderait à l'écran les données de
        l'organisation précédente (le cache est vidé, mais rien ne redemanderait).
      */}
      <main id="main" ref={mainRef} tabIndex={-1} className="container app-main" key={organization?.id ?? 'sans-organisation'}>
        <Outlet />
      </main>

      <footer className="container app-footer">
        <span className="mono">Poryg'AI · v0.1 · registre des applications IA</span>
      </footer>
    </>
  );

  /**
   * Sélecteur d'organisation. Une seule organisation : son nom, sans menu à
   * ouvrir pour rien. Plusieurs : un `<select>` natif, qui gère seul le clavier,
   * le tactile et les lecteurs d'écran.
   */
  function OrganizationSwitch() {
    const [switching, setSwitching] = useState(false);

    if (!organization) {
      return (
        <p className="org-switch org-switch--empty">
          <Link to="/organisations">Ajouter mon organisation</Link>
        </p>
      );
    }

    async function handleChange(value: string) {
      const id = Number(value);
      if (id === organization!.id) return;
      setSwitching(true);
      try {
        await switchOrganization(id);
        // On ne reste pas sur une fiche qui appartenait à l'organisation quittée.
        navigate('/');
      } finally {
        setSwitching(false);
      }
    }

    return (
      <div className="org-switch">
        {organizations.length > 1 ? (
          <>
            <label htmlFor="org-switch" className="org-switch__label">
              Organisation
            </label>
            <select
              id="org-switch"
              className="org-switch__select"
              value={organization.id}
              disabled={switching}
              onChange={(event) => handleChange(event.target.value)}
            >
              {organizations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="org-switch__single">{organization.name}</span>
        )}
        <span className={`plan-badge plan-badge--${organization.plan}`}>{PLAN_LABELS[organization.plan]}</span>
      </div>
    );
  }
}
