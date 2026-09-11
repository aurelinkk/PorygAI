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

/**
 * Niveau le plus élevé d'une sélection de sensibilités.
 *
 * `DATA_SENSITIVITIES` est rangé du moins au plus sensible : le maximum est donc
 * simplement celui qui apparaît le plus loin dans la liste. Cette valeur dérivée
 * est ce que manipulent les agrégats (répartition par sensibilité), la règle
 * « avis DPO attendu » et le questionnaire : une application qui traite des
 * données publiques ET des données de santé doit être traitée comme une
 * application de santé.
 *
 * Renvoie `'public'` pour une liste vide : le cas le moins contraignant n'est
 * jamais le bon défaut pour une décision, mais la liste ne peut pas être vide
 * (le schéma Zod l'exige) et il faut bien une valeur de repli.
 */
export function highestSensitivity(codes: readonly string[]): string {
  let rang = -1;
  for (const code of codes) {
    const position = DATA_SENSITIVITIES.findIndex((item) => item.code === code);
    if (position > rang) rang = position;
  }
  return (DATA_SENSITIVITIES[rang] ?? DATA_SENSITIVITIES[0]).code;
}

/** Libellés d'une liste de codes, dans l'ordre du référentiel. */
export function labelsOf(list: readonly { code: string; label: string }[], codes: readonly string[]): string[] {
  return list.filter((item) => codes.includes(item.code)).map((item) => item.label);
}

/** Helper générique : code → libellé, avec repli sur le code inconnu. */
export function labelOf(list: readonly { code: string; label: string }[], code: string): string {
  return list.find((item) => item.code === code)?.label ?? code;
}
