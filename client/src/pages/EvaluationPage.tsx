/**
 * Fiche d'évaluation de conformité IA.
 *
 * Le score et le verdict affichés en direct sont calculés avec la MÊME fonction
 * que le serveur (`scoreEvaluation` de @poryg/shared) : l'utilisateur voit où il
 * en est pendant la saisie, mais seul le calcul du serveur, à la soumission,
 * fait foi et modifie le statut de l'application.
 *
 * Deux actions distinctes :
 *  - « Enregistrer le brouillon » (permission evaluation:fill) : sauvegarde sans verdict ;
 *  - « Soumettre l'évaluation » (permission evaluation:decide) : fige l'évaluation,
 *    applique le verdict et génère le plan d'action si non conforme.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ANSWER_VALUES, BUSINESS_CRITICALITIES, PASS_SCORE, PILLARS, QUESTIONS,
  scoreEvaluation, submitEvaluationSchema,
  type ActionPlanDto, type AnswerValue, type ApplicationDto, type EvaluationDto,
} from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/useApi';
import { Alert, FormErrorSummary } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField, TextField, TextareaField } from '../components/ui/Fields';
import { LoadingScreen } from '../components/ui/Loading';
import { focusField, zodFieldErrors, type FieldErrors } from '../lib/forms';

interface EvaluationResponse {
  draft: EvaluationDto | null;
  history: EvaluationDto[];
  actionPlans: ActionPlanDto[];
  permissions: { fill: boolean; submit: boolean };
}

const PRELIMINARY_LABELS: Record<string, string> = {
  toolVendor: 'Outil & éditeur',
  purpose: 'Finalité précise',
  businessCriticality: 'Criticité métier',
  answers: 'Questionnaire',
};

export function EvaluationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const application = useApi<{ application: ApplicationDto }>(`/api/applications/${id}`);
  const evaluation = useApi<EvaluationResponse>(`/api/applications/${id}/evaluation`);

  const [toolVendor, setToolVendor] = useState('');
  const [purpose, setPurpose] = useState('');
  const [businessCriticality, setBusinessCriticality] = useState('');
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [comments, setComments] = useState<Record<string, string>>({});

  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Évaluation de conformité · Poryg'AI";
  }, []);

  // Pré-remplissage depuis le brouillon existant, une seule fois.
  useEffect(() => {
    if (loaded || !evaluation.data) return;
    const draft = evaluation.data.draft;
    if (draft) {
      setToolVendor(draft.toolVendor);
      setPurpose(draft.purpose);
      setBusinessCriticality(draft.businessCriticality ?? '');
      setAnswers(draft.answers);
      setComments(draft.comments);
    }
    setLoaded(true);
  }, [evaluation.data, loaded]);

  // Le même calcul que le serveur, pour un retour immédiat pendant la saisie.
  const result = useMemo(() => scoreEvaluation(answers), [answers]);
  const answeredCount = Object.keys(answers).length;

  function payload() {
    return { toolVendor, purpose, businessCriticality: businessCriticality || null, answers, comments };
  }

  function showErrors(fieldErrors: FieldErrors) {
    setErrors(fieldErrors);
    setTimeout(() => summaryRef.current?.focus(), 0);
  }

  async function handleSave() {
    setBusy(true);
    setGlobalError(null);
    setFlash(null);
    try {
      await api.put(`/api/applications/${id}/evaluation`, payload());
      setFlash('Brouillon enregistré. Vous pourrez reprendre la saisie plus tard.');
    } catch (error) {
      setGlobalError(error instanceof ApiError ? error.message : "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalError(null);
    setFlash(null);

    const parsed = submitEvaluationSchema.safeParse(payload());
    if (!parsed.success) {
      showErrors(zodFieldErrors(parsed.error));
      return;
    }
    if (!result.complete) {
      showErrors({ answers: `Il reste ${QUESTIONS.length - answeredCount} question(s) sans réponse.` });
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      const response = await api.post<{ evaluation: EvaluationDto; actionPlans: ActionPlanDto[] }>(
        `/api/applications/${id}/evaluation/submit`,
        parsed.data,
      );
      const verdict = response.evaluation.decision === 'compliant' ? 'Conforme' : 'Non conforme';
      const plans = response.actionPlans.length;
      navigate(`/applications/${id}`, {
        state: {
          flash:
            `Évaluation soumise : ${response.evaluation.score}/${response.evaluation.maxScore} → ${verdict}.` +
            (plans > 0 ? ` ${plans} action${plans > 1 ? 's' : ''} corrective${plans > 1 ? 's' : ''} générée${plans > 1 ? 's' : ''}.` : ''),
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.fields) showErrors(error.fields);
      else setGlobalError(error instanceof ApiError ? error.message : 'La soumission a échoué.');
    } finally {
      setBusy(false);
    }
  }

  if ((application.loading && !application.data) || (evaluation.loading && !evaluation.data)) {
    return <LoadingScreen message="Chargement du questionnaire…" />;
  }
  if (application.error || evaluation.error || !application.data || !evaluation.data) {
    return (
      <div className="card message-card">
        <h1 className="page-title">Évaluation indisponible</h1>
        <p>{application.error?.message ?? evaluation.error?.message ?? 'Application introuvable.'}</p>
        <ButtonLink to="/applications" variant="secondary">
          Retour à l'inventaire
        </ButtonLink>
      </div>
    );
  }

  const app = application.data.application;
  const { permissions } = evaluation.data;
  const readOnly = !permissions.fill;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">{app.code} · questionnaire v1</p>
          <h1 className="page-title">Évaluation de conformité</h1>
        </div>
        <ButtonLink to={`/applications/${id}`} variant="ghost" small>
          ← Retour à la fiche
        </ButtonLink>
      </div>

      {globalError && <Alert tone="error">{globalError}</Alert>}
      {flash && <Alert tone="success">{flash}</Alert>}
      {readOnly && (
        <Alert tone="info">
          Vous consultez ce questionnaire en lecture seule : votre rôle ne permet pas de le renseigner.
        </Alert>
      )}
      <FormErrorSummary ref={summaryRef} errors={errors} labels={PRELIMINARY_LABELS} onFocusField={focusField} />

      <form onSubmit={handleSubmit} noValidate>
        <div className="eval-layout">
          <div className="eval-main">
            <Card title="1. Informations préliminaires" titleId="prelim-title">
              <p className="field__hint">
                Non notées, mais requises à la soumission : elles permettent au DPO et à l'AI Officer d'identifier
                le périmètre.
              </p>
              <TextField
                id="toolVendor"
                label={PRELIMINARY_LABELS.toolVendor!}
                required
                maxLength={200}
                disabled={readOnly}
                value={toolVendor}
                onChange={(event) => setToolVendor(event.target.value)}
                error={errors.toolVendor}
                hint="Ex. « Copilot — Microsoft », « Modèle interne — équipe Data »."
              />
              <TextareaField
                id="purpose"
                label={PRELIMINARY_LABELS.purpose!}
                required
                rows={3}
                maxLength={2000}
                disabled={readOnly}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                error={errors.purpose}
                hint="Ce que l'IA fait concrètement, pour qui, à partir de quelles données."
              />
              <SelectField
                id="businessCriticality"
                label={PRELIMINARY_LABELS.businessCriticality!}
                required
                disabled={readOnly}
                options={BUSINESS_CRITICALITIES.map((item) => ({ value: item.code, label: item.label }))}
                value={businessCriticality}
                onChange={(event) => setBusinessCriticality(event.target.value)}
                error={errors.businessCriticality}
              />
              <dl className="definitions definitions--compact">
                <div className="definitions__item">
                  <dt>Process Owner</dt>
                  <dd>
                    {app.processOwner.displayName}
                    <span className="definitions__note">Défini sur la fiche de l'application.</span>
                  </dd>
                </div>
              </dl>
            </Card>

            <Card title="2. Grille d'évaluation" titleId="grid-title">
              <p className="field__hint">
                Oui = 2 points · Partiellement = 1 point · Non = 0 point. Les critères marqués
                « éliminatoire » rendent l'application non conforme s'ils obtiennent 0, quel que soit le score.
              </p>
              {errors.answers && (
                <p className="field__error" id="answers-error">
                  {errors.answers}
                </p>
              )}

              {PILLARS.map((pillar) => (
                <section key={pillar.code} className="pillar" aria-labelledby={`pillar-${pillar.code}`}>
                  <h3 id={`pillar-${pillar.code}`} className="pillar__title">
                    <span className="pillar__code mono">{pillar.code}</span>
                    {pillar.label}
                  </h3>

                  {QUESTIONS.filter((question) => question.pillar === pillar.code).map((question) => {
                    const value = answers[question.code];
                    const isRedFlag = value === 0 && question.critical;
                    return (
                      <fieldset
                        key={question.code}
                        id={question.code}
                        className={`question${isRedFlag ? ' question--flagged' : ''}`}
                      >
                        <legend className="question__legend">
                          <span className="question__code mono">{question.code}</span>
                          {question.wording}
                          {question.critical && (
                            <span className="question__critical" title="Critère éliminatoire">
                              éliminatoire
                            </span>
                          )}
                        </legend>

                        <div className="question__choices">
                          {ANSWER_VALUES.map((option) => {
                            const optionId = `${question.code}-${option.value}`;
                            return (
                              <label key={option.value} htmlFor={optionId} className="choice">
                                <input
                                  id={optionId}
                                  type="radio"
                                  name={question.code}
                                  value={option.value}
                                  checked={value === option.value}
                                  disabled={readOnly}
                                  onChange={() =>
                                    setAnswers((previous) => ({ ...previous, [question.code]: option.value }))
                                  }
                                />
                                <span>{option.label}</span>
                                <span className="choice__points mono">{option.value} pt</span>
                              </label>
                            );
                          })}
                        </div>

                        {isRedFlag && (
                          <p className="notice notice--danger" role="status">
                            Critère éliminatoire non satisfait : l'application sera déclarée non conforme.
                          </p>
                        )}

                        <TextField
                          id={`comment-${question.code}`}
                          label="Commentaire (facultatif)"
                          maxLength={1000}
                          disabled={readOnly}
                          value={comments[question.code] ?? ''}
                          onChange={(event) =>
                            setComments((previous) => ({ ...previous, [question.code]: event.target.value }))
                          }
                        />
                      </fieldset>
                    );
                  })}
                </section>
              ))}
            </Card>
          </div>

          {/* Récapitulatif en direct. Le verdict définitif reste celui du serveur. */}
          <Card title="3. Score en direct" titleId="score-title" className="eval-side">
            <p className="score">
              <span className="score__value">{result.score}</span>
              <span className="score__max">/ {result.maxScore}</span>
            </p>
            <p className="score__progress" aria-hidden="true">
              <span className="score__bar" style={{ width: `${(result.score / result.maxScore) * 100}%` }} />
            </p>
            <p className="muted score__hint">
              Seuil de conformité : {PASS_SCORE}/{result.maxScore}. {answeredCount}/{QUESTIONS.length} question
              {QUESTIONS.length > 1 ? 's' : ''} renseignée{answeredCount > 1 ? 's' : ''}.
            </p>

            <p
              className={`verdict verdict--${result.complete ? result.decision : 'pending'}`}
              role="status"
            >
              {!result.complete
                ? 'Questionnaire incomplet'
                : result.decision === 'compliant'
                  ? 'Verdict prévu : Conforme'
                  : 'Verdict prévu : Non conforme'}
            </p>

            {result.redFlags.length > 0 && (
              <p className="notice notice--danger">
                Critère{result.redFlags.length > 1 ? 's' : ''} éliminatoire{result.redFlags.length > 1 ? 's' : ''} non
                satisfait{result.redFlags.length > 1 ? 's' : ''} : {result.redFlags.join(', ')}.
              </p>
            )}

            {!readOnly && (
              <div className="eval-actions">
                <Button type="button" variant="secondary" onClick={() => void handleSave()} disabled={busy}>
                  {busy ? 'En cours…' : 'Enregistrer le brouillon'}
                </Button>
                {permissions.submit ? (
                  <Button type="submit" disabled={busy || !result.complete}>
                    {busy ? 'En cours…' : "Soumettre l'évaluation"}
                  </Button>
                ) : (
                  <p className="muted">
                    Seuls un auditeur ou l'AI Officer peuvent soumettre l'évaluation et déclencher le verdict.
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </form>
    </>
  );
}
