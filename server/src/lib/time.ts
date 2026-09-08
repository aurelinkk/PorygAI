/** Helpers de dates. Tout est en UTC, format ISO 8601 (même format que SQLite). */

export const nowIso = (): string => new Date().toISOString();

/** 'YYYY-MM' du mois courant (clé des coûts FinOps). */
export const currentMonth = (): string => nowIso().slice(0, 7);

/** Ajoute (ou retire) des mois à une date ISO. */
export function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}
