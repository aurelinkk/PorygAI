/** Types des objets échangés entre l'API et le client (DTO). */
import type { Role } from './roles.js';
import type { AppStatus } from './statuses.js';

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
