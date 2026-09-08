import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ROLE_LABELS, can, type DashboardSummaryDto } from '@poryg/shared';
import { useApi } from '../api/useApi';
import { useUser } from '../auth/AuthContext';
import { ApplicationsTable } from '../components/ApplicationsTable';
import { Alert } from '../components/ui/Alert';
import { StatusPill } from '../components/ui/Badges';
import { ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Kpi } from '../components/ui/Kpi';
import { Loading } from '../components/ui/Loading';
import { firstName, formatEur, formatMonth } from '../lib/format';

export function HomePage() {
  const user = useUser();
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash;
  const { data, error, loading } = useApi<DashboardSummaryDto>('/api/dashboard/summary');

  useEffect(() => {
    document.title = "Accueil · Poryg'AI";
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">{ROLE_LABELS[user.role]}</p>
          <h1 className="page-title">Bonjour, {firstName(user.displayName)}</h1>
        </div>
        {can(user.role, 'application:create') && <ButtonLink to="/applications/nouvelle">Déclarer une app</ButtonLink>}
      </div>

      {flash && <Alert tone="success">{flash}</Alert>}
      {loading && (
        <Loading message="Chargement des indicateurs…" />
      )}
      {error && <Alert tone="error">{error.message}</Alert>}

      {data && (
        <>
          <dl className="kpi-grid">
            <Kpi label="Applications" value={data.applications} hint={`${data.inProgress} en cours d'audit`} />
            <Kpi label="Conformes" value={data.compliant} hint={`${data.nonCompliant} non conforme${data.nonCompliant > 1 ? 's' : ''}`} tone="success" />
            <Kpi label="Coût IA / mois" value={formatEur(data.monthlyCostEur)} hint={formatMonth(data.month)} tone="accent" />
          </dl>

          <div className="home-grid">
            <Card title="Dernières applications" titleId="recent-apps-title">
              <ApplicationsTable applications={data.recent} labelledBy="recent-apps-title" />
            </Card>

            <Card title="Mes évaluations" titleId="my-evaluations-title">
              {data.myEvaluations.length === 0 ? (
                <p className="muted">Rien à traiter pour le moment.</p>
              ) : (
                <ul className="eval-list">
                  {data.myEvaluations.map(({ application, hint }) => (
                    <li key={application.id} className="eval-list__item">
                      <span className="eval-list__name">{application.name}</span>
                      <span className="eval-list__hint mono">{hint}</span>
                      <StatusPill status={application.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
