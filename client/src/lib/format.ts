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

/** Énergie en kWh, ou en MWh au-delà de mille : « 42 000 kWh » se lit mal. */
export function formatKwh(kwh: number): string {
  if (kwh >= 1000) return `${(kwh / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} MWh`;
  if (kwh > 0 && kwh < 1) return '< 1 kWh';
  return `${kwh.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh`;
}

/**
 * Empreinte carbone, en kg ou en tonnes de CO₂ équivalent.
 *
 * Une valeur strictement positive mais inférieure au kilo s'écrit « < 1 kg » et
 * non « 0 kg » : arrondi à l'unité, une petite application paraîtrait sans impact.
 */
export function formatCo2(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t CO₂`;
  if (kg > 0 && kg < 1) return '< 1 kg CO₂';
  return `${kg.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kg CO₂`;
}
