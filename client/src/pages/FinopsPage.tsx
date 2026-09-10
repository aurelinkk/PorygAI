/**
 * Rapport FinOps responsable : coût, énergie et carbone du parc.
 *
 * Le FinOps classique optimise une facture ; appliqué à l'IA responsable, il
 * arbitre entre trois grandeurs. La page suit les trois principes du FinOps :
 *
 *  - **Visibilité** : le triptyque du mois, son évolution, et la couverture de la
 *    donnée : sans saisie, le rapport ment par omission.
 *  - **Responsabilité** : la dépense par statut de conformité, par domaine et par
 *    application : chaque euro est rattaché à quelqu'un.
 *  - **Optimisation continue** : les leviers, croisés avec le thème « Frugalité »
 *    du questionnaire : ce qui coûte cher ET qui est mal noté.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CO2_KG_PER_KWH, FINOPS_REFERENTIELS, can, estimateCo2, saveCostSchema,
  type ApplicationCostDto, type ApplicationDto, type FinopsBreakdownRow, type FinopsReportDto,
} from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/useApi';
import { useUser } from '../auth/AuthContext';
import { BreakdownBars } from '../components/BreakdownBars';
import { ExistingCostNotice } from '../components/CostEntry';
import { MonthlyBars } from '../components/MonthlyBars';
import { FinopsLevers } from '../components/FinopsLevers';
import { Alert, FormErrorSummary } from '../components/ui/Alert';
import { StatusPill } from '../components/ui/Badges';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField, TextField } from '../components/ui/Fields';
import { Kpi } from '../components/ui/Kpi';
import { Loading } from '../components/ui/Loading';
import { formatCo2, formatEur, formatKwh, formatMonth } from '../lib/format';
import { focusField, zodFieldErrors, type FieldErrors } from '../lib/forms';

const WINDOWS = [
  { value: '6', label: '6 derniers mois' },
  { value: '12', label: '12 derniers mois' },
  { value: '24', label: '24 derniers mois' },
];

const COST_LABELS: Record<string, string> = {
  applicationId: 'Application',
  periodMonth: 'Mois',
  amountEur: 'Montant',
  energyKwh: 'Énergie',
  co2Kg: 'Empreinte carbone',
};

/** Les trois grandeurs suivies, et comment les afficher. */
const MEASURES = {
  cost: { label: 'Coût', unit: 'Coût', pick: (m: MonthlyEntry) => m.amountEur, format: formatEur },
  energy: { label: 'Énergie', unit: 'Énergie', pick: (m: MonthlyEntry) => m.energyKwh, format: formatKwh },
  co2: { label: 'Carbone', unit: 'Empreinte', pick: (m: MonthlyEntry) => m.co2Kg, format: formatCo2 },
} as const;
type Measure = keyof typeof MEASURES;
type MonthlyEntry = FinopsReportDto['monthly'][number];

/** Sous-titre d'une ligne de répartition : combien d'applications, et leur empreinte. */
function footprintHint(row: FinopsBreakdownRow): string {
  const apps = `${row.applications} application${row.applications > 1 ? 's' : ''}`;
  return row.energyKwh > 0 ? `${apps} · ${formatKwh(row.energyKwh)} · ${formatCo2(row.co2Kg)}` : apps;
}

export function FinopsPage() {
  const user = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const months = searchParams.get('months') ?? '6';
  const [measure, setMeasure] = useState<Measure>('cost');

  const { data, error, loading, reload } = useApi<{ report: FinopsReportDto }>(`/api/finops/report?months=${months}`);

  useEffect(() => {
    document.title = "FinOps · Poryg'AI";
  }, []);

  // Seulement au premier chargement : un rechargement après saisie ne doit pas
  // démonter la page (le formulaire perdrait son contenu).
  if (loading && !data) return <Loading message="Calcul du rapport FinOps…" />;
  if (error || !data) {
    return (
      <div className="card message-card">
        <h1 className="page-title">Rapport indisponible</h1>
        <p>{error?.message ?? 'Impossible de charger le rapport.'}</p>
      </div>
    );
  }

  const report = data.report;
  const nonCompliantCost = report.byStatus
    .filter((row) => ['non_compliant', 'partially_compliant', 'in_progress'].includes(row.key))
    .reduce((sum, row) => sum + row.amountEur, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">Rapport · {formatMonth(report.currentMonth)}</p>
          <h1 className="page-title">FinOps</h1>
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
          label="Coût du mois"
          value={formatEur(report.currentTotal)}
          hint={formatMonth(report.currentMonth)}
          tone="accent"
        />
        <Kpi
          label="Variation"
          value={
            report.variationPct === null ? ':' : `${report.variationPct > 0 ? '+' : ''}${report.variationPct.toFixed(1)} %`
          }
          hint={`vs ${formatMonth(report.previousMonth)} · ${formatEur(report.previousTotal)}`}
          tone={report.variationPct !== null && report.variationPct > 0 ? 'default' : 'success'}
        />
        <Kpi
          label="Énergie du mois"
          value={report.current.energyKwh > 0 ? formatKwh(report.current.energyKwh) : ':'}
          hint={
            report.current.energyKwh > 0
              ? `${formatKwh(report.window.energyKwh)} sur ${report.monthly.length} mois`
              : 'aucune consommation déclarée'
          }
        />
        <Kpi
          label="Empreinte du mois"
          value={report.current.co2Kg > 0 ? formatCo2(report.current.co2Kg) : ':'}
          hint={
            report.current.co2Kg > 0
              ? `${formatCo2(report.window.co2Kg)} sur ${report.monthly.length} mois`
              : 'aucune empreinte déclarée'
          }
          tone={report.current.co2Kg > 0 ? 'accent' : 'default'}
        />
        <Kpi
          label="Cumul période"
          value={formatEur(report.windowTotal)}
          hint={`${report.monthly.length} mois`}
        />
      </dl>

      {nonCompliantCost > 0 && (
        <Alert tone="warning">
          <strong>{formatEur(nonCompliantCost)}</strong> ce mois-ci sur des applications non validées pour la
          production (non conformes, en test ou en cours d'audit), soit {((nonCompliantCost / (report.currentTotal || 1)) * 100).toFixed(0)} %
          de la dépense IA.
        </Alert>
      )}

      <div className="finops-grid">
        <Card
          title="Évolution mensuelle"
          titleId="monthly-title"
          actions={
            <div className="measure-switch" role="group" aria-label="Grandeur affichée">
              {(Object.keys(MEASURES) as Measure[]).map((key) => (
                <Button
                  key={key}
                  small
                  variant={measure === key ? 'secondary' : 'ghost'}
                  aria-pressed={measure === key}
                  onClick={() => setMeasure(key)}
                >
                  {MEASURES[key].label}
                </Button>
              ))}
            </div>
          }
        >
          <MonthlyBars
            months={report.monthly.map((entry) => ({ month: entry.month, value: MEASURES[measure].pick(entry) }))}
            labelledBy="monthly-title"
            caption={`${MEASURES[measure].unit} mensuel`}
            valueHeader={MEASURES[measure].unit}
            formatValue={MEASURES[measure].format}
          />
        </Card>

        <Card title="Par statut de conformité" titleId="status-title">
          <BreakdownBars
            labelledBy="status-title"
            header="Statut"
            items={report.byStatus.map((row) => ({
              key: row.key,
              label: <StatusPill status={row.key as never} />,
              value: row.amountEur,
              share: row.share,
              hint: footprintHint(row),
              tone: row.key,
            }))}
          />
        </Card>
      </div>

      <Card title="Par domaine métier" titleId="domain-title" className="finops-card">
        <BreakdownBars
          labelledBy="domain-title"
          header="Domaine"
          items={report.byDomain.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.amountEur,
            share: row.share,
            hint: footprintHint(row),
          }))}
        />
      </Card>

      <Card title="Applications les plus coûteuses" titleId="apps-title" className="finops-card">
        <BreakdownBars
          labelledBy="apps-title"
          header="Application"
          items={report.byApplication.map((row) => ({
            key: row.key,
            // Sur un rapport FinOps, le nom mène au rapport de l'application ;
            // le code, lui, ramène à sa fiche.
            label: <Link to={`/applications/${row.applicationId}/finops`}>{row.label}</Link>,
            value: row.amountEur,
            share: row.share,
            hint: (
              <>
                <Link to={`/applications/${row.applicationId}`}>{row.code}</Link>
                {row.energyKwh > 0 && ` · ${formatKwh(row.energyKwh)} · ${formatCo2(row.co2Kg)}`}
              </>
            ),
            tone: row.status,
          }))}
        />
      </Card>

      <Card title="Couverture de la donnée" titleId="coverage-title" className="finops-card">
        <p className="muted">
          Premier principe du FinOps : ce qui n'est pas mesuré ne peut pas être arbitré.
        </p>
        <p>
          <strong className="mono">
            {report.coverage.withCost}/{report.coverage.total}
          </strong>{' '}
          application{report.coverage.total > 1 ? 's' : ''} active{report.coverage.total > 1 ? 's' : ''} ont un coût
          saisi pour {formatMonth(report.currentMonth)}, et{' '}
          <strong className="mono">
            {report.coverage.withFootprint}/{report.coverage.total}
          </strong>{' '}
          déclarent leur consommation d'énergie.
        </p>
        {report.coverage.missing.length === 0 ? (
          <p className="muted">Aucune donnée manquante : le rapport est complet.</p>
        ) : (
          <>
            <p className="muted">
              Sans ces montants, le rapport sous-estime la dépense réelle :
            </p>
            <ul className="missing-list">
              {report.coverage.missing.map((item) => (
                <li key={item.id}>
                  <Link to={`/applications/${item.id}`}>{item.name}</Link> <span className="mono">{item.code}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Frugalité du parc" titleId="frugality-title" className="finops-card">
        <p className="muted">
          Note du thème « Frugalité et FinOps » du questionnaire, croisée avec la dépense du mois. Une
          application chère et mal notée est un arbitrage à poser, pas seulement une ligne de budget.
        </p>
        {report.frugality.averageScore === null ? (
          <p className="muted">Aucune évaluation soumise : la frugalité du parc n'est pas encore mesurée.</p>
        ) : (
          <>
            <p>
              Score moyen de frugalité :{' '}
              <strong className="mono">{report.frugality.averageScore} %</strong> sur{' '}
              {report.frugality.evaluated} application{report.frugality.evaluated > 1 ? 's' : ''} évaluée
              {report.frugality.evaluated > 1 ? 's' : ''}.
            </p>
            {report.frugality.worstOffenders.length > 0 && (
              <BreakdownBars
                labelledBy="frugality-title"
                header="Application"
                items={report.frugality.worstOffenders.map((row) => ({
                  key: row.code,
                  label: <Link to={`/applications/${row.id}/finops`}>{row.name}</Link>,
                  value: row.amountEur,
                  share: row.amountEur / (report.currentTotal || 1),
                  hint: `frugalité ${row.frugalityScore} %`,
                }))}
              />
            )}
          </>
        )}
      </Card>

      <Card title="Leviers d'optimisation" titleId="levers-title" className="finops-card">
        <p className="muted">
          Proposés seulement quand les données les justifient, avec les applications concernées. Ils
          recoupent les plans d'action des évaluations, vus sous l'angle du coût et de l'empreinte.
        </p>
        <FinopsLevers levers={report.levers} />
        <p className="muted finops-referentiels">
          Référentiels de rattachement : {FINOPS_REFERENTIELS.join(' · ')}.
        </p>
      </Card>

      {can(user.role, 'finops:write') && <CostForm onSaved={reload} />}
    </>
  );
}

/**
 * Saisie du coût mensuel d'une application.
 *
 * Les coûts s'additionnent par **source** : une saisie manuelle vient s'ajouter
 * à un éventuel import (aujourd'hui, au jeu de démonstration). Le formulaire
 * affiche donc ce qui est déjà enregistré pour le mois choisi : sans quoi le
 * total obtenu serait incompréhensible. Une nouvelle saisie manuelle remplace
 * la précédente pour le même mois.
 */
function CostForm({ onSaved }: { onSaved: () => void }) {
  const applications = useApi<{ applications: ApplicationDto[] }>('/api/applications');
  const [applicationId, setApplicationId] = useState('');
  const [periodMonth, setPeriodMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [amountEur, setAmountEur] = useState('');
  const [energyKwh, setEnergyKwh] = useState('');
  const [co2Kg, setCo2Kg] = useState('');
  const existing = useApi<{ costs: ApplicationCostDto[] }>(
    applicationId ? `/api/applications/${applicationId}/costs` : null,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = (applications.data?.applications ?? [])
    .filter((application) => application.status !== 'deleted')
    .map((application) => ({ value: String(application.id), label: `${application.code} : ${application.name}` }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalError(null);
    setFlash(null);

    const parsed = saveCostSchema.safeParse({
      periodMonth,
      amountEur,
      energyKwh: energyKwh || 0,
      co2Kg: co2Kg || 0,
    });
    const fieldErrors = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (!applicationId) fieldErrors.applicationId = 'Choisir une application';
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      await api.put(`/api/applications/${applicationId}/costs`, parsed.data);
      setFlash(`Saisie enregistrée pour ${formatMonth(periodMonth)}.`);
      setAmountEur('');
      setEnergyKwh('');
      setCo2Kg('');
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fields) setErrors(caught.fields);
      else setGlobalError(caught instanceof ApiError ? caught.message : "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Saisir le mois" titleId="cost-form-title" className="finops-card">
      {flash && <Alert tone="success">{flash}</Alert>}
      {globalError && <Alert tone="error">{globalError}</Alert>}
      <FormErrorSummary errors={errors} labels={COST_LABELS} onFocusField={focusField} />

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="form-grid__full">
            <SelectField
              id="applicationId"
              label={COST_LABELS.applicationId!}
              required
              options={options}
              placeholder={applications.loading ? 'Chargement…' : ': Choisir :'}
              value={applicationId}
              onChange={(event) => setApplicationId(event.target.value)}
              error={errors.applicationId}
            />
          </div>
          <TextField
            id="periodMonth"
            label={COST_LABELS.periodMonth!}
            type="month"
            required
            value={periodMonth}
            onChange={(event) => setPeriodMonth(event.target.value)}
            error={errors.periodMonth}
          />
          <TextField
            id="amountEur"
            label={`${COST_LABELS.amountEur} (€)`}
            type="number"
            min={0}
            step={1}
            inputMode="decimal"
            required
            value={amountEur}
            onChange={(event) => setAmountEur(event.target.value)}
            error={errors.amountEur}
            hint="Coût total du mois : licences, requêtes API, compute."
          />
          <TextField
            id="energyKwh"
            label={`${COST_LABELS.energyKwh} (kWh)`}
            type="number"
            min={0}
            step={1}
            inputMode="decimal"
            value={energyKwh}
            onChange={(event) => {
              setEnergyKwh(event.target.value);
              // Proposition d'empreinte, modifiable : rien n'est calculé en cachette.
              const kwh = Number(event.target.value);
              setCo2Kg(Number.isFinite(kwh) && kwh > 0 ? String(estimateCo2(kwh)) : '');
            }}
            error={errors.energyKwh}
            hint="Entraînement + inférence. Laisser vide si non mesuré."
          />
          <TextField
            id="co2Kg"
            label={`${COST_LABELS.co2Kg} (kg CO₂ éq.)`}
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={co2Kg}
            onChange={(event) => setCo2Kg(event.target.value)}
            error={errors.co2Kg}
            hint={`Proposé d'après le mix français (${CO2_KG_PER_KWH} kg/kWh).`}
          />
        </div>

        <ExistingCostNotice costs={existing.data?.costs ?? []} periodMonth={periodMonth} />

        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
