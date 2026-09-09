/**
 * Bloc « Conformité » de la fiche application : dernier verdict rendu, plan
 * d'action en cours, et lien vers le questionnaire.
 *
 * Les actions correctives sont cochables par ceux qui ont `action_plan:execute`
 * (Process Owner, AI Officer) ; les autres les voient en lecture seule.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PASS_SCORE, can, getQuestion, type ActionPlanDto, type EvaluationDto } from '@poryg/shared';
import { api, ApiError } from '../api/client';
import type { ApiQuery } from '../api/useApi';
import { useUser } from '../auth/AuthContext';
import { formatDate, formatDateTime } from '../lib/format';
import { Alert } from './ui/Alert';
import { ButtonLink } from './ui/Button';
import { Card } from './ui/Card';
import { Loading } from './ui/Loading';

export interface EvaluationResponse {
  draft: EvaluationDto | null;
  history: EvaluationDto[];
  actionPlans: ActionPlanDto[];
  permissions: { fill: boolean; submit: boolean };
}

interface EvaluationSummaryProps {
  applicationId: number;
  /** Requête lancée par la page, pour qu'elle parte en parallèle des autres. */
  query: ApiQuery<EvaluationResponse>;
  /** Appelé après une action, pour rafraîchir la fiche (le statut peut changer). */
  onChange: () => void;
}

export function EvaluationSummary({ applicationId, query, onChange }: EvaluationSummaryProps) {
  const user = useUser();
  const { data, error, loading } = query;
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canExecute = can(user.role, 'action_plan:execute');

  async function toggle(plan: ActionPlanDto) {
    setBusyId(plan.id);
    setActionError(null);
    try {
      await api.post(`/api/action-plans/${plan.id}/done`, { done: plan.status !== 'done' });
      onChange();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "L'action a échoué.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) {
    return (
      <Card title="Conformité" titleId="conformity-title">
        <Loading message="Chargement de l'évaluation…" />
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card title="Conformité" titleId="conformity-title">
        <Alert tone="error">{error?.message ?? "Évaluation indisponible."}</Alert>
      </Card>
    );
  }

  const last = data.history[0] ?? null;
  const openPlans = data.actionPlans.filter((plan) => plan.status === 'open');

  return (
    <Card
      title="Conformité"
      titleId="conformity-title"
      actions={
        data.permissions.fill ? (
          <ButtonLink to={`/applications/${applicationId}/evaluation`} variant="secondary" small>
            {data.draft ? 'Reprendre le questionnaire' : 'Remplir le questionnaire'}
          </ButtonLink>
        ) : (
          <ButtonLink to={`/applications/${applicationId}/evaluation`} variant="ghost" small>
            Voir le questionnaire
          </ButtonLink>
        )
      }
    >
      {actionError && <Alert tone="error">{actionError}</Alert>}

      {!last && !data.draft && <p className="muted">Aucune évaluation n'a encore été réalisée.</p>}
      {!last && data.draft && (
        <p className="muted">
          Une évaluation est en cours de saisie ({Object.keys(data.draft.answers).length} réponse(s) enregistrée(s)).
        </p>
      )}

      {last && (
        <>
          <p className="score score--inline">
            <span className="score__value">{last.score}</span>
            <span className="score__max">/ {last.maxScore}</span>
            <span className={`verdict verdict--${last.decision}`}>
              {last.decision === 'compliant' ? 'Conforme' : 'Non conforme'}
            </span>
          </p>
          <p className="muted score__hint">
            Seuil : {PASS_SCORE}/{last.maxScore} · soumise par {last.submittedBy?.displayName ?? 'Système'} le{' '}
            <span className="mono">{last.submittedAt ? formatDateTime(last.submittedAt) : '—'}</span>
            {data.history.length > 1 && ` · ${data.history.length} évaluations au total`}
          </p>

          {last.redFlags.length > 0 && (
            <div className="notice notice--danger">
              Critère{last.redFlags.length > 1 ? 's' : ''} éliminatoire{last.redFlags.length > 1 ? 's' : ''} non
              satisfait{last.redFlags.length > 1 ? 's' : ''} :
              <ul className="redflags">
                {last.redFlags.map((code) => (
                  <li key={code}>
                    <span className="mono">{code}</span> — {getQuestion(code)?.wording ?? code}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {data.actionPlans.length > 0 && (
        <>
          <h3 className="subsection-title">
            Plan d'action{' '}
            <span className="muted">
              ({openPlans.length} action{openPlans.length > 1 ? 's' : ''} ouverte{openPlans.length > 1 ? 's' : ''} sur{' '}
              {data.actionPlans.length})
            </span>
          </h3>
          <ul className="plans">
            {data.actionPlans.map((plan) => {
              const isDone = plan.status === 'done';
              const isLate = !isDone && plan.dueDate !== null && plan.dueDate < new Date().toISOString();
              return (
                <li key={plan.id} className={`plan${isDone ? ' plan--done' : ''}`}>
                  <div className="plan__head">
                    {canExecute ? (
                      <label className="plan__check">
                        <input
                          type="checkbox"
                          checked={isDone}
                          disabled={busyId === plan.id}
                          onChange={() => void toggle(plan)}
                        />
                        <span className="plan__title">{plan.title}</span>
                      </label>
                    ) : (
                      <span className="plan__title">{plan.title}</span>
                    )}
                  </div>
                  <p className="plan__description">{plan.description}</p>
                  <p className="plan__meta mono">
                    {plan.owner ? `${plan.owner.displayName} · ` : ''}
                    {plan.dueDate && (
                      <span className={isLate ? 'plan__late' : undefined}>
                        échéance {formatDate(plan.dueDate)}
                        {isLate ? ' (dépassée)' : ''}
                      </span>
                    )}
                    {isDone && plan.doneAt && ` · terminée par ${plan.doneBy?.displayName ?? '—'} le ${formatDate(plan.doneAt)}`}
                  </p>
                </li>
              );
            })}
          </ul>
          {openPlans.length === 0 && (
            <p className="muted">
              Toutes les actions sont terminées. Une nouvelle évaluation peut être soumise via{' '}
              <Link to={`/applications/${applicationId}/evaluation`}>le questionnaire</Link>.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
