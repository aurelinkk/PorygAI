/**
 * Champs de formulaire accessibles. Chaque champ relie explicitement :
 *   label ↔ champ (htmlFor/id), aide et erreur ↔ champ (aria-describedby),
 *   état invalide (aria-invalid). Les erreurs sont annoncées par le résumé en
 *   tête de formulaire (FormErrorSummary), pas champ par champ.
 */
import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '../../lib/format';

interface FieldBase {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

function FieldWrapper({ id, label, hint, error, required, children }: FieldBase & { children: ReactNode }) {
  return (
    <div className={cx('field', error && 'field--error')}>
      <label htmlFor={id} className="field__label">
        {label}
        {required && <span className="field__required"> *</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

/** `ref` est transmise à l'`<input>` : utile pour y placer le focus (React 19). */
type TextFieldProps = FieldBase &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required'> & { ref?: Ref<HTMLInputElement> };

export function TextField({ id, label, hint, error, required, className, ...input }: TextFieldProps) {
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error} required={required}>
      <input
        id={id}
        name={id}
        className={cx('input', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        aria-required={required || undefined}
        {...input}
      />
    </FieldWrapper>
  );
}

type TextareaFieldProps = FieldBase & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'required'>;

export function TextareaField({ id, label, hint, error, required, className, ...textarea }: TextareaFieldProps) {
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error} required={required}>
      <textarea
        id={id}
        name={id}
        className={cx('input', 'input--textarea', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        aria-required={required || undefined}
        {...textarea}
      />
    </FieldWrapper>
  );
}

interface Option {
  value: string;
  label: string;
}

type SelectFieldProps = FieldBase &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'required'> & {
    options: readonly Option[];
    placeholder?: string;
  };

export function SelectField({ id, label, hint, error, required, options, placeholder = '— Choisir —', className, ...select }: SelectFieldProps) {
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error} required={required}>
      <select
        id={id}
        name={id}
        className={cx('input', 'input--select', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        aria-required={required || undefined}
        {...select}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
}

interface RadioOption {
  value: string;
  label: string;
  hint?: string;
}

interface RadioGroupFieldProps extends FieldBase {
  options: readonly RadioOption[];
  value: string;
  onChange: (value: string) => void;
}

/** Groupe de boutons radio : fieldset + legend (le label du groupe est lu avec chaque option). */
export function RadioGroupField({ id, label, hint, error, required, options, value, onChange }: RadioGroupFieldProps) {
  return (
    <fieldset id={id} className={cx('field', 'field--group', error && 'field--error')} aria-describedby={describedBy(id, hint, error)}>
      <legend className="field__label">
        {label}
        {required && <span className="field__required"> *</span>}
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      <div className="radio-list">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <label key={option.value} htmlFor={optionId} className="radio">
              <input
                id={optionId}
                type="radio"
                name={id}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={option.hint ? `${optionId}-hint` : undefined}
              />
              <span className="radio__text">
                <span className="radio__label">{option.label}</span>
                {option.hint && (
                  <span id={`${optionId}-hint`} className="radio__hint">
                    {option.hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-error`} className="field__error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
