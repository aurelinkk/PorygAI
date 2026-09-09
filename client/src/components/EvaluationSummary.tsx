/**
 * Bloc « Conformité » de la fiche application : dernier verdict rendu, plan
 * d'action en cours, et lien vers le questionnaire.
 *
 * Affiche indifféremment une évaluation v1 (sur 18, éliminatoires) ou v2 (sur
 * 100, plafonds, blocage) : `maxScore` et `questionnaireVersion` disent laquelle.
 *
 * Les actions correctives sont cochables par ceux qui ont `action_plan:execute`
 * (Process Owner, AI Officer) ; les autres les voient en lecture seule.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COMPLIANT_MIN, PARTIAL_MIN, VERDICT_LABELS, can, questionWording,
  type ActionPlanDto, type EvaluationDto,
} from '@poryg/shared';
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
  const countries = last?.sections.filter((section) => ['UE', 'US', 'CN', 'AU'].includes(section.code)) ?? [];

  return (
    <Card
      title="Conformité"
      titleId="conformity-title"
      actions={
        data.permissions.fill ? (
          <ButtonLink to={`/applications/${applicationId}/evaluation`} variant="secondary" small>
            {data.draft ? 'Reprendre le questionnaire' : last ? 'Nouvelle évaluation' : 'Remplir le questionnaire'}
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
            <span className="score__value">{last.score ?? '—'}</span>
            <span className="score__max">/ {last.maxScore}</span>
            {last.verdict && <span className={`verdict verdict--${last.verdict}`}>{VERDICT_LABELS[last.verdict].split(' — ')[0]}</span>}
          </p>
          <p className="muted score__hint">
            {last.maxScore === 100
              ? `Conforme dès ${COMPLIANT_MIN}, test de ${PARTIAL_MIN} à ${COMPLIANT_MIN - 1}`
              : 'Questionnaire v1 : seuil 14/18'}
            {' · '}soumise par {last.submittedBy?.displayName ?? 'Système'} le{' '}
            <span className="mono">{last.submittedAt ? formatDateTime(last.submittedAt) : '—'}</span>
            {data.history.length > 1 && ` · ${data.history.length} évaluations au total`}
          </p>

          {last.blockedBy && (
            <div className="notice notice--danger">
              Évaluation refusée sur la question <span className="mono">{last.blockedBy}</span> —{' '}
              {questionWording(last.blockedBy)}
            </div>
          )}

          {last.cappedBy.length > 0 && !last.blockedBy && (
            <div className="notice notice--danger">
              {last.maxScore === 100 ? 'Score plafonné à 60 par les critères critiques' : 'Critères éliminatoires'} non
              satisfaits :
              <ul className="redflags">
                {last.cappedBy.map((code) => (
                  <li key={code}>
                    <span className="mono">{code}</span> — {questionWording(code)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {countries.length > 0 && (
            <ul className="section-bars section-bars--inline">
              {countries.map((section) => (
                <li key={section.code} className="section-bar">
                  <span className="section-bar__label">{section.label.replace('Réglementation — ', '')}</span>
                  <span className="section-bar__value mono">
                    {section.pointsObtained.toLocaleString('fr-FR')}/{section.pointsApplicable}
                  </span>
                  <span className="section-bar__track" aria-hidden="true">
                    <span className="section-bar__fill" style={{ width: `${section.score ?? 0}%` }} />
                  </span>
                </li>
              ))}
            </ul>
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
