/**
 * Message de retour. `error` est annoncé immédiatement (role=alert) ; les autres
 * tons sont annoncés poliment (role=status). `ref` + tabIndex permettent de
 * déplacer le focus sur le message (résumé d'erreurs de formulaire).
 */
import type { ReactNode, Ref } from 'react';
import { cx } from '../../lib/format';

interface AlertProps {
  tone?: 'error' | 'success' | 'warning' | 'info';
  ref?: Ref<HTMLDivElement>;
  className?: string;
  children: ReactNode;
}

export function Alert({ tone = 'info', ref, className, children }: AlertProps) {
  return (
    <div ref={ref} tabIndex={-1} role={tone === 'error' ? 'alert' : 'status'} className={cx('alert', `alert--${tone}`, className)}>
      {children}
    </div>
  );
}

interface FormErrorSummaryProps {
  errors: Record<string, string>;
  labels: Record<string, string>;
  onFocusField: (field: string) => void;
  ref?: Ref<HTMLDivElement>;
}

/** Résumé des erreurs en tête de formulaire, avec un lien vers chaque champ. */
export function FormErrorSummary({ errors, labels, onFocusField, ref }: FormErrorSummaryProps) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <Alert tone="error" ref={ref}>
      <p className="alert__title">
        {entries.length === 1 ? 'Le formulaire contient une erreur :' : `Le formulaire contient ${entries.length} erreurs :`}
      </p>
      <ul className="alert__list">
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${field}`}
              onClick={(event) => {
                event.preventDefault();
                onFocusField(field);
              }}
            >
              {labels[field] ?? field} : {message}
            </a>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
