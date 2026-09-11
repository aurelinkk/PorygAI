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
 * Efficacité énergétique réelle d'un accélérateur en production, en FLOPs par joule.
 *
 * **C'est la seule constante calibrée du modèle**, et tout le reste en découle.
 * Elle est vérifiée sur trois mesures publiées indépendantes :
 *
 *  1. *Inférence, Llama 3.1 405B* : médiane publiée 0,39 Wh par requête d'environ
 *     800 tokens → 2 × 405e9 × 800 ÷ (0,39 × 3600) ≈ 4,6e11 FLOPs/J.
 *  2. *Inférence, Mixtral 8x22B* (39 Md de paramètres actifs) : 0,06 Wh par
 *     requête → ≈ 5,2e11 FLOPs/J.
 *  3. *Entraînement, Llama 2 7B* : 184 320 heures de GPU A100 (400 W) pour
 *     2 000 Md de tokens → 6 × 7e9 × 2e12 ÷ (184 320 × 3600 × 400) ≈ 3,2e11 FLOPs/J.
 *
 * On retient 3,5e11, soit environ 25 % de la puissance de crête d'un H100
 * (≈ 990 TFLOPS FP16 pour 700 W = 1,4e12 FLOPs/J) : c'est l'ordre du taux
 * d'utilisation réellement atteint en service, l'inférence étant limitée par la
 * mémoire bien avant le calcul.
 *
 * Conséquence à garder en tête : cette valeur suppose du matériel de génération
 * A100/H100. Du matériel plus ancien consomme davantage, un accélérateur plus
 * récent moins ; c'est l'une des raisons de la fourchette affichée.
 */
export const FLOPS_PER_JOULE = 3.5e11;

/**
 * Tokens d'entraînement par paramètre pour un pré-entraînement compute-optimal.
 *
 * C'est le rapport de la loi de Chinchilla (Hoffmann et al., 2022), confirmé par
 * les réplications ouvertes (Cerebras-GPT). Il a une conséquence importante pour
 * ce calcul : un **pré-entraînement** voit son volume de données croître avec la
 * taille du modèle, si bien que son énergie varie comme le **carré** du nombre de
 * paramètres, là où un ajustement sur un corpus fixe ne varie que linéairement.
 * Le modèle n'a pas besoin d'une règle spéciale pour cela : il suffit que D
 * dépende de N dans `6ND`.
 */
export const CHINCHILLA_TOKENS_PER_PARAM = 20;

/**
 * Nombre de paramètres **actifs**, en millions, retenu par tranche (GF8).
 *
 * « Actifs » et non « totaux » : dans un modèle à mélange d'experts, seule une
 * fraction des poids participe au calcul de chaque token, et c'est elle qui
 * consomme. Confondre les deux surestime un modèle frontière d'un facteur 5 à 10.
 */
const ACTIVE_PARAMS_M_BY_SIZE: Record<string, number> = {
  small: 500, // moins d'un milliard : milieu de tranche
  medium: 7000, // 1 à 20 milliards : modèle open-weights courant
  large: 70000, // au-delà de 20 milliards : classe Llama 70B
  unknown: 7000, // hypothèse médiane, faute de mieux
};

/**
 * Nombre de passes du modèle par traitement, à défaut d'une réponse à GF10.
 *
 * Le calcul d'une inférence vaut ≈ 2 × N FLOPs **par passe** : un token pour un
 * modèle de langage, une position d'image pour un modèle de vision, un seul
 * passage pour un modèle tabulaire. C'est ce qui permet de garder une formule
 * unique pour des familles d'IA très différentes.
 */
const PASSES_PER_INFERENCE: Record<string, number> = {
  genai: 800, // remplacé par la réponse à GF10 dès qu'elle existe
  nlp: 300, // encodeur sur un texte court : lu, pas généré
  vision: 200, // positions d'une image standard (ViT 224 px ≈ 196 patches)
  recommendation: 1,
  ml_predictive: 1,
  other: 1,
};

/** Tokens produits et lus par requête (GF10). */
const TOKENS_PER_REQUEST: Record<string, number> = {
  short: 200,
  medium: 800,
  long: 3000,
  very_long: 12_000,
};

/**
 * Volume de données vu par cycle d'entraînement (GF11), en tokens ou échantillons.
 * `pretrain` est absent : il se calcule, à 20 tokens par paramètre.
 */
const TRAINING_TOKENS: Record<string, number> = {
  light: 1e7, // ajustement léger (LoRA, quelques milliers d'exemples)
  standard: 1e9, // fine-tuning complet sur un corpus métier
  heavy: 1e11, // ré-entraînement sur un grand corpus
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

/**
 * Intensité carbone de l'hébergement déclaré (GF7), en kg CO₂ par kWh.
 *
 * À défaut de réponse, on retient l'hypothèse défavorable (celle de la ligne
 * `unknown`) et non le mix français : pour une empreinte, le cas le moins
 * renseigné ne doit pas être le plus flatteur.
 */
export function hostingIntensity(hosting: string | undefined): number {
  return (hosting !== undefined ? HOSTING[hosting]?.intensity : undefined) ?? HOSTING.unknown!.intensity;
}

/**
 * Largeur de la fourchette affichée, en facteur multiplicatif.
 *
 * Les mesures publiées d'énergie par requête s'étalent sur un intervalle
 * interquartile d'environ 0,5× à 2× la médiane, avant même de tenir compte du
 * matériel et du taux de charge. Afficher un nombre unique au kilo près
 * donnerait une précision que ce calcul n'a pas.
 */
export const ESTIMATE_UNCERTAINTY = 2;

/**
 * Énergie d'une inférence, en Wh : `2 × N × passes ÷ rendement`.
 *
 * Exposée pour que la calibration soit vérifiable directement (voir
 * `server/tests/carbone.test.ts`, qui la confronte aux mesures publiées) et non
 * seulement à travers une projection annuelle.
 */
export function inferenceWh(activeParamsM: number, passes: number): number {
  return (2 * activeParamsM * 1e6 * passes) / FLOPS_PER_JOULE / 3600;
}

/** Énergie d'un cycle d'entraînement, en kWh : `6 × N × D ÷ rendement`. */
export function trainingKwh(activeParamsM: number, tokens: number): number {
  return (6 * activeParamsM * 1e6 * tokens) / FLOPS_PER_JOULE / 3.6e6;
}

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
   * Réponse GF9 : paramètres **actifs** en millions, si le chiffre est connu.
   * Il remplace la tranche : une valeur mesurée vaut mieux qu'un intervalle.
   */
  modelParamsM?: number;
  /** Réponse GF10 : longueur typique d'un échange, en tokens. */
  requestSize?: string;
  /** Réponse GF11 : volume de données par cycle d'entraînement. */
  trainingData?: string;
}

export interface CarbonEstimate {
  /** Consommation annuelle estimée, en kWh (valeur centrale). */
  energyKwh: number;
  /** Empreinte annuelle estimée, en kg CO₂ équivalent (valeur centrale). */
  co2Kg: number;
  /** Bornes de la fourchette : la valeur centrale divisée puis multipliée par `ESTIMATE_UNCERTAINTY`. */
  energyKwhLow: number;
  energyKwhHigh: number;
  co2KgLow: number;
  co2KgHigh: number;
  /** Part de la consommation due à l'entraînement, entre 0 et 1. */
  trainingShare: number;
  /** Intensité carbone retenue, en kg CO₂ par kWh. */
  intensity: number;
  /** Paramètres actifs retenus, en millions. */
  activeParamsM: number;
  /** Toutes les hypothèses du calcul, pour qu'il soit discutable. */
  assumptions: { label: string; value: string }[];
  /** Faux tant qu'une des réponses nécessaires manque : rien n'est affiché alors. */
  complete: boolean;
}

const VIDE: CarbonEstimate = {
  energyKwh: 0, co2Kg: 0, energyKwhLow: 0, energyKwhHigh: 0, co2KgLow: 0, co2KgHigh: 0,
  trainingShare: 0, intensity: CO2_KG_PER_KWH, activeParamsM: 0, assumptions: [], complete: false,
};

/** Paramètres actifs retenus : la valeur déclarée si elle existe, sinon la tranche. */
function activeParamsOf(size: string | undefined, paramsM: number | undefined): { paramsM: number; source: string } {
  if (paramsM !== undefined && Number.isFinite(paramsM) && paramsM > 0) {
    return { paramsM, source: `${paramsM.toLocaleString('fr-FR')} M de paramètres actifs (valeur déclarée)` };
  }
  const libelle: Record<string, string> = {
    small: 'petit modèle (< 1 Md), hypothèse de 500 M',
    medium: 'modèle moyen (1 à 20 Md), hypothèse de 7 Md',
    large: 'grand modèle (> 20 Md), hypothèse de 70 Md',
    unknown: 'taille inconnue, hypothèse d’un modèle moyen (7 Md)',
  };
  const code = size !== undefined && ACTIVE_PARAMS_M_BY_SIZE[size] !== undefined ? size : 'unknown';
  return { paramsM: ACTIVE_PARAMS_M_BY_SIZE[code]!, source: libelle[code]! };
}

/** Arrondi qui garde deux chiffres significatifs : afficher 38 412 kWh serait une fausse précision. */
function significant(value: number): number {
  if (value <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
}

/**
 * Empreinte annuelle estimée d'une application, à partir des réponses de
 * gouvernance FinOps.
 *
 * Le calcul ne repose plus sur des énergies forfaitaires par type d'IA mais sur
 * les deux formules de référence du domaine, converties en énergie par une seule
 * constante calibrée (`FLOPS_PER_JOULE`) :
 *
 *     inférence     : FLOPs = 2 × N × passes          (N = paramètres actifs)
 *     entraînement  : FLOPs = 6 × N × D               (D = tokens vus)
 *     énergie       = FLOPs ÷ FLOPS_PER_JOULE × PUE
 *     empreinte     = énergie × intensité carbone de la région
 *
 * Les deux facteurs 2 et 6 ne sont pas des réglages : ils comptent les
 * multiplications-additions d'une passe avant (2N par paramètre et par token) et
 * d'une passe avant + arrière avec la mise à jour des poids (6N). C'est ce qui
 * rend le résultat discutable sur des bases publiées plutôt que sur un avis.
 *
 * **Ce que le calcul ne compte pas**, et qu'il ne faut pas oublier en le lisant :
 *
 *  - l'**infrastructure permanente** autour du modèle. On compte l'énergie du
 *    calcul, pas celle d'un serveur allumé jour et nuit pour l'héberger. Sur une
 *    petite application peu sollicitée, c'est le serveur qui domine, et
 *    l'estimation paraîtra ridiculement basse : elle l'est, pour cette raison ;
 *  - le **carbone incorporé** du matériel (fabrication des accélérateurs), qui
 *    pèse d'autant plus que l'usage est faible ;
 *  - le **stockage et le transfert** des données d'entraînement.
 *
 * Ces trois termes demanderaient des questions que le questionnaire ne pose pas.
 * Plutôt que de les remplacer par un forfait inventé, on les nomme.
 */
export function estimateCarbonFootprint(input: CarbonEstimateInput): CarbonEstimate {
  const inferences = input.inference ? INFERENCES_PER_YEAR[input.inference] : undefined;
  const trainings = input.training ? TRAININGS_PER_YEAR[input.training] : undefined;
  const hosting = input.hosting ? HOSTING[input.hosting] : undefined;
  if (inferences === undefined || trainings === undefined || !hosting) return VIDE;

  const taille = activeParamsOf(input.modelSize, input.modelParamsM);
  const n = taille.paramsM * 1e6;

  // --- Inférence ------------------------------------------------------------
  const defaut = PASSES_PER_INFERENCE[input.aiType] ?? PASSES_PER_INFERENCE.other!;
  const tokens = input.requestSize ? TOKENS_PER_REQUEST[input.requestSize] : undefined;
  // La longueur déclarée ne vaut que pour les modèles qui lisent et écrivent du
  // texte : elle n'a pas de sens pour un modèle de scoring, qui fait une passe.
  const textuel = input.aiType === 'genai' || input.aiType === 'nlp';
  const passes = textuel && tokens !== undefined ? tokens : defaut;

  const whPerInference = inferenceWh(taille.paramsM, passes);
  const kwhInference = (inferences * whPerInference) / 1000;

  // --- Entraînement ---------------------------------------------------------
  const preentrainement = input.trainingData === 'pretrain';
  const tokensTraining = preentrainement
    ? CHINCHILLA_TOKENS_PER_PARAM * n
    : (input.trainingData ? TRAINING_TOKENS[input.trainingData] : undefined) ?? TRAINING_TOKENS.standard!;
  const kwhPerTraining = trainingKwh(taille.paramsM, tokensTraining);
  const kwhTraining = trainings > 0 ? trainings * kwhPerTraining : 0;

  // --- Totaux ---------------------------------------------------------------
  const brut = kwhInference + kwhTraining;
  const energyKwh = significant(brut * hosting.pue);
  const co2Kg = significant(energyKwh * hosting.intensity);

  const millions = (value: number) => `${(value / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} M`;

  return {
    energyKwh,
    co2Kg,
    energyKwhLow: significant(energyKwh / ESTIMATE_UNCERTAINTY),
    energyKwhHigh: significant(energyKwh * ESTIMATE_UNCERTAINTY),
    co2KgLow: significant(co2Kg / ESTIMATE_UNCERTAINTY),
    co2KgHigh: significant(co2Kg * ESTIMATE_UNCERTAINTY),
    trainingShare: brut > 0 ? kwhTraining / brut : 0,
    intensity: hosting.intensity,
    activeParamsM: taille.paramsM,
    complete: true,
    assumptions: [
      { label: 'Paramètres actifs (N)', value: taille.source },
      {
        label: 'Calcul par inférence',
        value: `2 × N × ${passes.toLocaleString('fr-FR')} ${textuel ? 'tokens' : 'passe(s)'}`
          + ` = ${(2 * n * passes / 1e12).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} TFLOPs`
          + ` → ${whPerInference.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} Wh`,
      },
      { label: 'Inférences par an', value: inferences.toLocaleString('fr-FR') },
      {
        label: 'Entraînements par an',
        value: trainings === 0
          ? 'aucun'
          : `${trainings} × (6 × N × ${millions(tokensTraining)} ${preentrainement ? 'tokens, soit 20 par paramètre' : 'tokens'})`
            + ` = ${Math.round(kwhPerTraining).toLocaleString('fr-FR')} kWh par cycle`,
      },
      { label: 'Rendement énergétique', value: `${(FLOPS_PER_JOULE / 1e9).toFixed(0)} GFLOPs par joule (A100/H100 en service)` },
      { label: 'Hébergement', value: `${hosting.label}, PUE ${hosting.pue}` },
      { label: 'Intensité carbone', value: `${hosting.intensity} kg CO₂/kWh` },
    ],
  };
}
