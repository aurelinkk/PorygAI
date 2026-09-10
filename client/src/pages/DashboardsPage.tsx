/**
 * Tableaux de bord BI : historique et utilisation du parc (lot 6).
 *
 * Le rapport FinOps répond « combien ça coûte ». Cette page répond « où en est le
 * parc, comment il évolue, et où ça coince » : historique des décisions, forme du
 * parc, thèmes du questionnaire les plus faibles, échéances de conformité,
 * activité de la plateforme.
 *
 * Tout est calculé par le serveur (`/api/dashboard/bi`) : la page n'agrège rien,
 * elle met en forme. La profondeur d'historique est dans l'URL (`?months=12`),
 * ce qui rend une vue partageable telle quelle.
 */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BiReportDto } from '@poryg/shared';
import { useApi } from '../api/useApi';
import { BreakdownBars } from '../components/BreakdownBars';
import { HistoryChart } from '../components/HistoryChart';
import { MonthlyBars } from '../components/MonthlyBars';
import { Alert } from '../components/ui/Alert';
import { StatusPill } from '../components/ui/Badges';
import { ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField } from '../components/ui/Fields';
import { Kpi } from '../components/ui/Kpi';
import { Loading } from '../components/ui/Loading';
import { formatDate, formatEur, formatMonth } from '../lib/format';

const WINDOWS = [
  { value: '6', label: '6 derniers mois' },
  { value: '12', label: '12 derniers mois' },
  { value: '24', label: '24 derniers mois' },
];

/** Un nombre d'éléments, pour les barres de répartition (qui affichent des euros par défaut). */
const asCount = (value: number) => String(value);

export function DashboardsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const months = searchParams.get('months') ?? '12';
  const { data, error, loading } = useApi<{ report: BiReportDto }>(`/api/dashboard/bi?months=${months}`);

  useEffect(() => {
    document.title = "Tableaux de bord · Poryg'AI";
  }, []);

  if (loading && !data) return <Loading message="Calcul des tableaux de bord…" />;
  if (error || !data) {
    return (
      <div className="card message-card">
        <h1 className="page-title">Tableaux de bord indisponibles</h1>
        <p>{error?.message ?? 'Impossible de charger les indicateurs.'}</p>
      </div>
    );
  }

  const report = data.report;
  const { portfolio, quality, actions, compliance, activity } = report;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">Historique · {report.months} mois</p>
          <h1 className="page-title">Tableaux de bord</h1>
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

      <dl className="kpi-grid">
        <Kpi
          label="Applications suivies"
          value={portfolio.total}
          hint="hors supprimées"
          to="/applications"
          linkLabel="voir l'inventaire"
        />
        <Kpi
          label="Taux de conformité"
          value={portfolio.complianceRate === null ? ':' : `${Math.round(portfolio.complianceRate * 100)} %`}
          hint="des applications évaluées"
          tone="success"
        />
        <Kpi
          label="Score moyen"
          value={quality.averageScore === null ? ':' : `${quality.averageScore}/100`}
          hint={`${quality.submitted} évaluation${quality.submitted > 1 ? 's' : ''} sur la période`}
        />
        <Kpi
          label="Actions ouvertes"
          value={actions.open}
          hint={`${actions.done} terminée${actions.done > 1 ? 's' : ''}${actions.overdue > 0 ? ` · ${actions.overdue} en retard` : ''}`}
          tone={actions.overdue > 0 ? 'accent' : 'default'}
        />
        {report.monthlyCostEur !== null && (
          <Kpi
            label="Coût IA / mois"
            value={formatEur(report.monthlyCostEur)}
            hint={formatMonth(report.currentMonth)}
            tone="accent"
            to="/finops"
            linkLabel="voir le rapport FinOps"
          />
        )}
      </dl>

      {compliance.expiringSoon.length > 0 && (
        <Alert tone="warning">
          <strong>
            {compliance.expiringSoon.length} conformité{compliance.expiringSoon.length > 1 ? 's' : ''}
          </strong>{' '}
          arrive{compliance.expiringSoon.length > 1 ? 'nt' : ''} à échéance dans les trois mois. Passé la date,
          l'application repasse automatiquement en audit.
        </Alert>
      )}

      <Card title="Historique des décisions" titleId="history-title" className="finops-card">
        <p className="muted">
          Applications déclarées et évaluations soumises, mois par mois. Une évaluation refusée (pratique
          interdite, usage militaire) compte comme non conforme.
        </p>
        <HistoryChart history={report.history} labelledBy="history-title" />
      </Card>

      <div className="finops-grid">
        <Card title="Par statut de conformité" titleId="bi-status-title">
          <BreakdownBars
            labelledBy="bi-status-title"
            header="Statut"
            valueHeader="Applications"
            formatValue={asCount}
            items={portfolio.byStatus.map((row) => ({
              key: row.key,
              label: <StatusPill status={row.key as never} />,
              value: row.count,
              share: row.share,
              tone: row.key,
            }))}
          />
        </Card>

        <Card title="Par sensibilité des données" titleId="bi-sensitivity-title">
          <BreakdownBars
            labelledBy="bi-sensitivity-title"
            header="Sensibilité"
            valueHeader="Applications"
            formatValue={asCount}
            items={portfolio.bySensitivity.map((row) => ({
              key: row.key,
              label: row.label,
              value: row.count,
              share: row.share,
            }))}
          />
        </Card>
      </div>

      <div className="finops-grid">
        <Card title="Par domaine métier" titleId="bi-domain-title">
          <BreakdownBars
            labelledBy="bi-domain-title"
            header="Domaine"
            valueHeader="Applications"
            formatValue={asCount}
            items={portfolio.byDomain.map((row) => ({
              key: row.key,
              label: row.label,
              value: row.count,
              share: row.share,
            }))}
          />
        </Card>

        <Card title="Par type d'IA" titleId="bi-aitype-title">
          <BreakdownBars
            labelledBy="bi-aitype-title"
            header="Type"
            valueHeader="Applications"
            formatValue={asCount}
            items={portfolio.byAiType.map((row) => ({
              key: row.key,
              label: row.label,
              value: row.count,
              share: row.share,
            }))}
          />
        </Card>
      </div>

      <div className="finops-grid">
        <Card title="Thèmes les plus faibles" titleId="bi-weak-title">
          <p className="muted">
            Moyenne des sous-scores par thème du questionnaire, sur les évaluations soumises pendant la
            période. C'est là que le parc perd le plus de points.
          </p>
          {quality.weakestSections.length === 0 ? (
            <p className="muted">Aucune évaluation soumise sur la période.</p>
          ) : (
            <ul className="section-bars">
              {quality.weakestSections.map((section) => (
                <li key={section.code} className="section-bar">
                  <span className="section-bar__label">{section.label}</span>
                  <span className="section-bar__value mono">
                    {section.averageScore} % · {section.evaluations} éval.
                  </span>
                  <span className="section-bar__track" aria-hidden="true">
                    <span className="section-bar__fill" style={{ width: `${section.averageScore}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Questions les plus souvent manquées" titleId="bi-gaps-title">
          <p className="muted">Réponses « Non » les plus fréquentes : les sujets à traiter en priorité.</p>
          {quality.topGaps.length === 0 ? (
            <p className="muted">Aucune réponse « Non » enregistrée sur la période.</p>
          ) : (
            <ol className="gap-list">
              {quality.topGaps.map((gap) => (
                <li key={gap.code} className="gap-list__item">
                  <span className="gap-list__count mono">
                    ×{gap.missed}
                  </span>
                  <span>
                    <span className="mono table__meta">{gap.code}</span> {gap.wording}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Échéances de conformité" titleId="bi-expiry-title" className="finops-card">
        <p className="muted">
          Une conformité vaut douze mois. Passé ce délai, l'application repasse d'elle-même en audit :
          {compliance.expired > 0
            ? ` ${compliance.expired} l'${compliance.expired > 1 ? 'ont' : 'a'} déjà fait sur la période.`
            : " aucune ne l'a fait sur la période."}
        </p>
        {compliance.expiringSoon.length === 0 ? (
          <p className="muted">Aucune conformité n'arrive à échéance dans les trois mois.</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="group" aria-labelledby="bi-expiry-title">
            <table className="table" aria-labelledby="bi-expiry-title">
              <thead>
                <tr>
                  <th scope="col">Application</th>
                  <th scope="col">Échéance</th>
                  <th scope="col">Reste</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {compliance.expiringSoon.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <span className="mono table__meta">{row.code}</span> {row.name}
                    </th>
                    <td>{formatDate(row.validUntil)}</td>
                    <td className="mono">
                      {row.daysLeft <= 0 ? 'dépassée' : `${row.daysLeft} jour${row.daysLeft > 1 ? 's' : ''}`}
                    </td>
                    <td>
                      <ButtonLink to={`/applications/${row.id}`} variant="ghost" small>
                        Ouvrir<span className="visually-hidden"> la fiche de {row.name}</span>
                      </ButtonLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Activité de la plateforme" titleId="bi-activity-title" className="finops-card">
        <p className="muted">
          Événements enregistrés dans le journal d'audit : déclarations, modifications, évaluations,
          suppressions. {activity.activeUsers} personne{activity.activeUsers > 1 ? 's' : ''} y ont contribué sur
          la période. Poryg'AI ne mesure pas l'usage des outils d'IA eux-mêmes : aucune télémétrie n'est
          collectée sur les applications inventoriées.
        </p>
        <MonthlyBars
          months={activity.byMonth.map((entry) => ({ month: entry.month, value: entry.events }))}
          labelledBy="bi-activity-title"
          caption="Événements par mois"
          valueHeader="Événements"
          formatValue={asCount}
        />

        <h3 className="subsection-title">Par type d'événement</h3>
        <BreakdownBars
          labelledBy="bi-activity-title"
          header="Type d'événement"
          valueHeader="Événements"
          formatValue={asCount}
          items={activity.byAction.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.count,
            share: row.share,
          }))}
          emptyMessage="Aucune activité enregistrée sur la période."
        />
      </Card>
    </>
  );
}
