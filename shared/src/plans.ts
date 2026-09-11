/**
 * Formules d'abonnement d'une organisation.
 *
 * Une formule ne change RIEN aux fonctionnalités : elle ne fixe que deux
 * plafonds, le nombre d'applications déclarées et le nombre de personnes.
 * C'est volontaire : brider l'évaluation éthique derrière un paiement serait
 * contraire à l'objet du produit.
 *
 * ⚠️ Aucun paiement réel n'est encaissé. Choisir une formule payante enregistre
 * un choix (et le journalise), rien de plus : il n'y a ni prestataire de
 * paiement, ni facture, ni prélèvement. Le jour où il en faudrait un, c'est ici
 * que se brancherait la facturation, et nulle part ailleurs.
 *
 * Les plafonds sont appliqués par le SERVEUR (organizations.repo.ts) ; le client
 * ne fait qu'afficher la jauge.
 */

export const PLANS = ['free', 'team', 'business'] as const;
export type Plan = (typeof PLANS)[number];

export interface PlanDefinition {
  code: Plan;
  label: string;
  /** Prix mensuel affiché, en euros. 0 = gratuit. */
  priceEurPerMonth: number;
  /** Une phrase : à qui s'adresse la formule. */
  tagline: string;
  /** Plafonds : `null` = pas de plafond. */
  maxApplications: number | null;
  maxMembers: number | null;
  /** Ce que la formule apporte, pour la page de choix. */
  features: string[];
}

export const PLAN_DEFINITIONS: Record<Plan, PlanDefinition> = {
  free: {
    code: 'free',
    label: 'Découverte',
    priceEurPerMonth: 0,
    tagline: 'Pour essayer le registre sur un premier périmètre.',
    maxApplications: 4,
    maxMembers: 5,
    features: [
      "Jusqu'à 4 applications IA déclarées",
      "Jusqu'à 5 personnes dans l'organisation",
      'Questionnaire éthique complet et plans d’action',
      'Tableaux de bord et rapport FinOps',
    ],
  },
  team: {
    code: 'team',
    label: 'Équipe',
    priceEurPerMonth: 49,
    tagline: "Pour une direction ou une filiale qui recense tout son parc d'IA.",
    maxApplications: 25,
    maxMembers: 25,
    features: [
      "Jusqu'à 25 applications IA déclarées",
      "Jusqu'à 25 personnes dans l'organisation",
      'Import des comptes par fichier',
      'Tout ce que contient la formule Découverte',
    ],
  },
  business: {
    code: 'business',
    label: 'Entreprise',
    priceEurPerMonth: 199,
    tagline: "Pour un groupe entier, sans avoir à surveiller un plafond.",
    maxApplications: null,
    maxMembers: null,
    features: [
      'Applications IA en nombre illimité',
      'Personnes en nombre illimité',
      'Import des comptes par fichier',
      'Tout ce que contient la formule Équipe',
    ],
  },
};

/** Les formules dans l'ordre d'affichage (de la moins chère à la plus chère). */
export const PLAN_LIST: PlanDefinition[] = PLANS.map((plan) => PLAN_DEFINITIONS[plan]);

export const PLAN_LABELS: Record<Plan, string> = {
  free: PLAN_DEFINITIONS.free.label,
  team: PLAN_DEFINITIONS.team.label,
  business: PLAN_DEFINITIONS.business.label,
};

/**
 * Nombre d'organisations qu'une même personne peut créer.
 *
 * Ce n'est pas une limite commerciale mais un garde-fou : l'endpoint de création
 * est ouvert à toute personne connectée (sans quoi un compte neuf n'aurait aucun
 * moyen d'entrer), et rien ne l'empêcherait sinon d'en fabriquer des milliers.
 */
export const MAX_ORGANIZATIONS_PER_USER = 10;

/** Ce qui est plafonné par une formule. */
export type Quota = 'applications' | 'members';

export const QUOTA_LABELS: Record<Quota, { singular: string; plural: string }> = {
  applications: { singular: 'application', plural: 'applications' },
  members: { singular: 'personne', plural: 'personnes' },
};

/** Plafond d'une formule pour un quota donné (`null` = illimité). */
export function planLimit(plan: Plan, quota: Quota): number | null {
  const definition = PLAN_DEFINITIONS[plan];
  return quota === 'applications' ? definition.maxApplications : definition.maxMembers;
}

/**
 * Reste-t-il de la place ? `current` est le nombre déjà consommé.
 * Une formule sans plafond répond toujours oui.
 */
export function hasRoomFor(plan: Plan, quota: Quota, current: number): boolean {
  const limit = planLimit(plan, quota);
  return limit === null || current < limit;
}

/** « 4 » ou « illimité » : un plafond, tel qu'on l'écrit à l'écran. */
export function formatLimit(limit: number | null): string {
  return limit === null ? 'illimité' : String(limit);
}

/**
 * Message affiché quand un plafond bloque une action. Il nomme la formule et le
 * plafond atteint : « on ne peut pas » sans dire pourquoi est inutilisable.
 */
export function quotaMessage(plan: Plan, quota: Quota): string {
  const limit = planLimit(plan, quota);
  const mot = QUOTA_LABELS[quota];
  return (
    `La formule ${PLAN_DEFINITIONS[plan].label} est limitée à ${limit} ${limit === 1 ? mot.singular : mot.plural}. ` +
    'Choisissez une formule supérieure dans « Mon organisation » pour aller au-delà.'
  );
}
