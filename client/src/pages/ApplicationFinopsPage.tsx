/**
 * Rapport FinOps d'une application : même lecture que le rapport global, mais
 * ramenée à une seule application, plus deux éléments propres à cette échelle —
 * sa place dans la dépense de l'entreprise, et le détail des saisies.
 */
import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ApplicationDto, ApplicationFinopsDto } from '@poryg/shared';
import { useApi } from '../api/useApi';
import { BreakdownBars } from '../components/BreakdownBars';
import { MonthlyBars } from '../components/MonthlyBars';
import { Alert } from '../components/ui/Alert';
import { StatusPill } from '../components/ui/Badges';
import { ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField } from '../components/ui/Fields';
import { Kpi } from '../components/ui/Kpi';
import { LoadingScreen } from '../components/ui/Loading';
import { formatDateTime, formatEur, formatMonth } from '../lib/format';

const WINDOWS = [
  { value: '6', label: '6 derniers mois' },
  { value: '12', label: '12 derniers mois' },
  { value: '24', label: '24 derniers mois' },
];

interface FinopsResponse {
  report: ApplicationFinopsDto;
  permissions: { edit: boolean };
}

export function ApplicationFinopsPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const months = searchParams.get('months') ?? '12';

  // Les deux requêtes partent ensemble (voir docs/architecture.md § cascades).
  const application = useApi<{ application: ApplicationDto }>(`/api/applications/${id}`);
  const finops = useApi<FinopsResponse>(`/api/applications/${id}/finops?months=${months}`);

  useEffect(() => {
    document.title = "Coûts de l'application · Poryg'AI";
  }, []);

  if ((application.loading && !application.data) || (finops.loading && !finops.data)) {
    return <LoadingScreen message="Calcul du rapport FinOps…" />;
  }
  if (application.error || finops.error || !application.data || !finops.data) {
    return (
      <div className="card message-card">
        <h1 className="page-title">Rapport indisponible</h1>
        <p>{application.error?.message ?? finops.error?.message ?? 'Application introuvable.'}</p>
        <ButtonLink to="/applications" variant="secondary">
          Retour à l'inventaire
        </ButtonLink>
      </div>
    );
  }

  const app = application.data.application;
  const report = finops.data.report;
  const hasData = report.entries.length > 0;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">
            {app.code} · rapport FinOps · {formatMonth(report.currentMonth)}
          </p>
          <h1 className="page-title">{app.name}</h1>
          <p className="finops-subtitle">
            <StatusPill status={app.status} />
            <Link to={`/applications/${id}`}>← Retour à la fiche</Link>
          </p>
        </div>
        <SelectField
          id="months"
          label="Période analysée"
          placeholder=""
          options={WINDOWS}
          value={months}
          onChange={(event) => setSearchParams({ months: event.target.value })}
          className="window-select"
        />
      </div>

      {!hasData && (
        <Alert tone="info">
          Aucun coût n'a encore été saisi pour cette application. Les montants se saisissent depuis la carte
          « Coûts » de <Link to={`/applications/${id}`}>sa fiche</Link>, ou depuis le{' '}
          <Link to="/finops">rapport FinOps global</Link>.
        </Alert>
      )}

      <dl className="kpi-grid">
        <Kpi
          label="Coût du mois"
          value={formatEur(report.currentTotal)}
          hint={formatMonth(report.currentMonth)}
          tone="accent"
        />
        <Kpi
          label="Variation"
          value={
            report.variationPct === null
              ? '—'
              : `${report.variationPct > 0 ? '+' : ''}${report.variationPct.toFixed(1)} %`
          }
          hint={`vs ${formatMonth(report.previousMonth)} · ${formatEur(report.previousTotal)}`}
          tone={report.variationPct !== null && report.variationPct > 0 ? 'default' : 'success'}
        />
        <Kpi
          label="Cumul période"
          value={formatEur(report.windowTotal)}
          hint={`${report.monthly.length} mois`}
        />
      </dl>

      {/* Situer l'application dans la dépense de l'entreprise : c'est ce qui
          transforme un montant brut en information exploitable. */}
      {report.companyTotal > 0 && report.currentTotal > 0 && (
        <Alert tone="info">
          Cette application représente <strong>{(report.shareOfCompany * 100).toFixed(1)} %</strong> de la dépense IA
          de {formatMonth(report.currentMonth)} ({formatEur(report.companyTotal)})
          {report.rank !== null && (
            <>
              , au <strong>{report.rank === 1 ? '1er' : `${report.rank}e`} rang</strong> sur {report.rankedOver}{' '}
              application{report.rankedOver > 1 ? 's' : ''} avec des coûts
            </>
          )}
          .
        </Alert>
      )}

      <div className="finops-grid">
        <Card title="Évolution mensuelle" titleId="app-monthly-title">
          <MonthlyBars months={report.monthly} labelledBy="app-monthly-title" />
        </Card>

        <Card title="Par source" titleId="app-source-title">
          <p className="field__hint">
            Les coûts s'additionnent par source : import automatique et saisie manuelle coexistent.
          </p>
          <BreakdownBars
            labelledBy="app-source-title"
            header="Source"
            items={report.bySource.map((row) => ({
              key: row.key,
              label: row.label,
              amountEur: row.amountEur,
              share: row.share,
            }))}
            emptyMessage="Aucun coût sur la période."
          />
        </Card>
      </div>

      <Card title="Détail des saisies" titleId="app-entries-title" className="finops-card">
        {report.entries.length === 0 ? (
          <p className="muted">Aucune saisie enregistrée.</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="group" aria-labelledby="app-entries-title">
            <table className="table" aria-labelledby="app-entries-title">
              <thead>
                <tr>
                  <th scope="col">Mois</th>
                  <th scope="col">Montant</th>
                  <th scope="col">Source</th>
                  <th scope="col">Saisi par</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row" className="mono">
                      {entry.periodMonth}
                    </th>
                    <td className="mono">{formatEur(entry.amountEur)}</td>
                    <td>{entry.source}</td>
                    <td>
                      {entry.createdBy?.displayName ?? <span className="muted">Système</span>}
                      <span className="table__meta mono">{formatDateTime(entry.createdAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="back-link">
        <ButtonLink to="/finops" variant="ghost" small>
          Voir le rapport FinOps global
        </ButtonLink>
      </p>
    </>
  );
}
