/**
 * Saisie d'un coût mensuel depuis la fiche d'une application, sans passer par
 * l'onglet FinOps. L'application étant connue, il ne reste que deux champs :
 * le mois et le montant.
 *
 * Le formulaire est masqué derrière un bouton pour ne pas alourdir la fiche, et
 * prévient toujours de ce qui est déjà enregistré pour le mois choisi — sans
 * quoi le total affiché ensuite serait incompréhensible (les coûts s'ajoutent
 * par source, voir docs/architecture.md § « Le rapport FinOps »).
 */
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { saveCostSchema, type ApplicationCostDto } from '@poryg/shared';
import { api, ApiError } from '../api/client';
import type { ApiQuery } from '../api/useApi';
import { formatEur, formatMonth } from '../lib/format';
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
      {monthCosts.map((cost) => `${formatEur(cost.amountEur)} (${cost.source})`).join(' + ')}.{' '}
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
      setErrors({});
      // Le focus suit l'ouverture, sinon la navigation au clavier repart du bouton.
      setTimeout(() => monthRef.current?.focus(), 0);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalError(null);
    setFlash(null);

    const parsed = saveCostSchema.safeParse({ periodMonth, amountEur });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      await api.put(`/api/applications/${applicationId}/costs`, parsed.data);
      setFlash(`Coût enregistré pour ${formatMonth(parsed.data.periodMonth)}.`);
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
  const thisMonthTotal = data.costs
    .filter((cost) => cost.periodMonth === thisMonth)
    .reduce((sum, cost) => sum + cost.amountEur, 0);

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
          </div>

          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer le coût'}
            </Button>
            <Button variant="ghost" onClick={toggle} disabled={busy}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      <p className="muted cost-link">
        <Link to="/finops">Voir le rapport FinOps complet</Link>
      </p>
    </Card>
  );
}
