import { useEffect } from 'react';
import { ButtonLink } from '../components/ui/Button';

export function ForbiddenPage() {
  useEffect(() => {
    document.title = "Accès refusé · Poryg'AI";
  }, []);
  return (
    <div className="card message-card">
      <p className="eyebrow mono">403</p>
      <h1 className="page-title">Accès refusé</h1>
      <p>Votre rôle ne permet pas d'accéder à cette page. Contactez l'AI Officer si vous pensez qu'il s'agit d'une erreur.</p>
      <ButtonLink to="/" variant="secondary">
        Retour à l'accueil
      </ButtonLink>
    </div>
  );
}
