/**
 * Cycle de vie d'une application IA.
 *
 *   draft ──► in_progress ──► compliant ──┐
 *                 ▲     └──► non_compliant │
 *                 └────────(après 1 an)────┘
 *
 *   deleted : suppression logique, depuis n'importe quel statut (jamais de DELETE SQL).
 */
export const APP_STATUSES = ['draft', 'in_progress', 'compliant', 'non_compliant', 'deleted'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const STATUS_LABELS: Record<AppStatus, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  compliant: 'Conforme',
  non_compliant: 'Non conforme',
  deleted: 'Deleted',
};

/** Description courte affichée en aide contextuelle (reprise de la charte). */
export const STATUS_DESCRIPTIONS: Record<AppStatus, string> = {
  draft: 'En cours de saisie. Modifiable par le Process Owner, invisible des tableaux de conformité.',
  in_progress: "En cours d'audit. Statut automatique un an après la mise en conformité.",
  compliant: "Toutes les exigences sont satisfaites. Valable 12 mois, date d'échéance affichée.",
  non_compliant: "Motif obligatoire et plan d'action suggéré, avec échéance et responsable.",
  deleted: 'Suppression logique uniquement. Traçabilité « par qui / quand » conservée.',
};

/** Durée de validité d'une conformité (règle de gestion du brief). */
export const COMPLIANCE_VALIDITY_MONTHS = 12;
