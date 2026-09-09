/**
 * Une question du questionnaire v2, quel que soit son type.
 *
 * Éléments natifs : un <fieldset> par question, des boutons radio (ou des cases
 * à cocher pour un choix multiple) dans des <label>. Le score de chaque option
 * est affiché : l'utilisateur voit ce que sa réponse vaut.
 *
 * Deux états mis en évidence : une réponse bloquante (l'évaluation s'arrête)
 * et un critère critique à « Non » (plafond à 60).
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

/** Points d'une option, formatés (« 1 pt », « 0,5 pt »). */
function pointsLabel(question: Question, score: 0 | 1 | 2): string {
  const points = ((question.weight ?? 0) * score) / 2;
  return `${points.toLocaleString('fr-FR')} pt`;
}

export function QuestionCard({ question, value, comment, disabled, onAnswer, onComment }: QuestionCardProps) {
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

      <div className={cx('question__choices', question.options && question.options.length > 3 && 'question__choices--stacked')}>
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
              />
              <span className="choice__label">{option.label}</span>
              {option.score !== undefined && question.weight !== undefined && (
                <span className="choice__points mono">{pointsLabel(question, option.score)}</span>
              )}
            </label>
          );
        })}
      </div>

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
