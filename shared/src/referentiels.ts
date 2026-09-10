/**
 * Listes de valeurs (référentiels). Codées en dur pour le moment : simples,
 * versionnées avec le code. Elles passeront en base au lot "Administration"
 * si l'AI Officer doit pouvoir les modifier sans redéploiement.
 */

export const BUSINESS_DOMAINS = [
  { code: 'rh', label: 'Ressources humaines' },
  { code: 'finance', label: 'Finance' },
  { code: 'client', label: 'Relation client / Support' },
  { code: 'supply', label: 'Supply chain' },
  { code: 'marketing', label: 'Marketing & Ventes' },
  { code: 'it', label: 'IT & Sécurité' },
  { code: 'juridique', label: 'Juridique & Conformité' },
  { code: 'rd', label: 'R&D / Produit' },
] as const;
export type BusinessDomain = (typeof BUSINESS_DOMAINS)[number]['code'];

/** Niveaux de sensibilité, du moins au plus sensible (les deux derniers relèvent du RGPD). */
export const DATA_SENSITIVITIES = [
  { code: 'public', label: 'Données publiques', hint: 'Aucune contrainte particulière.' },
  { code: 'internal', label: 'Données internes', hint: "Usage interne à l'entreprise." },
  { code: 'confidential', label: 'Données confidentielles', hint: 'Secret des affaires, données stratégiques.' },
  { code: 'personal', label: 'Données personnelles', hint: 'Données identifiant des personnes (RGPD).' },
  { code: 'sensitive', label: 'Données sensibles', hint: 'Santé, opinions, biométrie… (RGPD art. 9) : avis DPO requis.' },
] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITIES)[number]['code'];

export const AI_TYPES = [
  { code: 'genai', label: 'IA générative (LLM, images…)' },
  { code: 'ml_predictive', label: 'Machine learning prédictif / scoring' },
  { code: 'nlp', label: 'Traitement du langage (classification, extraction)' },
  { code: 'vision', label: 'Vision par ordinateur' },
  { code: 'recommendation', label: 'Recommandation / personnalisation' },
  { code: 'other', label: 'Autre / règles expertes' },
] as const;
export type AiType = (typeof AI_TYPES)[number]['code'];

/** Helper générique : code → libellé, avec repli sur le code inconnu. */
export function labelOf(list: readonly { code: string; label: string }[], code: string): string {
  return list.find((item) => item.code === code)?.label ?? code;
}
