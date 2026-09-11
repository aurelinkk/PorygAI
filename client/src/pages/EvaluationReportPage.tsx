/**
 * Rapport d'évaluation imprimable : récapitulatif complet + plan d'action.
 *
 * Le PDF est produit par le navigateur (« Imprimer → Enregistrer au format PDF »)
 * et non par le serveur : une bibliothèque de génération de PDF serait la plus
 * grosse dépendance du projet pour un besoin que `@media print` couvre. Le
 * bouton n'ouvre donc rien d'autre que la boîte d'impression du navigateur.
 *
 * La page est une vraie page consultable à l'écran ; la feuille de style
 * d'impression (`components.css`, section « Impression ») retire la navigation,
 * les boutons et les ombres, et évite de couper un tableau au milieu.
 */
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  AI_TYPES, BUSINESS_DOMAINS, DATA_SENSITIVITIES, STATUS_LABELS, VERDICT_LABELS,
  getQuestion, labelOf, labelsOf, questionWording,
  type ActionPlanDto, type AnswerValue, type ApplicationDto, type EvaluationDto,
} from '@poryg/shared';
import { useApi } from '../api/useApi';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Loading } from '../components/ui/Loading';
import { formatDate, formatDateTime } from '../lib/format';
import type { EvaluationResponse } from '../components/EvaluationSummary';

/** Réponse telle qu'elle a été cochée, avec le libellé de l'option et non sa valeur. */
function answerLabel(code: string, value: AnswerValue | undefined): string {
  if (value === undefined) return 'Sans réponse';
  const question = getQuestion(code);
  const values = Array.isArray(value) ? value : [String(value)];
  const labels = values.map(
    (candidate) => question?.options?.find((option) => option.value === candidate)?.label ?? candidate,
  );
  return labels.join(' · ');
}

export function EvaluationReportPage() {
  const { id } = useParams<{ id: string }>();
  const application = useApi<{ application: ApplicationDto }>(`/api/applications/${id}`);
  const evaluation = useApi<EvaluationResponse>(`/api/applications/${id}/evaluation`);

  useEffect(() => {
    document.title = "Rapport d'évaluation · Poryg'AI";
  }, []);

  if ((application.loading && !application.data) || (evaluation.loading && !evaluation.data)) {
    return <Loading message="Préparation du rapport…" />;
  }
  if (application.error || !application.data || evaluation.error || !evaluation.data) {
    return (
      <div className="card message-card">
        <h1 className="page-title">Rapport indisponible</h1>
        <p>{application.error?.message ?? evaluation.error?.message ?? 'Impossible de charger le rapport.'}</p>
      </div>
    );
  }

  const app = application.data.application;
  const last = evaluation.data.history.find((entry) => entry.status === 'submitted') ?? null;
  const plans = evaluation.data.actionPlans;

  return (
    <>
      <div className="page-header no-print">
        <div>
          <p className="eyebrow mono">{app.code}</p>
          <h1 className="page-title">Rapport d'évaluation</h1>
        </div>
        <div className="detail-actions">
          <ButtonLink to={`/applications/${app.id}`} variant="ghost" small>
            ← Retour à la fiche
          </ButtonLink>
          <Button variant="primary" small onClick={() => window.print()}>
            Imprimer / Enregistrer en PDF
          </Button>
        </div>
      </div>

      {!last ? (
        <Alert tone="info">
          Aucune évaluation n'a encore été soumise pour cette application : il n'y a rien à récapituler.
        </Alert>
      ) : (
        <article className="report">
          <ReportHeader app={app} evaluation={last} />
          <Verdict evaluation={last} />
          <Sections evaluation={last} />
          <Answers evaluation={last} />
          <ActionPlan plans={plans} />

          <footer className="report__footer">
            Rapport généré le {formatDateTime(new Date().toISOString())} depuis Poryg'AI, registre des
            applications IA. Document interne.
          </footer>
        </article>
      )}
    </>
  );
}

// --- Blocs du rapport ---------------------------------------------------------

function ReportHeader({ app, evaluation }: { app: ApplicationDto; evaluation: EvaluationDto }) {
  return (
    <header className="report__header">
      <h1 className="report__title">
        Évaluation de conformité IA : <span className="mono">{app.code}</span> {app.name}
      </h1>
      <dl className="report__meta">
        <div>
          <dt>Domaine métier</dt>
          <dd>{labelOf(BUSINESS_DOMAINS, app.businessDomain)}</dd>
        </div>
        <div>
          <dt>Nature des données traitées</dt>
          <dd>{labelsOf(DATA_SENSITIVITIES, app.dataSensitivities).join(' · ')}</dd>
        </div>
        <div>
          <dt>Type d'IA</dt>
          <dd>{labelOf(AI_TYPES, app.aiType)}</dd>
        </div>
        <div>
          <dt>Process Owner</dt>
          <dd>{app.processOwner.displayName}</dd>
        </div>
        <div>
          <dt>Statut actuel</dt>
          <dd>{STATUS_LABELS[app.status]}</dd>
        </div>
        <div>
          <dt>Conformité valable jusqu'au</dt>
          <dd>{app.complianceValidUntil ? formatDate(app.complianceValidUntil) : ':'}</dd>
        </div>
        <div>
          <dt>Outil & éditeur</dt>
          <dd>{evaluation.toolVendor || ':'}</dd>
        </div>
        <div>
          <dt>Évaluation soumise le</dt>
          <dd>
            {evaluation.submittedAt ? formatDateTime(evaluation.submittedAt) : ':'}
            {evaluation.submittedBy ? ` par ${evaluation.submittedBy.displayName}` : ''}
          </dd>
        </div>
      </dl>
      {evaluation.purpose && (
        <p className="report__purpose">
          <strong>Finalité déclarée.</strong> {evaluation.purpose}
        </p>
      )}
    </header>
  );
}

function Verdict({ evaluation }: { evaluation: EvaluationDto }) {
  return (
    <Card title="Verdict" titleId="report-verdict" className="report__card">
      <p className="report__verdict">
        <strong>{evaluation.verdict ? VERDICT_LABELS[evaluation.verdict] : 'Non rendu'}</strong>
        {evaluation.score !== null && (
          <>
            {' : '}
            <span className="mono">
              {evaluation.score}/{evaluation.maxScore}
            </span>
          </>
        )}
      </p>
      {evaluation.blockedBy && (
        <p className="notice notice--danger">
          Évaluation refusée sur la question <span className="mono">{evaluation.blockedBy}</span> :{' '}
          {questionWording(evaluation.blockedBy)}
        </p>
      )}
      {evaluation.cappedBy.length > 0 && (
        <div className="notice notice--danger">
          <p>
            Score plafonné : {evaluation.cappedBy.length} critère
            {evaluation.cappedBy.length > 1 ? 's' : ''} critique{evaluation.cappedBy.length > 1 ? 's' : ''} non
            satisfait{evaluation.cappedBy.length > 1 ? 's' : ''}.
          </p>
          <ul className="report__list">
            {evaluation.cappedBy.map((code) => (
              <li key={code}>
                <span className="mono">{code}</span> : {questionWording(code)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Sections({ evaluation }: { evaluation: EvaluationDto }) {
  if (evaluation.sections.length === 0) return null;
  return (
    <Card title="Résultat par thème" titleId="report-sections" className="report__card">
      <table className="table" aria-labelledby="report-sections">
        <thead>
          <tr>
            <th scope="col">Thème</th>
            <th scope="col">Points</th>
            <th scope="col">Score</th>
            <th scope="col">Questions</th>
          </tr>
        </thead>
        <tbody>
          {evaluation.sections.map((section) => (
            <tr key={section.code}>
              <th scope="row">{section.label}</th>
              <td className="mono">
                {section.pointsObtained}/{section.pointsApplicable}
              </td>
              <td className="mono">{section.score ?? ':'} %</td>
              <td className="mono">
                {section.answered}/{section.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Answers({ evaluation }: { evaluation: EvaluationDto }) {
  const codes = Object.keys(evaluation.answers);
  if (codes.length === 0) return null;
  return (
    <Card title="Réponses" titleId="report-answers" className="report__card">
      <table className="table report__answers" aria-labelledby="report-answers">
        <thead>
          <tr>
            <th scope="col">Question</th>
            <th scope="col">Réponse</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code}>
              <th scope="row">
                <span className="mono table__meta">{code}</span> {questionWording(code)}
              </th>
              <td>
                {answerLabel(code, evaluation.answers[code])}
                {evaluation.comments[code] && (
                  <span className="report__comment">« {evaluation.comments[code]} »</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ActionPlan({ plans }: { plans: ActionPlanDto[] }) {
  return (
    <Card title="Plan d'action" titleId="report-plan" className="report__card">
      {plans.length === 0 ? (
        <p className="muted">Aucune action corrective : l'évaluation n'en a pas généré.</p>
      ) : (
        <table className="table" aria-labelledby="report-plan">
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Responsable</th>
              <th scope="col">État</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id}>
                <th scope="row">
                  <span className="report__action-title">{plan.title}</span>
                  <span className="report__action-desc">{plan.description}</span>
                </th>
                <td>{plan.owner?.displayName ?? ':'}</td>
                <td>
                  {plan.status === 'done'
                    ? `Terminée${plan.doneAt ? ` le ${formatDate(plan.doneAt)}` : ''}${
                        plan.doneBy ? ` par ${plan.doneBy.displayName}` : ''
                      }`
                    : 'À faire'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
