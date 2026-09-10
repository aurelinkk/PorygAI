/**
 * Fiche d'évaluation de conformité IA : assistant par étapes (questionnaire v2).
 *
 * Une étape par section applicable, le cadrage d'abord, le résultat en dernier.
 * Les sections et les questions affichées dépendent des réponses de cadrage
 * (`applicableSections` / `applicableQuestions` de @poryg/shared) : elles sont
 * recalculées à chaque réponse, donc une question peut apparaître ou disparaître.
 *
 * Le score n'est PAS affiché pendant la saisie : le voir monter pousse à
 * répondre pour la note plutôt que pour décrire la réalité. Il apparaît à la
 * dernière étape seulement. Le client calcule quand même `scoreEvaluation` : il
 * en a besoin pour savoir quelles questions s'appliquent et signaler les
 * manquements critiques : mais seul le calcul du serveur, à la soumission, fait foi.
 *
 * Le brouillon est enregistré automatiquement à chaque changement d'étape.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BUSINESS_CRITICALITIES, CRITICAL_CAP, MINUTES_PER_QUESTION, QUESTIONNAIRE_VERSION, VERDICT_LABELS,
  applicableQuestions, applicableSections, scoreEvaluation, submitEvaluationSchema,
  type ActionPlanDto, type AnswerValue, type Answers, type ApplicationDto, type EvaluationDto,
  type FinopsImpactDto, type ScoringResult, type Section, type SectionCode, type SectionScore,
} from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/useApi';
import type { EvaluationResponse } from '../components/EvaluationSummary';
import { FinopsImpact } from '../components/FinopsImpact';
import { QuestionCard } from '../components/QuestionCard';
import { Alert, FormErrorSummary } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField, TextField, TextareaField } from '../components/ui/Fields';
import { LoadingScreen } from '../components/ui/Loading';
import { cx, formatDate } from '../lib/format';
import { focusField, zodFieldErrors, type FieldErrors } from '../lib/forms';

const PRELIMINARY_LABELS: Record<string, string> = {
  toolVendor: 'Outil & éditeur',
  purpose: 'Finalité précise',
  businessCriticality: 'Criticité métier',
  answers: 'Questionnaire',
};

type Step = { kind: 'section'; section: Section } | { kind: 'result' };

/** Libellé court d'un bloc pays pour les barres. */
const shortLabel = (label: string) => label.replace('Réglementation : ', '');

/** Pourcentage entier, sans division par zéro. */
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

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

  /**
   * Pré-remplissage, une seule fois : le brouillon en cours s'il existe, sinon la
   * dernière évaluation soumise.
   *
   * Une réévaluation part rarement de zéro : l'application n'a changé que sur les
   * points corrigés. Recopier l'évaluation précédente évite de resaisir quarante
   * réponses pour n'en modifier qu'une, et met le changement en évidence.
   * Rien n'est figé : chaque réponse reste modifiable, et le serveur recalcule
   * tout à la soumission.
   */
  const [prefilled, setPrefilled] = useState<EvaluationDto | null>(null);
  useEffect(() => {
    if (loaded || !evaluation.data) return;
    const previous = evaluation.data.history.find((entry) => entry.status === 'submitted') ?? null;
    const source = evaluation.data.draft ?? previous;
    if (source) {
      setToolVendor(source.toolVendor);
      setPurpose(source.purpose);
      setBusinessCriticality(source.businessCriticality ?? '');
      setAnswers(source.answers);
      setComments(source.comments);
      if (!evaluation.data.draft) setPrefilled(previous);
    }
    setLoaded(true);
    // L'état chargé compte comme déjà enregistré tant que rien n'a bougé.
    if (evaluation.data.draft) {
      savedSnapshot.current = JSON.stringify({
        toolVendor: evaluation.data.draft.toolVendor,
        purpose: evaluation.data.draft.purpose,
        businessCriticality: evaluation.data.draft.businessCriticality || null,
        answers: evaluation.data.draft.answers,
        comments: evaluation.data.draft.comments,
      });
    }
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

  /**
   * Empreinte de ce qui est enregistré. Comparée à la dernière sauvegarde, elle
   * évite d'écrire un brouillon identique à chaque changement d'étape : chaque
   * écriture laisse une ligne dans le journal d'audit, et douze étapes
   * parcourues sans rien saisir en laissaient douze pour rien.
   */
  const snapshot = () => JSON.stringify(payload());
  const savedSnapshot = useRef<string | null>(null);

  async function saveDraft(silent: boolean): Promise<boolean> {
    if (readOnly) return true;
    if (silent && savedSnapshot.current === snapshot()) return true;
    setSaving(true);
    setGlobalError(null);
    try {
      const envoye = snapshot();
      await api.put(`/api/applications/${id}/evaluation`, payload());
      savedSnapshot.current = envoye;
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
   * le cadrage, déjà rempli : il doit garder sa coche tout en étant l'étape en cours.
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
            {app.code} · questionnaire {QUESTIONNAIRE_VERSION} · étape {stepIndex + 1}/{steps.length}
          </p>
          <h1 className="page-title">Évaluation de conformité</h1>
        </div>
        <ButtonLink to={`/applications/${id}`} variant="ghost" small>
          ← Retour à la fiche
        </ButtonLink>
      </div>

      {globalError && <Alert tone="error">{globalError}</Alert>}
      {flash && <Alert tone="success">{flash}</Alert>}
      {prefilled && !readOnly && (
        <Alert tone="info">
          Formulaire prérempli avec l'évaluation du {formatDate(prefilled.submittedAt ?? prefilled.updatedAt)}
          {prefilled.submittedBy ? `, soumise par ${prefilled.submittedBy.displayName}` : ''}. Corrigez les
          réponses qui ont changé : le reste est déjà là.
        </Alert>
      )}
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
                    {done && <span className="visually-hidden">: étape terminée</span>}
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
                    hint="Ex. « Copilot : Microsoft », « Modèle interne : équipe Data »."
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
              finopsImpact={evaluation.data?.finopsImpact ?? null}
              answers={answers}
              aiType={app.aiType}
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

        {/* --- Bandeau de droite : parcours (cadrage), puis avancement ----------
            Pas de score ici : les conséquences d'une réponse critique ou bloquante
            sont signalées par `QuestionCard`, sous la question concernée. */}
        <aside className="wizard__side">
          {step.kind === 'section' && step.section.code === 'framing' && result.applicable.length > 0 && (
            <Card title="Votre parcours" titleId="parcours-title" className="eval-side">
              <p role="status">
                <strong>
                  {result.applicable.length} question{result.applicable.length > 1 ? 's' : ''}
                </strong>{' '}
                vous concernent : environ {result.estimatedMinutes} minute
                {result.estimatedMinutes > 1 ? 's' : ''}.
              </p>
              <p className="muted">
                Le cadrage détermine les questions affichées : ce nombre change à chaque réponse.
              </p>
            </Card>
          )}
          {step.kind === 'section' && step.section.code !== 'framing' && (
            <Card title="Votre avancement" titleId="progress-title" className="eval-side">
              <ProgressPanel result={result} section={step.section.code} answered={answeredCount} />
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

// --- Panneau d'avancement -----------------------------------------------------

/**
 * Où en est la saisie, sur les étapes notées.
 *
 * Deux barres : l'étape affichée, puis l'ensemble du questionnaire : et la liste
 * des étapes qu'il reste à remplir. Le cadrage garde son propre encadré (nombre de
 * questions et durée) : il n'est pas noté, il n'a rien à compter ici.
 *
 * Le compte porte sur les questions **applicables** : il descend quand une réponse
 * de cadrage masque des questions, ce qui est le comportement voulu.
 */
function ProgressPanel({
  result, section, answered,
}: { result: ScoringResult; section: SectionCode; answered: number }) {
  const current = result.sections.find((entry) => entry.code === section);
  const total = result.applicable.length;
  const remaining = total - answered;
  const todo = result.sections.filter((entry) => entry.answered < entry.total);
  const minutesLeft = Math.max(1, Math.round(remaining * MINUTES_PER_QUESTION));

  return (
    <>
      <ul className="section-bars">
        {current && (
          <ProgressBar label="Cette étape" done={current.answered} total={current.total} />
        )}
        <ProgressBar label="Tout le questionnaire" done={answered} total={total} />
      </ul>

      <p className="muted score__hint progress__summary" role="status">
        {remaining === 0
          ? 'Toutes les questions applicables sont renseignées.'
          : `Il reste ${remaining} question${remaining > 1 ? 's' : ''} à remplir, ` +
            `environ ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`}
      </p>

      {todo.length > 0 && (
        <>
          <h3 className="subsection-title">Étapes incomplètes</h3>
          <ul className="todo-list">
            {todo.map((entry) => (
              <li key={entry.code} className={cx('todo-list__item', entry.code === section && 'todo-list__item--current')}>
                <span>
                  {shortLabel(entry.label)}
                  {/* Le fond rose est décoratif : l'étape en cours est aussi dite en toutes lettres. */}
                  {entry.code === section && <span className="visually-hidden"> : étape en cours</span>}
                </span>
                <span className="mono">
                  {entry.total - entry.answered} restante{entry.total - entry.answered > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Une barre « x sur y ». La barre est décorative : le compte est écrit à côté. */
function ProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <li className="section-bar">
      <span className="section-bar__label">{label}</span>
      <span className="section-bar__value mono">{done}/{total}</span>
      <span className="section-bar__track" aria-hidden="true">
        <span className="section-bar__fill" style={{ width: `${percent(done, total)}%` }} />
      </span>
    </li>
  );
}

// --- Panneau de score --------------------------------------------------------

function ScorePanel({ result, answered }: { result: ScoringResult; answered: number }) {
  const countries = result.sections.filter((section) => ['UE', 'US', 'CN', 'AU'].includes(section.code));
  const framingDone = !result.missing.some((code) => /^C\d$/.test(code));
  return (
    <>
      <p className="score">
        <span className="score__value">{result.score === null ? ':' : result.score}</span>
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
              : `Verdict prévu : ${VERDICT_LABELS[result.verdict].split(' : ')[0]}`}
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

      {result.sections.length > 0 && (
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
  /** Relevé FinOps de l'application ; `null` sans `finops:read`. */
  finopsImpact: FinopsImpactDto | null;
  /** Réponses en cours : le modèle d'estimation lit GF5, GF6 et GF7. */
  answers: Answers;
  /** Type d'IA de la fiche : première entrée du modèle d'estimation. */
  aiType: string;
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
  result, finopsImpact, answers, aiType, headingRef, summaryRef, errors, canSubmit, readOnly, busy,
  applicationId, onBack, onSubmit, onSave,
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

      <ScorePanel result={result} answered={answered} />

      {/* L'impact ne dépend pas du verdict : une application conforme coûte et
          consomme autant qu'une autre. L'estimation s'affiche pour tout le monde ;
          seul le relevé de coûts demande `finops:read`. */}
      <FinopsImpact
        impact={finopsImpact}
        answers={answers}
        aiType={aiType}
        applicationId={applicationId}
        adjustment={result.finops}
      />

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
                  <strong>{recommendation.code}</strong> : {recommendation.remediation}
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
