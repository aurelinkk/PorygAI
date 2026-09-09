/** Types des objets échangés entre l'API et le client (DTO). */
import type { Role } from './roles.js';
import type { AppStatus } from './statuses.js';

/** Helpers de mois 'YYYY-MM', partagés client/serveur. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Décale un mois 'YYYY-MM' de `delta` mois (négatif pour reculer). */
export function shiftMonth(month: string, delta: number): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return monthKey(date);
}

export interface UserDto {
  id: number;
  email: string;
  displayName: string;
  role: Role;
}

/** Référence légère vers un utilisateur (auteur, propriétaire…). */
export interface UserRef {
  id: number;
  displayName: string;
}

export interface ApplicationDto {
  id: number;
  code: string; // ex. APP-0142
  name: string;
  description: string;
  businessDomain: string;
  dataSensitivity: string;
  aiType: string;
  processOwner: UserRef;
  status: AppStatus;
  complianceValidUntil: string | null; // ISO 8601
  createdAt: string;
  createdBy: UserRef | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: UserRef | null;
}

export interface DashboardSummaryDto {
  applications: number; // hors deleted
  compliant: number;
  inProgress: number;
  nonCompliant: number;
  monthlyCostEur: number; // mois courant
  month: string; // 'YYYY-MM'
  recent: ApplicationDto[];
  /** Bloc "Mes évaluations" : dépend du rôle (mes apps à compléter, apps à auditer…) */
  myEvaluations: { application: ApplicationDto; hint: string }[];
}

/** Une évaluation de conformité (fiche d'évaluation IA). */
export interface EvaluationDto {
  id: number;
  applicationId: number;
  questionnaireVersion: string;
  /** 'draft' : saisie en cours · 'submitted' : soumise, verdict rendu. */
  status: 'draft' | 'submitted';
  toolVendor: string;
  purpose: string;
  businessCriticality: string | null;
  answers: Record<string, 0 | 1 | 2>;
  comments: Record<string, string>;
  score: number | null;
  maxScore: number;
  redFlags: string[];
  decision: 'compliant' | 'non_compliant' | null;
  createdBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
  submittedBy: UserRef | null;
  submittedAt: string | null;
}

/** Une action corrective, générée automatiquement à partir d'une réponse insuffisante. */
export interface ActionPlanDto {
  id: number;
  applicationId: number;
  evaluationId: number | null;
  questionCode: string | null;
  title: string;
  description: string;
  status: 'open' | 'done';
  owner: UserRef | null;
  dueDate: string | null;
  createdAt: string;
  doneBy: UserRef | null;
  doneAt: string | null;
}

/** Un coût mensuel saisi pour une application. */
export interface ApplicationCostDto {
  id: number;
  applicationId: number;
  periodMonth: string; // 'YYYY-MM'
  amountEur: number;
  source: string;
  createdBy: UserRef | null;
  createdAt: string;
}

/** Une ligne de répartition du rapport FinOps. */
export interface FinopsBreakdownRow {
  key: string;
  label: string;
  amountEur: number;
  /** Part du total, entre 0 et 1. */
  share: number;
  applications: number;
}

/**
 * Rapport FinOps — phase « Inform » : répartir la dépense et la rendre lisible.
 * Tous les montants sont en euros, sur les applications non supprimées.
 */
export interface FinopsReportDto {
  /** Mois analysé (le plus récent de la fenêtre), au format 'YYYY-MM'. */
  currentMonth: string;
  currentTotal: number;
  previousMonth: string;
  previousTotal: number;
  /** Variation en % par rapport au mois précédent ; `null` si le mois précédent est à zéro. */
  variationPct: number | null;
  /** Total sur toute la fenêtre analysée. */
  windowTotal: number;
  /** Série mensuelle complète, mois sans dépense inclus (à zéro). */
  monthly: { month: string; amountEur: number }[];
  /** Applications les plus coûteuses sur le mois courant, de la plus chère à la moins chère. */
  byApplication: (FinopsBreakdownRow & { applicationId: number; code: string; status: AppStatus })[];
  byDomain: FinopsBreakdownRow[];
  /** Le croisement clé : combien coûte ce qui n'est pas conforme. */
  byStatus: FinopsBreakdownRow[];
  /** Qualité de la donnée : applications actives sans coût saisi pour le mois courant. */
  coverage: {
    withCost: number;
    total: number;
    missing: { id: number; code: string; name: string }[];
  };
}

/** Une entrée du journal d'audit, prête à afficher. */
export interface AuditEntryDto {
  id: number;
  at: string;
  /** `null` = action automatique du système (ex. expiration de conformité). */
  actor: UserRef | null;
  action: string;
  /** Champs réellement modifiés (renseigné pour les actions de mise à jour). */
  changes: { field: string; before: unknown; after: unknown }[];
}

/** Libellés français des actions journalisées. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: 'Déclaration',
  seed: 'Jeu de démonstration',
  update: 'Modification',
  submit: "Envoi à l'audit",
  delete: 'Suppression',
  restore: 'Restauration',
  compliance_expired: 'Conformité expirée (automatique)',
  evaluation_saved: "Évaluation enregistrée (brouillon)",
  evaluation_submitted: 'Évaluation soumise',
  action_plan_done: "Action corrective terminée",
};

/** Format d'erreur unique renvoyé par l'API. */
export interface ApiErrorBody {
  error: {
    code: string; // 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | ...
    message: string;
    /** Pour VALIDATION_ERROR : champ → message */
    fields?: Record<string, string>;
  };
}
