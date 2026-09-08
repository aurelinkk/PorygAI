/**
 * Fiche d'évaluation de conformité IA.
 *
 * Système hybride : un score sur 18 points, combiné à des critères
 * ÉLIMINATOIRES (« red flags »). Une seule réponse « Non » sur un critère
 * éliminatoire fait basculer l'application en Non conforme, quel que soit le score.
 *
 * Le questionnaire est défini ici, en code partagé : le client l'affiche et
 * calcule le score en direct, le serveur le recalcule à la soumission (seul le
 * calcul serveur fait foi). Il est versionné (`QUESTIONNAIRE_VERSION`) pour que
 * les évaluations passées restent interprétables quand les questions évolueront.
 */

export const QUESTIONNAIRE_VERSION = 'v1';

/** Réponses possibles et points associés. */
export const ANSWER_VALUES = [
  { value: 2, label: 'Oui' },
  { value: 1, label: 'Partiellement' },
  { value: 0, label: 'Non' },
] as const;

export type AnswerValue = 0 | 1 | 2;

export const PILLARS = [
  { code: 'A', label: 'Sécurité & Données' },
  { code: 'B', label: 'Transparence' },
  { code: 'C', label: 'Équité & Supervision' },
  { code: 'D', label: 'FinOps & Éco-conception' },
] as const;

export type PillarCode = (typeof PILLARS)[number]['code'];

export interface Question {
  code: string;
  pillar: PillarCode;
  wording: string;
  /** Éliminatoire : une réponse « Non » (0 pt) rend l'application non conforme. */
  critical: boolean;
  /** Plan d'action proposé automatiquement si la réponse vaut 0 ou 1 point. */
  remediation: string;
}

export const QUESTIONS: Question[] = [
  {
    code: 'A1',
    pillar: 'A',
    wording:
      "Les données traitées par l'IA sont-elles hébergées dans une zone validée par l'entreprise (ex: UE) ?",
    critical: true,
    remediation:
      "Documenter la zone d'hébergement des données auprès de l'éditeur et, si elle est hors zone validée, migrer vers une région conforme ou obtenir une dérogation écrite du DPO.",
  },
  {
    code: 'A2',
    pillar: 'A',
    wording:
      "L'application est-elle exempte de traitement de données personnelles sensibles (santé, opinions, etc.) sans accord explicite du DPO ?",
    critical: true,
    remediation:
      "Recenser les catégories de données traitées, supprimer ou anonymiser les données sensibles non nécessaires, et faire valider le traitement résiduel par le DPO.",
  },
  {
    code: 'A3',
    pillar: 'A',
    wording: "L'accès à l'outil est-il restreint par le SSO avec une gestion stricte des permissions ?",
    critical: false,
    remediation:
      "Raccorder l'application au SSO d'entreprise et définir des profils d'accès par rôle, avec revue périodique des habilitations.",
  },
  {
    code: 'B1',
    pillar: 'B',
    wording:
      "Les utilisateurs finaux sont-ils informés qu'ils interagissent avec ou reçoivent des résultats générés par une IA ?",
    critical: true,
    remediation:
      "Ajouter une mention légale visible sur l'interface de l'application indiquant que les résultats sont générés par intelligence artificielle, puis soumettre à nouveau.",
  },
  {
    code: 'B2',
    pillar: 'B',
    wording:
      "Le Process Owner est-il capable d'expliquer globalement comment l'IA produit ses résultats (explicabilité) ?",
    critical: false,
    remediation:
      "Obtenir de l'éditeur une note d'explicabilité (type de modèle, données d'entraînement, limites connues) et former le Process Owner à la restituer.",
  },
  {
    code: 'C1',
    pillar: 'C',
    wording:
      'Y a-t-il un "Humain dans la boucle" (Human in the loop) pour valider les décisions critiques prises par l\'IA ?',
    critical: true,
    remediation:
      "Identifier les décisions à effet significatif et instaurer une validation humaine obligatoire avant application, avec traçabilité du validateur.",
  },
  {
    code: 'C2',
    pillar: 'C',
    wording: "Des tests ont-ils été réalisés pour s'assurer que l'IA ne reproduit pas de biais discriminatoires ?",
    critical: false,
    remediation:
      "Réaliser une campagne de tests de biais sur les populations concernées, documenter les résultats et planifier une revue annuelle.",
  },
  {
    code: 'D1',
    pillar: 'D',
    wording: "Les coûts d'utilisation (licences, requêtes API, compute) sont-ils monitorés et plafonnés ?",
    critical: false,
    remediation:
      "Mettre en place un suivi mensuel des coûts et définir un plafond avec alerte au dépassement, remonté dans le rapport FinOps.",
  },
  {
    code: 'D2',
    pillar: 'D',
    wording:
      "Le modèle d'IA choisi est-il proportionné au besoin (ex: ne pas utiliser un LLM massif pour une simple classification de texte) ?",
    critical: false,
    remediation:
      "Comparer le modèle utilisé à des alternatives plus légères à qualité équivalente et documenter le choix retenu (coût, empreinte, performance).",
  },
];

/** Criticité métier renseignée en informations préliminaires (non notée). */
export const BUSINESS_CRITICALITIES = [
  { code: 'low', label: 'Faible' },
  { code: 'medium', label: 'Moyenne' },
  { code: 'high', label: 'Haute' },
] as const;

export type BusinessCriticality = (typeof BUSINESS_CRITICALITIES)[number]['code'];

/** Score maximal : 9 questions × 2 points. */
export const MAX_SCORE = QUESTIONS.length * 2;

/** Seuil de conformité : 14/18, soit environ 75 %. */
export const PASS_SCORE = 14;

export const CRITICAL_QUESTIONS = QUESTIONS.filter((question) => question.critical);

export function getQuestion(code: string): Question | undefined {
  return QUESTIONS.find((question) => question.code === code);
}

export interface ScoringResult {
  score: number;
  maxScore: number;
  /** Toutes les questions ont-elles reçu une réponse ? */
  complete: boolean;
  /** Codes des questions éliminatoires répondues « Non ». */
  redFlags: string[];
  /** Verdict : conforme seulement si le seuil est atteint ET aucun éliminatoire à 0. */
  decision: 'compliant' | 'non_compliant';
  /** Questions à 0 ou 1 point : elles alimentent le plan d'action. */
  toImprove: string[];
}

/**
 * Calcule le score et le verdict. Fonction pure, utilisée à l'identique par le
 * client (affichage en direct) et par le serveur (calcul qui fait foi).
 */
export function scoreEvaluation(answers: Record<string, AnswerValue | undefined>): ScoringResult {
  let score = 0;
  const redFlags: string[] = [];
  const toImprove: string[] = [];
  let complete = true;

  for (const question of QUESTIONS) {
    const value = answers[question.code];
    if (value === undefined) {
      complete = false;
      continue;
    }
    score += value;
    if (value === 0 && question.critical) redFlags.push(question.code);
    if (value < 2) toImprove.push(question.code);
  }

  const decision = score >= PASS_SCORE && redFlags.length === 0 ? 'compliant' : 'non_compliant';
  return { score, maxScore: MAX_SCORE, complete, redFlags, decision, toImprove };
}
