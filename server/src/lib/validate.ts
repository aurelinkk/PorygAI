import type { ZodType } from 'zod';
import { HttpError } from './http-errors.js';

/**
 * Valide `data` avec un schéma Zod (partagé avec le client) et renvoie la
 * valeur typée. En cas d'échec : 400 VALIDATION_ERROR avec un message par champ.
 */
export function validate<T>(schema: ZodType<T, any, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new HttpError(400, 'VALIDATION_ERROR', 'Certains champs sont invalides', fields);
}
