/** Formatage pour l'affichage (fr-FR). */

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Paris' });
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' });
const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShortFormatter = new Intl.DateTimeFormat('fr-FR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });

export const formatDate = (iso: string) => dateFormatter.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormatter.format(new Date(iso));

/** '2026-09' → 'septembre 2026' */
export const formatMonth = (yyyyMm: string) => monthFormatter.format(new Date(`${yyyyMm}-01T00:00:00Z`));

/** ISO → '04/2027' (style charte : "expire 04/2027") */
export const formatMonthYear = (iso: string) => monthShortFormatter.format(new Date(iso));

/** 62000 → '62 k€' ; 950 → '950 €' */
export function formatEur(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return `${(amount / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  }
  return `${amount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

export const firstName = (displayName: string) => displayName.split(' ')[0] ?? displayName;

/** Concatène des classes CSS en ignorant les valeurs vides. */
export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
