import { useEffect } from 'react';
import { ButtonLink } from '../components/ui/Button';

export function NotFoundPage() {
  useEffect(() => {
    document.title = "Page introuvable · Poryg'AI";
  }, []);
  return (
    <div className="card message-card">
      <p className="eyebrow mono">404</p>
      <h1 className="page-title">Page introuvable</h1>
      <p>Cette adresse ne correspond à aucune page de Poryg'AI.</p>
      <ButtonLink to="/" variant="secondary">
        Retour à l'accueil
      </ButtonLink>
    </div>
  );
}
