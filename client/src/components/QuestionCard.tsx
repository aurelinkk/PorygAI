/**
 * Une question du questionnaire v2, quel que soit son type.
 *
 * Éléments natifs : un <fieldset> par question, des boutons radio (ou des cases
 * à cocher pour un choix multiple) dans des <label>. Le barème n'est pas affiché :
 * il n'aide pas la personne qui répond et l'incite à viser la note plutôt qu'à
 * décrire la réalité. Le score global ne l'est pas davantage, et pour la même
 * raison : il n'apparaît qu'à la dernière étape.
 *
 * Une option peut porter une **précision** (`hint`) : c'est ce qui permet de dire
 * quelles régions comptent comme « bas carbone » ou ce qu'est un « grand modèle ».
 * Elle est rattachée au bouton par `aria-describedby`, pas seulement posée à côté.
 *
 * Deux états font exception, parce qu'ils décident de ce qui pourra être déployé
 * et non d'un nombre de points : une réponse bloquante (l'évaluation s'arrête) et
 * un critère critique à « Non » (plafond à 60). Ils sont signalés ici, sous la
 * question concernée.
 */
import { CRITICAL_CAP, type AnswerValue, type Question } from '@poryg/shared';
import { cx } from '../lib/format';
import { TextField } from './ui/Fields';

interface QuestionCardProps {
  question: Question;
  value: AnswerValue | undefined;
  comment: string;
  disabled: boolean;
  onAnswer: (value: AnswerValue) => void;
  onComment: (comment: string) => void;
}

function asList(value: AnswerValue | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [String(value)];
}

export function QuestionCard({ question, value, comment, disabled, onAnswer, onComment }: QuestionCardProps) {
  const isNumber = question.kind === 'number';
  const isMulti = question.kind === 'multi';
  const selected = asList(value);
  const isBlockingAnswer = question.blockingValue !== undefined && selected.includes(question.blockingValue);
  const isCriticalFail = Boolean(question.critical) && selected.includes('0');

  function toggleMulti(optionValue: string) {
    // « Aucun » est exclusif : le cocher vide le reste, cocher autre chose le retire.
    if (optionValue === 'none') {
      onAnswer(selected.includes('none') ? [] : ['none']);
      return;
    }
    const without = selected.filter((item) => item !== optionValue && item !== 'none');
    onAnswer(selected.includes(optionValue) ? without : [...without, optionValue]);
  }

  // Options nombreuses ou libellés longs (« Oui : coûts complets et gains chiffrés… ») :
  // en colonne, sinon les pastilles se coupent au milieu d'une phrase.
  const stacked =
    (question.options?.length ?? 0) > 3
    || (question.options ?? []).some((option) => option.label.length > 40 || option.hint);

  return (
    <fieldset
      id={question.code}
      className={cx('question', isBlockingAnswer && 'question--blocked', isCriticalFail && 'question--flagged')}
    >
      <legend className="question__legend">
        <span className="question__code mono">{question.code}</span>
        {question.wording}
        {question.critical && (
          <span className="question__critical" title="Un « Non » plafonne le score à 60">
            critique
          </span>
        )}
        {question.blockingValue !== undefined && <span className="question__critical">bloquante</span>}
      </legend>

      {question.why && (
        <details className="question__why">
          <summary>Pourquoi cette question ?</summary>
          <p>{question.why}</p>
        </details>
      )}

      {isNumber ? (
        <TextField
          id={`value-${question.code}`}
          label={question.unit ?? 'Valeur'}
          type="number"
          min={0}
          step={1}
          inputMode="decimal"
          disabled={disabled}
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onAnswer(event.target.value)}
        />
      ) : (
        <div className={cx('question__choices', stacked && 'question__choices--stacked')}>
          {(question.options ?? []).map((option) => {
            const optionId = `${question.code}-${option.value}`;
            const checked = selected.includes(option.value);
            return (
              <label key={option.value} htmlFor={optionId} className="choice">
                <input
                  id={optionId}
                  type={isMulti ? 'checkbox' : 'radio'}
                  name={question.code}
                  value={option.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => (isMulti ? toggleMulti(option.value) : onAnswer(option.value))}
                  aria-describedby={option.hint ? `${optionId}-hint` : undefined}
                />
                <span className="choice__text">
                  <span className="choice__label">{option.label}</span>
                  {option.hint && (
                    <span id={`${optionId}-hint`} className="choice__hint">
                      {option.hint}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {isBlockingAnswer && (
        <p className="notice notice--danger" role="status">
          {question.blockMessage} L'évaluation sera refusée.
        </p>
      )}
      {isCriticalFail && !isBlockingAnswer && (
        <p className="notice notice--danger" role="status">
          Critère critique non satisfait : le score sera plafonné à {CRITICAL_CAP}, l'application ne sera pas
          déployable.
        </p>
      )}

      <TextField
        id={`comment-${question.code}`}
        label="Commentaire (facultatif)"
        maxLength={1000}
        disabled={disabled}
        value={comment}
        onChange={(event) => onComment(event.target.value)}
      />
    </fieldset>
  );
}
