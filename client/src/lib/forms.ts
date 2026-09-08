/** Aides pour les formulaires validés par Zod (mêmes schémas que le serveur). */
import type { ZodError } from 'zod';

export type FieldErrors = Record<string, string>;

/** ZodError → { champ: 'message' } (premier message par champ). */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** Donne le focus au premier champ en erreur (ordre du formulaire). */
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  const target = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
  target?.focus();
}

/** Focus un champ par son id (ou le premier bouton radio d'un groupe portant ce name). */
export function focusField(id: string): void {
  const byId = document.getElementById(id);
  const target = byId?.matches('fieldset')
    ? byId.querySelector<HTMLElement>('input')
    : byId ?? document.querySelector<HTMLElement>(`[name="${id}"]`);
  target?.focus();
}
