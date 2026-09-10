/**
 * FinOps responsable : le vocabulaire partagé du module financier.
 *
 * Le FinOps classique optimise la facture cloud. Appliqué à l'IA, il suit en plus
 * le coût de l'entraînement et de l'inférence ; appliqué à l'IA **responsable**,
 * il arbitre entre trois grandeurs à la fois : le coût, l'énergie consommée et
 * l'empreinte carbone. Un modèle massif et un modèle frugal ne se départagent pas
 * sur le seul montant de la facture.
 *
 * Source : cours 6 « Applications pratiques, FinOps et perspectives ».
 */

/**
 * Facteur d'intensité carbone de l'électricité, en kg CO₂ équivalent par kWh.
 *
 * Valeur retenue : mix électrique français (~0,06 kg/kWh), très bas grâce au
 * nucléaire : la moyenne européenne est environ quatre fois plus élevée et la
 * moyenne mondiale sept fois.
 *
 * Il ne sert QU'À PROPOSER une valeur dans le formulaire de saisie : ce qui est
 * enregistré est toujours ce que la personne a validé, jamais un calcul caché.
 * Une application hébergée hors de France doit corriger la proposition.
 *
 * À faire valider et à dater : ce facteur évolue chaque année.
 */
export const CO2_KG_PER_KWH = 0.06;

/** Arrondi au centième, pour que les hypothèses affichées restent lisibles. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Empreinte proposée à la saisie pour une consommation donnée, en kg CO₂. */
export function estimateCo2(energyKwh: number): number {
  return Math.round(energyKwh * CO2_KG_PER_KWH * 100) / 100;
}

/**
 * Équivalence pour rendre une empreinte tangible : kg CO₂ par kilomètre en
 * voiture thermique. Ordre de grandeur (~120 g/km, véhicule neuf moyen), affiché
 * comme tel : il sert à se représenter une masse de carbone, pas à la certifier.
 */
export const CO2_KG_PER_CAR_KM = 0.12;

/** Kilomètres en voiture thermique équivalents à une empreinte donnée. */
export function carKmEquivalent(co2Kg: number): number {
  return Math.round(co2Kg / CO2_KG_PER_CAR_KM);
}

/**
 * Les trois principes du FinOps, qui structurent le rapport.
 * Ce ne sont pas des slogans : chacun correspond à un indicateur de la page.
 */
export const FINOPS_PRINCIPLES = [
  {
    code: 'visibility',
    label: 'Visibilité',
    description: 'Savoir ce que chaque application coûte et consomme, mois par mois.',
  },
  {
    code: 'accountability',
    label: 'Responsabilité',
    description: "Rattacher chaque dépense à une application et à son Process Owner.",
  },
  {
    code: 'optimisation',
    label: 'Optimisation continue',
    description: 'Ajuster les ressources pour éviter le gaspillage, et le vérifier dans la durée.',
  },
] as const;

export type FinopsPrinciple = (typeof FINOPS_PRINCIPLES)[number]['code'];

/**
 * Les leviers d'optimisation d'une IA frugale.
 *
 * Le rapport n'en affiche que ceux que les données justifient : un levier sans
 * application concernée est un conseil générique, et un conseil générique ne se
 * met pas en œuvre.
 */
export const FINOPS_LEVERS: Record<string, { label: string; description: string; principle: FinopsPrinciple }> = {
  measure_cost: {
    label: 'Compléter la saisie des coûts',
    description:
      "Une application sans coût saisi est invisible du pilotage : elle ne peut être ni arbitrée, ni optimisée.",
    principle: 'visibility',
  },
  measure_footprint: {
    label: "Mesurer l'empreinte énergétique",
    description:
      'Estimer la consommation (kWh) et le carbone (kg CO₂) avec un outil de mesure ou le calculateur du fournisseur.',
    principle: 'visibility',
  },
  frugal_model: {
    label: 'Choisir un modèle plus frugal',
    description:
      "Architecture plus légère, quantification, distillation, ou réutilisation d'un modèle pré-entraîné plutôt qu'un nouvel entraînement.",
    principle: 'optimisation',
  },
  low_carbon_hosting: {
    label: 'Héberger dans une région bas carbone',
    description:
      "Choisir une région à faible intensité carbone, ou planifier les entraînements sur des créneaux où l'électricité l'est moins.",
    principle: 'optimisation',
  },
  reduce_calls: {
    label: 'Réduire le volume de traitements',
    description:
      'Mettre en cache les réponses répétées, traiter par lots, supprimer les appels redondants.',
    principle: 'optimisation',
  },
  question_need: {
    label: "Réinterroger le besoin d'IA",
    description:
      "Une dépense élevée sur une application non conforme ou sans bénéfice mesuré doit être arbitrée, pas seulement optimisée.",
    principle: 'accountability',
  },
};

/**
 * Référentiels cités par le cours, affichés en pied de rapport.
 * Le lien n'est pas fourni : ces textes évoluent, et rien n'a été validé
 * juridiquement dans ce projet.
 */
export const FINOPS_REFERENTIELS = [
  'AFNOR Spec IA frugale : évaluer et réduire l’impact environnemental d’un système d’IA',
  'ISO/IEC 42001 : système de management de l’IA, volet durabilité',
  'Green Software Foundation : mesure de l’impact logiciel',
] as const;

// ---------------------------------------------------------------------------
// Estimation de l'empreinte d'une application, avant toute mesure
// ---------------------------------------------------------------------------

/**
 * Modèle d'estimation de l'empreinte annuelle d'une application IA.
 *
 * **Ce sont des ordres de grandeur, pas des mesures.** Aucun des coefficients
 * ci-dessous ne sort d'un relevé fait sur les applications de l'entreprise : ils
 * servent à situer une solution avant qu'elle ne soit instrumentée, et à
 * comparer deux options entre elles. Dès qu'un relevé réel existe dans le module
 * FinOps, c'est lui qui fait foi et l'estimation passe au second plan.
 *
 * Le calcul suit la structure demandée par le métier : type d'IA, fréquence
 * d'usage (apprentissage et inférence), type d'hébergement :
 *
 *     kWh = (inférences × Wh par inférence + entraînements × kWh par entraînement)
 *           × facteur de taille du modèle × PUE
 *     kg CO₂ = kWh × intensité carbone de l'hébergement
 *
 * Les hypothèses retenues sont renvoyées avec le résultat (`assumptions`) et
 * affichées : une estimation dont on ne voit pas les hypothèses ne se discute pas.
 */

/**
 * Nombre de paramètres de référence, en millions. Les énergies de base ci-dessous
 * valent pour un modèle de cette taille ; une taille déclarée les module.
 */
const REFERENCE_PARAMS_M = 7000; // 7 milliards, taille courante d'un modèle open-weights

/**
 * Facteur d'énergie selon la taille du modèle (GF8), à défaut d'une valeur exacte.
 * L'énergie suit approximativement le nombre de paramètres, à architecture
 * comparable : d'où un facteur, et non une valeur absolue.
 */
const SIZE_FACTOR: Record<string, number> = {
  small: 0.3, // moins d'un milliard de paramètres
  medium: 1, // 1 à 20 milliards : la référence
  large: 4, // au-delà de 20 milliards
  unknown: 1, // hypothèse médiane, faute de mieux
};

/** Énergie d'une inférence, en Wh, par type d'IA (référentiel `AI_TYPES`). */
const WH_PER_INFERENCE: Record<string, number> = {
  genai: 3, // une requête à un grand modèle de langage
  vision: 1,
  nlp: 0.3,
  recommendation: 0.1,
  ml_predictive: 0.05,
  other: 0.02, // règles expertes : le coût est celui d'un calcul ordinaire
};

/** Énergie d'un cycle d'entraînement ou de fine-tuning, en kWh, par type d'IA. */
const KWH_PER_TRAINING: Record<string, number> = {
  genai: 5000, // fine-tuning, pas un pré-entraînement complet
  vision: 500,
  nlp: 200,
  recommendation: 50,
  ml_predictive: 20,
  other: 5,
};

/** Inférences par an, milieu de la fourchette annoncée (GF6). */
const INFERENCES_PER_YEAR: Record<string, number> = {
  low: 500 * 12,
  medium: 20_000 * 12,
  high: 1_000_000 * 12,
  very_high: 30_000_000 * 12,
};

/** Cycles d'entraînement par an (GF5). « Une fois » est amorti sur cinq ans. */
const TRAININGS_PER_YEAR: Record<string, number> = {
  none: 0,
  once: 0.2,
  periodic: 6,
  continuous: 120,
};

/**
 * Hébergement (GF7) : rendement du centre de données (PUE : l'énergie totale
 * consommée pour 1 kWh de calcul) et intensité carbone de son électricité.
 */
const HOSTING: Record<string, { pue: number; intensity: number; label: string }> = {
  onprem: { pue: 1.6, intensity: CO2_KG_PER_KWH, label: 'On-premise (mix français)' },
  cloud_low_carbon: { pue: 1.2, intensity: 0.03, label: 'Cloud, région bas carbone' },
  cloud: { pue: 1.2, intensity: 0.25, label: 'Cloud, région standard (Irlande, Francfort, Virginie…)' },
  cloud_high_carbon: {
    pue: 1.3,
    intensity: 0.6,
    label: 'Cloud, région à forte intensité carbone (Pologne, Inde, Australie…)',
  },
  unknown: { pue: 1.5, intensity: 0.25, label: 'Hébergement inconnu (hypothèse défavorable)' },
};

export interface CarbonEstimateInput {
  /** Code du référentiel `AI_TYPES`, pris sur la fiche de l'application. */
  aiType: string;
  /** Réponse GF5 : fréquence d'entraînement. */
  training?: string;
  /** Réponse GF6 : volume d'inférence mensuel. */
  inference?: string;
  /** Réponse GF7 : type d'hébergement. */
  hosting?: string;
  /** Réponse GF8 : tranche de taille du modèle. */
  modelSize?: string;
  /**
   * Réponse GF9 : taille exacte en **millions** de paramètres, si elle est connue.
   * Elle remplace la tranche : une valeur mesurée vaut mieux qu'un intervalle.
   */
  modelParamsM?: number;
}

export interface CarbonEstimate {
  /** Consommation annuelle estimée, en kWh. */
  energyKwh: number;
  /** Empreinte annuelle estimée, en kg CO₂ équivalent. */
  co2Kg: number;
  /** Part de la consommation due à l'entraînement, entre 0 et 1. */
  trainingShare: number;
  /** Intensité carbone retenue, en kg CO₂ par kWh. */
  intensity: number;
  /** Facteur de taille appliqué aux énergies de base. */
  sizeFactor: number;
  /** Toutes les hypothèses du calcul, pour qu'il soit discutable. */
  assumptions: { label: string; value: string }[];
  /** Faux tant qu'une des trois réponses manque : rien n'est affiché alors. */
  complete: boolean;
}

const VIDE: CarbonEstimate = {
  energyKwh: 0, co2Kg: 0, trainingShare: 0, intensity: CO2_KG_PER_KWH, sizeFactor: 1,
  assumptions: [], complete: false,
};

/**
 * Facteur de taille : la valeur exacte si elle est connue, sinon la tranche.
 *
 * Le rapport est borné à [0,05 ; 30] : au-delà, l'hypothèse de proportionnalité
 * ne tient plus et le chiffre donnerait une fausse précision.
 */
function sizeFactorOf(size: string | undefined, paramsM: number | undefined): { factor: number; source: string } {
  if (paramsM !== undefined && Number.isFinite(paramsM) && paramsM > 0) {
    const brut = paramsM / REFERENCE_PARAMS_M;
    const factor = Math.min(30, Math.max(0.05, brut));
    return { factor, source: `${paramsM.toLocaleString('fr-FR')} M de paramètres (valeur déclarée)` };
  }
  const factor = (size === undefined ? undefined : SIZE_FACTOR[size]) ?? SIZE_FACTOR.medium!;
  const libelle: Record<string, string> = {
    small: 'petit modèle (< 1 Md de paramètres)',
    medium: 'modèle moyen (1 à 20 Md)',
    large: 'grand modèle (> 20 Md)',
    unknown: 'taille inconnue, hypothèse d’un modèle moyen',
  };
  return { factor, source: libelle[size ?? 'unknown'] ?? libelle.unknown! };
}

export function estimateCarbonFootprint(input: CarbonEstimateInput): CarbonEstimate {
  const inferences = input.inference ? INFERENCES_PER_YEAR[input.inference] : undefined;
  const trainings = input.training ? TRAININGS_PER_YEAR[input.training] : undefined;
  const hosting = input.hosting ? HOSTING[input.hosting] : undefined;
  if (inferences === undefined || trainings === undefined || !hosting) return VIDE;

  const whPerInference = WH_PER_INFERENCE[input.aiType] ?? WH_PER_INFERENCE.other!;
  const kwhPerTraining = KWH_PER_TRAINING[input.aiType] ?? KWH_PER_TRAINING.other!;

  const taille = sizeFactorOf(input.modelSize, input.modelParamsM);
  const kwhInference = (inferences * whPerInference * taille.factor) / 1000;
  const kwhTraining = trainings * kwhPerTraining * taille.factor;
  const energyKwh = Math.round((kwhInference + kwhTraining) * hosting.pue);
  const co2Kg = Math.round(energyKwh * hosting.intensity);
  const brut = kwhInference + kwhTraining;

  return {
    energyKwh,
    co2Kg,
    trainingShare: brut > 0 ? kwhTraining / brut : 0,
    intensity: hosting.intensity,
    sizeFactor: taille.factor,
    complete: true,
    assumptions: [
      { label: 'Taille du modèle', value: `${taille.source} → ×${round2(taille.factor)}` },
      { label: 'Énergie par inférence', value: `${round2(whPerInference * taille.factor)} Wh` },
      { label: 'Inférences par an', value: inferences.toLocaleString('fr-FR') },
      {
        label: 'Entraînements par an',
        value: trainings === 0
          ? 'aucun'
          : `${trainings} × ${Math.round(kwhPerTraining * taille.factor).toLocaleString('fr-FR')} kWh`,
      },
      { label: 'Hébergement', value: `${hosting.label}, PUE ${hosting.pue}` },
      { label: 'Intensité carbone', value: `${hosting.intensity} kg CO₂/kWh` },
    ],
  };
}
