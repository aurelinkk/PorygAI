/**
 * Fiche d'évaluation de conformité IA — assistant par étapes (questionnaire v2).
 *
 * Une étape par section applicable, le cadrage d'abord, le résultat en dernier.
 * Les sections et les questions affichées dépendent des réponses de cadrage
 * (`applicableSections` / `applicableQuestions` de @poryg/shared) : elles sont
 * recalculées à chaque réponse, donc une question peut apparaître ou disparaître.
 *
 * Le score en direct est calculé avec la MÊME fonction que le serveur
 * (`scoreEvaluation`). Seul le calcul du serveur, à la soumission, fait foi.
 *
 * Le brouillon est enregistré automatiquement à chaque changement d'étape.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BUSINESS_CRITICALITIES, CRITICAL_CAP, VERDICT_LABELS,
  applicableQuestions, applicableSections, scoreEvaluation, submitEvaluationSchema,
  type ActionPlanDto, type AnswerValue, type Answers, type ApplicationDto, type EvaluationDto,
  type ScoringResult, type Section, type SectionScore,
} from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/useApi';
import { QuestionCard } from '../components/QuestionCard';
import { Alert, FormErrorSummary } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField, TextField, TextareaField } from '../components/ui/Fields';
import { LoadingScreen } from '../components/ui/Loading';
import { cx } from '../lib/format';
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

type Step = { kind: 'section'; section: Section } | { kind: 'result' };

/** Libellé court d'un bloc pays pour les barres. */
const shortLabel = (label: string) => label.replace('Réglementation — ', '');

export function EvaluationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const application = useApi<{ application: ApplicationDto }>(`/api/applications/${id}`);
  const evaluation = useApi<EvaluationResponse>(`/api/applications/${id}/evaluation`);

  const [toolVendor, setToolVendor] = useState('');
  const [purpose, setPurpose] = useState('');
  const [businessCriticality, setBusinessCriticality] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [comments, setComments] = useState<Record<string, string>>({});

  const [stepIndex, setStepIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Évaluation de conformité · Poryg'AI";
  }, []);

  // Pré-remplissage depuis le brouillon, une seule fois.
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

  // Tout ce qui dépend des réponses : sections, questions, score.
  const result = useMemo(() => scoreEvaluation(answers), [answers]);
  const sections = useMemo(() => applicableSections(answers), [answers]);
  const steps = useMemo<Step[]>(
    () => [...sections.map((section) => ({ kind: 'section' as const, section })), { kind: 'result' as const }],
    [sections],
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;

  // Si un bloc disparaît (pays décoché), on ne reste pas sur une étape fantôme.
  useEffect(() => {
    if (stepIndex > steps.length - 1) setStepIndex(steps.length - 1);
  }, [steps.length, stepIndex]);

  const permissions = evaluation.data?.permissions ?? { fill: false, submit: false };
  const readOnly = !permissions.fill;

  function payload() {
    return { toolVendor, purpose, businessCriticality: businessCriticality || null, answers, comments };
  }

  async function saveDraft(silent: boolean): Promise<boolean> {
    if (readOnly) return true;
    setSaving(true);
    setGlobalError(null);
    try {
      await api.put(`/api/applications/${id}/evaluation`, payload());
      if (!silent) setFlash('Brouillon enregistré. Vous pourrez reprendre la saisie plus tard.');
      return true;
    } catch (error) {
      setGlobalError(error instanceof ApiError ? error.message : "L'enregistrement a échoué.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function goTo(index: number) {
    setFlash(null);
    await saveDraft(true);
    setStepIndex(index);
    // Le focus suit le changement d'étape : la navigation clavier repart du titre.
    setTimeout(() => headingRef.current?.focus(), 0);
  }

  async function handleSubmit() {
    setGlobalError(null);
    setFlash(null);

    const parsed = submitEvaluationSchema.safeParse(payload());
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    if (!result.complete && result.verdict !== 'blocked') {
      setErrors({ answers: `Il reste ${result.missing.length} question(s) sans réponse.` });
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      const response = await api.post<{ evaluation: EvaluationDto; actionPlans: ActionPlanDto[] }>(
        `/api/applications/${id}/evaluation/submit`,
        parsed.data,
      );
      const submitted = response.evaluation;
      const plans = response.actionPlans.length;
      const verdict = submitted.verdict ? VERDICT_LABELS[submitted.verdict] : '';
      navigate(`/applications/${id}`, {
        state: {
          flash:
            (submitted.score === null ? `Évaluation refusée.` : `Évaluation soumise : ${submitted.score}/100 → ${verdict}.`) +
            (plans > 0 ? ` ${plans} action${plans > 1 ? 's' : ''} recommandée${plans > 1 ? 's' : ''}.` : ''),
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        setErrors(error.fields);
        setTimeout(() => summaryRef.current?.focus(), 0);
      } else setGlobalError(error instanceof ApiError ? error.message : 'La soumission a échoué.');
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
  const isLast = stepIndex >= steps.length - 1;
  const answeredCount = result.applicable.length - result.missing.filter((code) => result.applicable.includes(code)).length;

  /**
   * Une étape est « faite » si toutes ses questions applicables ont une réponse.
   * Indépendant de l'étape affichée : en revenant sur un brouillon on retombe sur
   * le cadrage, déjà rempli — il doit garder sa coche tout en étant l'étape en cours.
   */
  function stepDone(target: Step): boolean {
    if (target.kind === 'result') return false;
    const codes = applicableQuestions(answers)
      .filter((question) => question.section === target.section.code)
      .map((question) => question.code);
    return codes.length > 0 && codes.every((code) => !result.missing.includes(code));
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">
            {app.code} · questionnaire v2 · étape {stepIndex + 1}/{steps.length}
          </p>
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
      {result.verdict === 'blocked' && (
        <Alert tone="error">
          <strong>Évaluation refusée.</strong> {result.blockMessage} Vous pouvez passer directement au résultat.
        </Alert>
      )}

      <div className="wizard">
        {/* --- Étapes ------------------------------------------------------- */}
        <nav className="stepper" aria-label="Étapes du questionnaire">
          <ol className="stepper__list">
            {steps.map((target, index) => {
              const done = stepDone(target);
              const current = index === stepIndex;
              const label = target.kind === 'result' ? 'Résultat' : target.section.label;
              return (
                <li key={target.kind === 'result' ? 'result' : target.section.code}>
                  <button
                    type="button"
                    className={cx(
                      'stepper__item',
                      done && 'stepper__item--done',
                      current && 'stepper__item--current',
                      !done && !current && 'stepper__item--todo',
                    )}
                    aria-current={current ? 'step' : undefined}
                    onClick={() => void goTo(index)}
                  >
                    <span className="stepper__index mono" aria-hidden="true">
                      {done ? '✓' : index + 1}
                    </span>
                    <span className="stepper__label">{shortLabel(label)}</span>
                    {/* La coche est décorative : l'état est aussi dit en toutes lettres. */}
                    {done && <span className="visually-hidden">— étape terminée</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* --- Contenu de l'étape ------------------------------------------- */}
        <div className="wizard__main">
          {step.kind === 'section' ? (
            <Card>
              <h2 ref={headingRef} tabIndex={-1} className="wizard__title">
                {step.section.label}
              </h2>
              <p className="muted">{step.section.intro}</p>

              {step.section.code === 'framing' && (
                <div className="preliminary">
                  <h3 className="subsection-title">Informations préliminaires</h3>
                  <p className="field__hint">Non notées, mais requises à la soumission.</p>
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
                  <h3 className="subsection-title">Cadrage</h3>
                </div>
              )}

              {applicableQuestions(answers)
                .filter((question) => question.section === step.section.code)
                .map((question) => (
                  <QuestionCard
                    key={question.code}
                    question={question}
                    value={answers[question.code]}
                    comment={comments[question.code] ?? ''}
                    disabled={readOnly}
                    onAnswer={(value: AnswerValue) => setAnswers((previous) => ({ ...previous, [question.code]: value }))}
                    onComment={(comment) => setComments((previous) => ({ ...previous, [question.code]: comment }))}
                  />
                ))}

              <div className="wizard__nav">
                <Button variant="ghost" onClick={() => void goTo(stepIndex - 1)} disabled={stepIndex === 0 || saving}>
                  ← Précédent
                </Button>
                {!readOnly && (
                  <Button variant="secondary" onClick={() => void saveDraft(false)} disabled={saving}>
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                  </Button>
                )}
                <Button onClick={() => void goTo(stepIndex + 1)} disabled={saving}>
                  {isLast ? 'Voir le résultat' : 'Suivant →'}
                </Button>
              </div>
            </Card>
          ) : (
            <ResultStep
              result={result}
              headingRef={headingRef}
              summaryRef={summaryRef}
              errors={errors}
              canSubmit={permissions.submit}
              readOnly={readOnly}
              busy={busy}
              onBack={() => void goTo(stepIndex - 1)}
              onSubmit={() => void handleSubmit()}
              onSave={() => void saveDraft(false)}
              applicationId={Number(id)}
            />
          )}
        </div>

        {/* --- Bandeau de droite : parcours (cadrage) puis score en direct ---- */}
        <aside className="wizard__side">
          {step.kind === 'section' && step.section.code === 'framing' && result.applicable.length > 0 && (
            <Card title="Votre parcours" titleId="parcours-title" className="eval-side">
              <p role="status">
                <strong>
                  {result.applicable.length} question{result.applicable.length > 1 ? 's' : ''}
                </strong>{' '}
                vous concernent — environ {result.estimatedMinutes} minute
                {result.estimatedMinutes > 1 ? 's' : ''}.
              </p>
              <p className="muted">
                Le cadrage détermine les questions affichées : ce nombre change à chaque réponse.
              </p>
            </Card>
          )}
          <Card title="Score en direct" titleId="live-score-title" className="eval-side">
            <ScorePanel result={result} answered={answeredCount} compact />
          </Card>
        </aside>
      </div>
    </>
  );
}

// --- Panneau de score --------------------------------------------------------

function ScorePanel({ result, answered, compact }: { result: ScoringResult; answered: number; compact: boolean }) {
  const countries = result.sections.filter((section) => ['UE', 'US', 'CN', 'AU'].includes(section.code));
  const framingDone = !result.missing.some((code) => /^C\d$/.test(code));
  return (
    <>
      <p className="score">
        <span className="score__value">{result.score === null ? '—' : result.score}</span>
        <span className="score__max">/ 100</span>
      </p>
      <p className="score__progress" aria-hidden="true">
        <span className="score__bar" style={{ width: `${result.score ?? 0}%` }} />
      </p>
      {/* Tant que le cadrage n'est pas fait, un verdict n'aurait aucun sens :
          toutes les questions notées compteraient pour zéro. */}
      <p className={`verdict verdict--${result.complete || result.verdict === 'blocked' ? result.verdict : 'pending'}`} role="status">
        {result.verdict === 'blocked'
          ? 'Refusée'
          : !framingDone
            ? 'Complétez le cadrage pour obtenir un verdict prévu'
            : result.complete
              ? VERDICT_LABELS[result.verdict]
              : `Verdict prévu : ${VERDICT_LABELS[result.verdict].split(' — ')[0]}`}
      </p>
      <p className="muted score__hint">
        Conforme dès 86, test de 61 à 85. {answered} question{answered > 1 ? 's' : ''} renseignée
        {answered > 1 ? 's' : ''} sur {result.applicable.length}.
      </p>

      {result.cappedBy.length > 0 && (
        <p className="notice notice--danger">
          Plafonné à {CRITICAL_CAP} par : {result.cappedBy.join(', ')}.
        </p>
      )}

      {countries.length > 0 && (
        <div className="country-bars">
          <h3 className="subsection-title">Par pays</h3>
          <SectionBars sections={countries} />
        </div>
      )}

      {!compact && result.sections.length > 0 && (
        <div className="country-bars">
          <h3 className="subsection-title">Par thème</h3>
          <SectionBars sections={result.sections.filter((section) => !countries.includes(section))} />
        </div>
      )}
    </>
  );
}

function SectionBars({ sections }: { sections: SectionScore[] }) {
  return (
    <ul className="section-bars">
      {sections.map((section) => (
        <li key={section.code} className="section-bar">
          <span className="section-bar__label">{shortLabel(section.label)}</span>
          <span className="section-bar__value mono">{section.score ?? 0} %</span>
          <span className="section-bar__track" aria-hidden="true">
            <span className="section-bar__fill" style={{ width: `${section.score ?? 0}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

// --- Étape de résultat ----------------------------------------------------------

interface ResultStepProps {
  result: ScoringResult;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  summaryRef: React.RefObject<HTMLDivElement | null>;
  errors: FieldErrors;
  canSubmit: boolean;
  readOnly: boolean;
  busy: boolean;
  applicationId: number;
  onBack: () => void;
  onSubmit: () => void;
  onSave: () => void;
}

function ResultStep({
  result, headingRef, summaryRef, errors, canSubmit, readOnly, busy, applicationId, onBack, onSubmit, onSave,
}: ResultStepProps) {
  const top = result.recommendations.slice(0, 5);
  const answered = result.applicable.length - result.missing.filter((code) => result.applicable.includes(code)).length;

  /** Points bruts convertis sur l'échelle du score : le barème brut n'est pas montré. */
  const scoreGain = (points: number) =>
    result.pointsApplicable > 0 ? Math.round((points / result.pointsApplicable) * 100) : 0;

  return (
    <Card>
      <h2 ref={headingRef} tabIndex={-1} className="wizard__title">
        Résultat
      </h2>

      <FormErrorSummary ref={summaryRef} errors={errors} labels={PRELIMINARY_LABELS} onFocusField={focusField} />

      {result.verdict === 'blocked' ? (
        <Alert tone="error">
          <strong>Évaluation refusée.</strong> {result.blockMessage}
        </Alert>
      ) : !result.complete ? (
        <Alert tone="warning">
          Il reste {result.missing.length} question{result.missing.length > 1 ? 's' : ''} sans réponse : le score
          ci-dessous est provisoire et la soumission n'est pas encore possible.
        </Alert>
      ) : null}

      <ScorePanel result={result} answered={answered} compact={false} />

      {top.length > 0 && result.verdict !== 'blocked' && (
        <>
          <h3 className="subsection-title">Pour gagner des points</h3>
          <ol className="recommendations">
            {top.map((recommendation) => (
              <li key={recommendation.code} className={cx('recommendation', recommendation.critical && 'recommendation--critical')}>
                <span className="recommendation__gain mono">
                  +{scoreGain(recommendation.pointsRecoverable)} pt
                  {scoreGain(recommendation.pointsRecoverable) > 1 ? 's' : ''}
                </span>
                <span className="recommendation__body">
                  <strong>{recommendation.code}</strong> — {recommendation.remediation}
                </span>
              </li>
            ))}
          </ol>
          {result.recommendations.length > top.length && (
            <p className="muted">
              {result.recommendations.length - top.length} autre{result.recommendations.length - top.length > 1 ? 's' : ''}{' '}
              action{result.recommendations.length - top.length > 1 ? 's' : ''} figureront dans le plan d'action après soumission.
            </p>
          )}
        </>
      )}

      <div className="wizard__nav">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          ← Précédent
        </Button>
        {!readOnly && (
          <Button variant="secondary" onClick={onSave} disabled={busy}>
            Enregistrer le brouillon
          </Button>
        )}
        {canSubmit ? (
          <Button onClick={onSubmit} disabled={busy || (!result.complete && result.verdict !== 'blocked')}>
            {busy ? 'En cours…' : "Soumettre l'évaluation"}
          </Button>
        ) : (
          <p className="muted">
            Seuls un auditeur ou l'AI Officer peuvent soumettre l'évaluation et déclencher le verdict.{' '}
            <Link to={`/applications/${applicationId}`}>Retour à la fiche</Link>.
          </p>
        )}
      </div>
    </Card>
  );
}
