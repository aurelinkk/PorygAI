/**
 * Cycle de vie d'une application IA.
 *
 *   draft ──► in_progress ──► compliant ────────────┐
 *                 ▲     ├──► partially_compliant    │
 *                 │     └──► non_compliant          │
 *                 └────────(après 1 an)─────────────┘
 *
 *   partially_compliant : autorisée en test / pilote, sans échéance automatique :
 *                         elle y reste jusqu'à une nouvelle évaluation.
 *   deleted : suppression logique, depuis n'importe quel statut (jamais de DELETE SQL).
 */
export const APP_STATUSES = [
  'draft',
  'in_progress',
  'compliant',
  'partially_compliant',
  'non_compliant',
  'deleted',
] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const STATUS_LABELS: Record<AppStatus, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  compliant: 'Conforme',
  partially_compliant: 'Partiellement conforme',
  non_compliant: 'Non conforme',
  deleted: 'Deleted',
};

/** Description courte affichée en aide contextuelle (reprise de la charte). */
export const STATUS_DESCRIPTIONS: Record<AppStatus, string> = {
  draft: 'En cours de saisie. Modifiable par le Process Owner, invisible des tableaux de conformité.',
  in_progress: "En cours d'audit. Statut automatique un an après la mise en conformité.",
  compliant: "Score ≥ 86/100 : déployable en production. Valable 12 mois, date d'échéance affichée.",
  partially_compliant:
    'Score de 61 à 85/100 : autorisée en test ou pilote uniquement. Sans échéance, jusqu’à réévaluation.',
  non_compliant: 'Score ≤ 60/100, critère critique manqué ou pratique refusée : non déployable. Plan d’action généré.',
  deleted: 'Suppression logique uniquement. Traçabilité « par qui / quand » conservée.',
};

/** Statuts issus d'une décision d'évaluation (par opposition à draft / in_progress / deleted). */
export const DECIDED_STATUSES: readonly AppStatus[] = ['compliant', 'partially_compliant', 'non_compliant'];

/** Durée de validité d'une conformité (règle de gestion du brief). */
export const COMPLIANCE_VALIDITY_MONTHS = 12;
