/**
 * Saisie mensuelle depuis la fiche d'une application, sans passer par l'onglet
 * FinOps. L'application étant connue, il reste le mois et les trois grandeurs du
 * FinOps responsable : coût, énergie et carbone.
 *
 * L'énergie et le carbone sont facultatifs : toutes les équipes ne savent pas
 * encore mesurer : mais ils sont demandés **ici**, au moment où l'on saisit la
 * facture : c'est le seul moment où quelqu'un a le chiffre sous les yeux.
 *
 * Le formulaire est masqué derrière un bouton pour ne pas alourdir la fiche, et
 * prévient toujours de ce qui est déjà enregistré pour le mois choisi : sans
 * quoi le total affiché ensuite serait incompréhensible (les coûts s'ajoutent
 * par source, voir docs/architecture.md § « Le rapport FinOps »).
 */
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CO2_KG_PER_KWH, estimateCo2, saveCostSchema, type ApplicationCostDto } from '@poryg/shared';
import { api, ApiError } from '../api/client';
import type { ApiQuery } from '../api/useApi';
import { formatEur, formatKwh, formatCo2, formatMonth } from '../lib/format';
import { zodFieldErrors, type FieldErrors } from '../lib/forms';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { TextField } from './ui/Fields';
import { Loading } from './ui/Loading';

export interface CostsResponse {
  costs: ApplicationCostDto[];
  permissions: { edit: boolean };
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Rappel de ce qui est déjà enregistré pour un mois donné.
 * Partagé avec la page FinOps pour que le message soit identique partout.
 */
export function ExistingCostNotice({ costs, periodMonth }: { costs: ApplicationCostDto[]; periodMonth: string }) {
  const monthCosts = costs.filter((cost) => cost.periodMonth === periodMonth);
  if (monthCosts.length === 0) return null;

  const hasManual = monthCosts.some((cost) => cost.source === 'manuel');
  return (
    <p className="notice notice--info" role="status">
      Déjà enregistré pour {formatMonth(periodMonth)} :{' '}
      {monthCosts
        .map((cost) => {
          const empreinte = cost.energyKwh > 0 ? `, ${formatKwh(cost.energyKwh)}` : '';
          return `${formatEur(cost.amountEur)}${empreinte} (${cost.source})`;
        })
        .join(' + ')}.{' '}
      {hasManual
        ? 'Votre saisie remplacera la saisie manuelle existante.'
        : "Votre saisie s'ajoutera à ces montants."}
    </p>
  );
}

interface CostCardProps {
  applicationId: number;
  /** Requête lancée par la page, pour qu'elle parte en parallèle des autres. */
  query: ApiQuery<CostsResponse>;
  /** L'application accepte-t-elle encore des écritures ? (non si supprimée) */
  editable: boolean;
  onSaved: () => void;
}

export function CostCard({ applicationId, query, editable, onSaved }: CostCardProps) {
  const { data, error, loading } = query;
  const [open, setOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(currentMonth);
  const [amountEur, setAmountEur] = useState('');
  const [energyKwh, setEnergyKwh] = useState('');
  const [co2Kg, setCo2Kg] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const monthRef = useRef<HTMLInputElement>(null);

  function toggle() {
    const next = !open;
    setOpen(next);
    setGlobalError(null);
    if (next) {
      setPeriodMonth(currentMonth());
      setAmountEur('');
      setEnergyKwh('');
      setCo2Kg('');
      setErrors({});
      // Le focus suit l'ouverture, sinon la navigation au clavier repart du bouton.
      setTimeout(() => monthRef.current?.focus(), 0);
    }
  }

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
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      await api.put(`/api/applications/${applicationId}/costs`, parsed.data);
      setFlash(`Saisie enregistrée pour ${formatMonth(parsed.data.periodMonth)}.`);
      setOpen(false);
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fields) setErrors(caught.fields);
      else setGlobalError(caught instanceof ApiError ? caught.message : "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <Card title="Coûts" titleId="costs-title">
        <Loading message="Chargement des coûts…" />
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card title="Coûts" titleId="costs-title">
        <Alert tone="error">{error?.message ?? 'Coûts indisponibles.'}</Alert>
      </Card>
    );
  }

  const canEdit = data.permissions.edit && editable;
  const thisMonth = currentMonth();
  const monthCosts = data.costs.filter((cost) => cost.periodMonth === thisMonth);
  const thisMonthTotal = monthCosts.reduce((sum, cost) => sum + cost.amountEur, 0);
  const thisMonthKwh = monthCosts.reduce((sum, cost) => sum + cost.energyKwh, 0);
  const thisMonthCo2 = monthCosts.reduce((sum, cost) => sum + cost.co2Kg, 0);

  // Trois derniers mois renseignés, du plus récent au plus ancien.
  const recentMonths = [...new Set(data.costs.map((cost) => cost.periodMonth))]
    .sort()
    .reverse()
    .slice(0, 3)
    .map((month) => ({
      month,
      total: data.costs.filter((cost) => cost.periodMonth === month).reduce((sum, cost) => sum + cost.amountEur, 0),
    }));

  return (
    <Card
      title="Coûts"
      titleId="costs-title"
      actions={
        canEdit ? (
          <Button variant="secondary" small onClick={toggle} aria-expanded={open} aria-controls="cost-entry-form">
            {open ? 'Annuler' : 'Saisir un coût mensuel'}
          </Button>
        ) : undefined
      }
    >
      {flash && <Alert tone="success">{flash}</Alert>}
      {globalError && <Alert tone="error">{globalError}</Alert>}

      <p>
        {thisMonthTotal > 0 ? (
          <>
            <strong className="cost-total">{formatEur(thisMonthTotal)}</strong> pour {formatMonth(thisMonth)}
            {thisMonthKwh > 0 ? (
              <span className="muted">
                {' · '}
                {formatKwh(thisMonthKwh)} · {formatCo2(thisMonthCo2)}
              </span>
            ) : (
              <span className="muted"> · empreinte non déclarée</span>
            )}
          </>
        ) : (
          <span className="muted">Aucun coût saisi pour {formatMonth(thisMonth)}.</span>
        )}
      </p>

      {recentMonths.length > 1 && (
        <p className="muted mono cost-history">
          {recentMonths.map(({ month, total }) => `${month} : ${formatEur(total)}`).join(' · ')}
        </p>
      )}

      {open && (
        <form id="cost-entry-form" onSubmit={handleSubmit} noValidate className="cost-form">
          <ExistingCostNotice costs={data.costs} periodMonth={periodMonth} />

          <div className="form-grid">
            <TextField
              id="costPeriodMonth"
              ref={monthRef}
              label="Mois"
              type="month"
              required
              value={periodMonth}
              onChange={(event) => setPeriodMonth(event.target.value)}
              error={errors.periodMonth}
            />
            <TextField
              id="costAmountEur"
              label="Montant (€)"
              type="number"
              min={0}
              step={1}
              inputMode="decimal"
              required
              value={amountEur}
              onChange={(event) => setAmountEur(event.target.value)}
              error={errors.amountEur}
              hint="Licences, requêtes API, compute."
            />
            <TextField
              id="costEnergyKwh"
              label="Énergie (kWh)"
              type="number"
              min={0}
              step={1}
              inputMode="decimal"
              value={energyKwh}
              onChange={(event) => {
                setEnergyKwh(event.target.value);
                // Proposition, pas calcul caché : le champ reste modifiable, et
                // c'est la valeur validée qui est enregistrée.
                const kwh = Number(event.target.value);
                setCo2Kg(Number.isFinite(kwh) && kwh > 0 ? String(estimateCo2(kwh)) : '');
              }}
              error={errors.energyKwh}
              hint="Entraînement + inférence. Laisser vide si non mesuré."
            />
            <TextField
              id="costCo2Kg"
              label="Empreinte (kg CO₂ éq.)"
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              value={co2Kg}
              onChange={(event) => setCo2Kg(event.target.value)}
              error={errors.co2Kg}
              hint={`Proposé d'après le mix français (${CO2_KG_PER_KWH} kg/kWh) : à corriger si l'hébergement est ailleurs.`}
            />
          </div>

          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
            <Button variant="ghost" onClick={toggle} disabled={busy}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      <p className="muted cost-link">
        <Link to={`/applications/${applicationId}/finops`}>Rapport FinOps de cette application</Link>
        {' · '}
        <Link to="/finops">Rapport global</Link>
      </p>
    </Card>
  );
}
