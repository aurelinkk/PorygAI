/** Types des objets échangés entre l'API et le client (DTO). */
import type { AnswerValue, SectionScore, Verdict } from './questionnaire.js';
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
  /**
   * Coût du mois en cours, toutes sources confondues.
   * `null` quand l'utilisateur n'a pas la permission `finops:read` : la donnée
   * n'est alors pas calculée du tout côté serveur, pas seulement masquée.
   */
  monthlyCostEur: number | null;
  createdAt: string;
  createdBy: UserRef | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: UserRef | null;
}

export interface DashboardSummaryDto {
  applications: number; // hors deleted
  compliant: number;
  partiallyCompliant: number;
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
  /** 'v1' (18 points, éliminatoires) ou 'v2' (sur 100, cadrage dynamique). */
  questionnaireVersion: string;
  /** 'draft' : saisie en cours · 'submitted' : soumise, verdict rendu. */
  status: 'draft' | 'submitted';
  toolVendor: string;
  purpose: string;
  businessCriticality: string | null;
  answers: Record<string, AnswerValue>;
  comments: Record<string, string>;
  /** v1 : 0–18 · v2 : 0–100. `maxScore` dit lequel. `null` si non soumise ou refusée. */
  score: number | null;
  maxScore: number;
  /** v2 : questions critiques manquées (plafond 60). v1 : critères éliminatoires à 0. */
  cappedBy: string[];
  /** Code de la question ayant refusé l'évaluation (v2), sinon `null`. */
  blockedBy: string | null;
  verdict: Verdict | null;
  /** Sous-scores par section, tels que calculés à la soumission (v2). */
  sections: SectionScore[];
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

/** Une saisie mensuelle : ce que l'application a coûté, consommé et émis. */
export interface ApplicationCostDto {
  id: number;
  applicationId: number;
  periodMonth: string; // 'YYYY-MM'
  amountEur: number;
  /** Énergie consommée sur le mois, en kWh. 0 = non déclarée. */
  energyKwh: number;
  /** Empreinte du mois, en kg CO₂ équivalent. 0 = non déclarée. */
  co2Kg: number;
  source: string;
  createdBy: UserRef | null;
  createdAt: string;
}

/** Une ligne de répartition du rapport FinOps. */
export interface FinopsBreakdownRow {
  key: string;
  label: string;
  amountEur: number;
  energyKwh: number;
  co2Kg: number;
  /** Part du total **en euros**, entre 0 et 1. */
  share: number;
  applications: number;
}

/** Un total sur une période : les trois grandeurs du FinOps responsable. */
export interface FinopsTotals {
  amountEur: number;
  energyKwh: number;
  co2Kg: number;
}

/**
 * Impact FinOps annoncé à la fin du questionnaire.
 *
 * C'est une **projection**, pas une prévision : la moyenne des mois réellement
 * déclarés, ramenée à douze mois. Rien n'est inventé : sans donnée déclarée,
 * `monthsObserved` vaut 0 et il n'y a pas d'impact à annoncer, ce qui est
 * précisément ce que la question F6 demande de corriger.
 */
export interface FinopsImpactDto {
  /** Nombre de mois portant des données, sur la fenêtre observée. */
  monthsObserved: number;
  /** Moyenne mensuelle observée. */
  monthly: FinopsTotals;
  /** Cette moyenne ramenée à douze mois. */
  yearly: FinopsTotals;
  /**
   * L'empreinte a-t-elle été **calculée** depuis la consommation, faute d'avoir
   * été déclarée ? Le dire évite de faire passer un calcul pour une mesure.
   */
  co2Derived: boolean;
}

/**
 * Un levier d'optimisation que les données justifient.
 * `code` renvoie à `FINOPS_LEVERS` (libellé et explication partagés).
 */
export interface FinopsLeverDto {
  code: string;
  /** Applications concernées, de la plus coûteuse à la moins coûteuse. */
  applications: { id: number; code: string; name: string; amountEur: number; reason: string }[];
  /** Dépense mensuelle portée par ces applications. */
  amountEur: number;
}

/**
 * Rapport FinOps : phase « Inform » : répartir la dépense et la rendre lisible.
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
  /** Énergie et carbone du mois courant, et de toute la fenêtre. */
  current: FinopsTotals;
  window: FinopsTotals;
  /** Série mensuelle complète, mois sans dépense inclus (à zéro). */
  monthly: { month: string; amountEur: number; energyKwh: number; co2Kg: number }[];
  /** Applications les plus coûteuses sur le mois courant, de la plus chère à la moins chère. */
  byApplication: (FinopsBreakdownRow & { applicationId: number; code: string; status: AppStatus })[];
  byDomain: FinopsBreakdownRow[];
  /** Le croisement clé : combien coûte ce qui n'est pas conforme. */
  byStatus: FinopsBreakdownRow[];
  /**
   * Qualité de la donnée : le principe de **visibilité** : ce qui n'est pas mesuré
   * ne peut pas être arbitré. Deux couvertures distinctes, parce que déclarer un
   * montant est devenu courant et déclarer une empreinte ne l'est pas encore.
   */
  coverage: {
    withCost: number;
    /** Applications dont l'énergie du mois est renseignée (> 0). */
    withFootprint: number;
    total: number;
    missing: { id: number; code: string; name: string }[];
  };
  /**
   * Frugalité du parc, reprise du thème « Frugalité et FinOps » (F) du
   * questionnaire : le lien entre ce qui coûte cher et ce qui est mal noté.
   */
  frugality: {
    /** Moyenne des sous-scores du thème F, `null` si aucune évaluation soumise. */
    averageScore: number | null;
    evaluated: number;
    /** Les plus coûteuses parmi les moins frugales, du plus cher au moins cher. */
    worstOffenders: {
      id: number; code: string; name: string; amountEur: number; frugalityScore: number;
    }[];
  };
  /** Leviers d'optimisation que les données justifient, du plus lourd au plus léger. */
  levers: FinopsLeverDto[];
}

/**
 * Rapport FinOps d'UNE application. Même lecture que le rapport global, mais
 * ramenée à une seule application, avec en plus sa part dans la dépense totale
 * et le détail des saisies (qui a saisi quoi, depuis quelle source).
 */
export interface ApplicationFinopsDto {
  applicationId: number;
  currentMonth: string;
  currentTotal: number;
  previousMonth: string;
  previousTotal: number;
  variationPct: number | null;
  /** Total sur la fenêtre analysée. */
  windowTotal: number;
  /** Énergie et carbone du mois courant, et de toute la fenêtre. */
  current: FinopsTotals;
  window: FinopsTotals;
  monthly: { month: string; amountEur: number; energyKwh: number; co2Kg: number }[];
  /** Répartition par source de coût, sur toute la fenêtre. */
  bySource: FinopsBreakdownRow[];
  /** Sous-score du thème « Frugalité et FinOps » de la dernière évaluation soumise. */
  frugalityScore: number | null;
  /** Dépense IA totale de l'entreprise sur le mois courant, pour situer l'application. */
  companyTotal: number;
  /** Part de cette application dans cette dépense (0 à 1). */
  shareOfCompany: number;
  /** Rang de l'application dans le classement des plus coûteuses (1 = la plus chère). */
  rank: number | null;
  rankedOver: number;
  /** Toutes les saisies, du mois le plus récent au plus ancien. */
  entries: ApplicationCostDto[];
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
  reevaluation_required: 'Retour en audit pour réévaluation',
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

// ---------------------------------------------------------------------------
// Tableaux de bord BI (lot 6)
// ---------------------------------------------------------------------------

/** Une ligne de répartition en nombre d'applications (et non en euros). */
export interface BiCountRow {
  key: string;
  label: string;
  count: number;
  /** Part du total, entre 0 et 1. */
  share: number;
}

/** Un mois de l'historique : ce qui est entré dans le parc, ce qui a été décidé. */
export interface BiHistoryRow {
  month: string; // 'YYYY-MM'
  declared: number;
  submitted: number;
  compliant: number;
  partiallyCompliant: number;
  nonCompliant: number;
}

/**
 * Tableaux de bord BI : historique et utilisation du parc d'applications IA.
 *
 * Complément du rapport FinOps, qui répond « combien ça coûte » : celui-ci
 * répond « où en est le parc, comment il évolue, et où ça coince ».
 * Toutes les données respectent la visibilité des brouillons de l'utilisateur.
 */
export interface BiReportDto {
  /** Profondeur d'historique analysée, en mois. */
  months: number;
  /** Mois le plus récent de la fenêtre. */
  currentMonth: string;

  /** État du parc au moment du calcul, applications supprimées exclues. */
  portfolio: {
    total: number;
    /** Part des applications décidées qui sont conformes (0 à 1), `null` si aucune décision. */
    complianceRate: number | null;
    byStatus: BiCountRow[];
    byDomain: BiCountRow[];
    bySensitivity: BiCountRow[];
    byAiType: BiCountRow[];
  };

  /** Un point par mois de la fenêtre, mois vides compris. */
  history: BiHistoryRow[];

  /** Ce que disent les évaluations soumises pendant la fenêtre. */
  quality: {
    submitted: number;
    /** Moyenne des scores sur 100, `null` si aucune évaluation soumise. */
    averageScore: number | null;
    /** Thèmes du questionnaire les plus faibles, du plus faible au moins faible. */
    weakestSections: { code: string; label: string; averageScore: number; evaluations: number }[];
    /** Questions le plus souvent répondues « Non », avec leur nombre d'occurrences. */
    topGaps: { code: string; section: string; wording: string; missed: number }[];
  };

  /** Plans d'action générés par les évaluations. */
  actions: {
    open: number;
    done: number;
    /** Actions ouvertes dont l'échéance est dépassée. */
    overdue: number;
  };

  /** Suivi de la règle « la conformité vaut un an ». */
  compliance: {
    /** Conformités qui expirent dans les 90 jours, de la plus proche à la plus lointaine. */
    expiringSoon: { id: number; code: string; name: string; validUntil: string; daysLeft: number }[];
    /** Applications déjà repassées en audit après expiration, sur la fenêtre. */
    expired: number;
  };

  /**
   * Utilisation de la plateforme, d'après le journal d'audit.
   * Ce n'est pas l'usage des applications IA elles-mêmes : Poryg'AI ne collecte
   * aucune télémétrie sur les outils inventoriés.
   */
  activity: {
    byMonth: { month: string; events: number }[];
    byAction: BiCountRow[];
    /** Personnes distinctes ayant agi sur la fenêtre. */
    activeUsers: number;
  };

  /** Coût IA du mois courant, `null` si l'utilisateur n'a pas accès au FinOps. */
  monthlyCostEur: number | null;
}
