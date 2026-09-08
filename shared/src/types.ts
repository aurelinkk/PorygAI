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

/** Format d'erreur unique renvoyé par l'API. */
export interface ApiErrorBody {
  error: {
    code: string; // 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | ...
    message: string;
    /** Pour VALIDATION_ERROR : champ → message */
    fields?: Record<string, string>;
  };
}
