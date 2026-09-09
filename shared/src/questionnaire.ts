/**
 * Questionnaire d'évaluation de conformité IA — version 2.
 *
 * Conception détaillée : docs/questionnaire-v2.md. En résumé :
 *
 *  - Une étape de CADRAGE (non notée) oriente le parcours : pays de déploiement,
 *    domaine à fort enjeu, données personnelles, contenu généré, origine du modèle.
 *    Chaque question notée porte une condition `showIf` évaluée sur ces réponses.
 *  - Score sur 100 = points obtenus / points applicables. Une question masquée ne
 *    compte nulle part : un outil simple a moins d'obligations qu'un système à
 *    haut risque, et le score reste comparable.
 *  - Trois poids : critique (4 pts, plafonne le score à 60 si « Non »), standard (2),
 *    mineur (1). Deux BLOCAGES arrêtent l'évaluation : domaine militaire, et
 *    pratique interdite par l'AI Act pour un déploiement dans l'UE.
 *  - Verdict : ≥ 86 conforme (production), 61–85 partiellement conforme (test),
 *    ≤ 60 non conforme (non déployable).
 *
 * Le calcul (`scoreEvaluation`) est une fonction pure, exécutée à l'identique par
 * le client (score en direct) et par le serveur (calcul qui fait foi).
 */

/**
 * Version du jeu de questions, écrite dans chaque évaluation soumise.
 *
 * Le chiffre avant le point est la *famille* : v2.1 ajoute des questions à v2
 * sans en renommer aucune. Un brouillon commencé en v2 garde donc ses réponses
 * (voir `getOrCreateDraft`) ; seul un changement de famille les invalide.
 */
export const QUESTIONNAIRE_VERSION = 'v2.1';

// ---------------------------------------------------------------------------
// Modèle
// ---------------------------------------------------------------------------

/** Une réponse : indice d'échelle (0/1/2), valeur d'un choix, ou liste pour un choix multiple. */
export type AnswerValue = number | string | string[];
export type Answers = Record<string, AnswerValue | undefined>;

/** Condition d'affichage, évaluée sur les réponses déjà données. */
export type Condition =
  | { q: string; anyOf: string[] } // la réponse (ou l'une des réponses) est dans la liste
  | { q: string; noneOf: string[] } // aucune réponse dans la liste
  | { all: Condition[] }
  | { any: Condition[] };

export interface Option {
  value: string;
  label: string;
  /** Pour un choix simple noté : 2 = plein, 1 = moitié, 0 = rien. */
  score?: 0 | 1 | 2;
  hint?: string;
}

export type QuestionKind =
  | 'scale' // Oui / Partiellement / Non
  | 'single' // un choix parmi des options (noté si les options portent un score)
  | 'multi' // plusieurs choix (cadrage uniquement, non noté)
  | 'yesno'; // Oui / Non (cadrage ou blocage, non noté)

export type Weight = 1 | 2 | 4;

export interface Question {
  code: string;
  section: SectionCode;
  kind: QuestionKind;
  wording: string;
  /** « Pourquoi cette question ? » — affiché dépliable dans le formulaire. */
  why?: string;
  /** Points maximum. Absent = question non notée (cadrage). */
  weight?: Weight;
  /** Répondue au minimum (Non / score 0), plafonne le score global à 60. */
  critical?: boolean;
  /** Valeur qui arrête l'évaluation (blocage), et message associé. */
  blockingValue?: string;
  blockMessage?: string;
  options?: Option[];
  showIf?: Condition;
  /** Action corrective proposée quand la réponse n'est pas au maximum. */
  remediation?: string;
  /** Code de la question v1 reprise, pour mémoire. */
  legacy?: string;
}

export type SectionCode =
  | 'framing' | 'N' | 'D' | 'T' | 'S' | 'E' | 'BI' | 'SE' | 'F' | 'UE' | 'US' | 'CN' | 'AU';

export interface Section {
  code: SectionCode;
  label: string;
  /** Courte phrase d'introduction de l'étape. */
  intro: string;
  /** Pays de déploiement (C1) qui active la section, pour les blocs réglementaires. */
  country?: string;
}

export const SECTIONS: Section[] = [
  { code: 'framing', label: 'Cadrage', intro: 'Six questions pour adapter le questionnaire à votre application. Elles ne sont pas notées.' },
  { code: 'N', label: 'Nécessité et proportionnalité', intro: "L'IA est-elle le bon outil, à la bonne taille, et pour un gain réel ?" },
  { code: 'D', label: 'Données et vie privée', intro: 'Ce que l’application collecte, où elle l’héberge, et avec quelles garanties.' },
  { code: 'T', label: 'Transparence et explicabilité', intro: 'Les personnes savent-elles qu’une IA intervient, et peut-on expliquer ses résultats ?' },
  { code: 'S', label: 'Supervision humaine et robustesse', intro: 'Qui garde la main, et que se passe-t-il quand l’IA se trompe ?' },
  { code: 'E', label: 'Équité et biais', intro: 'L’IA traite-t-elle tout le monde de la même façon ?' },
  {
    code: 'BI',
    label: 'Biais cognitifs et algorithmiques',
    intro: "D'où viennent les biais du système, comment on les repère, et ce qu'on en fait.",
  },
  { code: 'SE', label: 'Sécurité', intro: 'Accès, attaques propres à l’IA, engagements du fournisseur.' },
  { code: 'F', label: 'Frugalité et FinOps', intro: 'Coût financier et empreinte carbone de l’IA.' },
  { code: 'UE', label: 'Réglementation — Union européenne', intro: 'AI Act et RGPD.', country: 'eu' },
  { code: 'US', label: 'Réglementation — États-Unis', intro: 'Lois sectorielles, lois d’État et FTC.', country: 'us' },
  { code: 'CN', label: 'Réglementation — Chine', intro: 'Enregistrement CAC, marquage, PIPL et localisation des données.', country: 'cn' },
  { code: 'AU', label: 'Réglementation — autres pays', intro: 'Revue juridique locale.', country: 'other' },
];

// ---------------------------------------------------------------------------
// Raccourcis de conditions
// ---------------------------------------------------------------------------

/** Domaines à fort enjeu (C3), hors « Aucun ». Correspond à l'annexe III de l'AI Act. */
const CRITICAL_DOMAINS = ['health', 'biometric', 'employment', 'education', 'credit', 'justice', 'infrastructure'];

const hasCriticalDomain: Condition = { q: 'C3', anyOf: CRITICAL_DOMAINS };
const hasPersonalData: Condition = { q: 'C4', anyOf: ['yes'] };
const generatesOrInteracts: Condition = { q: 'C5', anyOf: ['generate', 'interact', 'both'] };
const generatesContent: Condition = { q: 'C5', anyOf: ['generate', 'both'] };
const usesThirdPartyApi: Condition = { q: 'C6', anyOf: ['api'] };
/** Le modèle est entraîné ou ajusté par nous : ses données d'apprentissage sont sous notre main. */
const trainedByUs: Condition = { q: 'C6', noneOf: ['api'] };
const deployedIn = (country: string): Condition => ({ q: 'C1', anyOf: [country] });

export const SCALE_OPTIONS: Option[] = [
  { value: '2', label: 'Oui', score: 2 },
  { value: '1', label: 'Partiellement', score: 1 },
  { value: '0', label: 'Non', score: 0 },
];

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const QUESTIONS: Question[] = [
  // --- Cadrage --------------------------------------------------------------
  {
    code: 'C1',
    section: 'framing',
    kind: 'multi',
    wording: "Dans quels pays ou zones l'application sera-t-elle déployée ou utilisée ?",
    why: 'Chaque zone a ses propres obligations : le questionnaire n’affichera que les blocs réglementaires qui vous concernent.',
    options: [
      { value: 'eu', label: 'Union européenne' },
      { value: 'us', label: 'États-Unis' },
      { value: 'cn', label: 'Chine' },
      { value: 'other', label: 'Autre pays' },
    ],
  },
  {
    code: 'C2',
    section: 'framing',
    kind: 'yesno',
    wording:
      "L'application est-elle exclusivement destinée à un usage militaire, de défense ou de sécurité nationale ?",
    why: 'Ces usages sont hors du périmètre de la politique IA de l’entreprise : l’évaluation s’arrête si c’est le cas.',
    options: [
      { value: 'no', label: 'Non' },
      { value: 'yes', label: 'Oui' },
    ],
    blockingValue: 'yes',
    blockMessage: "Usage exclusivement militaire, de défense ou de sécurité nationale : hors périmètre de la politique IA de l'entreprise.",
  },
  {
    code: 'C3',
    section: 'framing',
    kind: 'multi',
    wording: "L'application intervient-elle dans un domaine à fort enjeu pour les personnes ?",
    why: 'Ces domaines correspondent aux systèmes « à haut risque » de l’AI Act et déclenchent des obligations supplémentaires (recours, plan d’incident, lois sectorielles).',
    options: [
      { value: 'health', label: 'Santé' },
      { value: 'biometric', label: 'Biométrie, identification des personnes' },
      { value: 'employment', label: 'Emploi, RH, recrutement' },
      { value: 'education', label: 'Éducation, examens' },
      { value: 'credit', label: 'Crédit, assurance, accès à des services essentiels' },
      { value: 'justice', label: 'Justice, forces de l’ordre, migration' },
      { value: 'infrastructure', label: 'Infrastructures critiques' },
      { value: 'none', label: 'Aucun de ces domaines' },
    ],
  },
  {
    code: 'C4',
    section: 'framing',
    kind: 'yesno',
    wording: "L'application traite-t-elle des données personnelles, directement ou via ses données d'entraînement ?",
    why: 'Active les questions de protection des données (RGPD, PIPL, lois d’État américaines).',
    options: [
      { value: 'yes', label: 'Oui' },
      { value: 'no', label: 'Non' },
    ],
  },
  {
    code: 'C5',
    section: 'framing',
    kind: 'single',
    wording: "L'application génère-t-elle du contenu (texte, image, audio, vidéo) ou interagit-elle directement avec des personnes ?",
    why: 'Active les obligations d’information des personnes, de marquage des contenus et de sécurité propres à l’IA générative.',
    options: [
      { value: 'generate', label: 'Elle génère du contenu' },
      { value: 'interact', label: 'Elle interagit avec des personnes (assistant, chatbot)' },
      { value: 'both', label: 'Les deux' },
      { value: 'none', label: "Ni l'un ni l'autre" },
    ],
  },
  {
    code: 'C6',
    section: 'framing',
    kind: 'single',
    wording: "D'où vient le modèle d'IA ?",
    why: 'Un modèle tiers appelle des questions sur le contrat et sur les obligations du fournisseur.',
    options: [
      { value: 'internal', label: 'Développé en interne' },
      { value: 'finetuned', label: 'Modèle tiers ajusté par nos soins (fine-tuning)' },
      { value: 'api', label: "API d'un fournisseur (OpenAI, Mistral, Anthropic…)" },
      { value: 'openweights', label: 'Modèle ouvert hébergé par nous' },
    ],
  },

  // --- 1. Nécessité et proportionnalité -----------------------------------------
  {
    code: 'N1',
    section: 'N',
    kind: 'single',
    weight: 4,
    critical: true,
    wording:
      "Un algorithme d'IA est-il vraiment nécessaire ? Une approche plus simple (règles métier, statistiques classiques, processus humain) a-t-elle été comparée ?",
    why: 'Une IA inutile coûte, consomme et introduit des risques pour rien. C’est la première question de tout projet responsable.',
    options: [
      { value: '2', label: "Oui, l'IA est justifiée après comparaison", score: 2 },
      { value: '1', label: 'Partiellement : pas de comparaison formelle', score: 1 },
      { value: '0', label: 'Non, une solution plus simple suffirait', score: 0 },
    ],
    remediation:
      "Documenter la comparaison avec une solution non-IA ; si elle est équivalente, la privilégier : moins de risque, de coût et d'empreinte.",
  },
  {
    code: 'N2',
    section: 'N',
    kind: 'scale',
    weight: 2,
    wording: "Le modèle est-il proportionné au besoin (pas de LLM massif pour une simple classification de texte) ?",
    options: SCALE_OPTIONS,
    remediation: 'Comparer le modèle à des alternatives plus légères à qualité équivalente et documenter le choix retenu.',
    legacy: 'D2',
  },
  {
    code: 'N3',
    section: 'N',
    kind: 'scale',
    weight: 2,
    wording: "La finalité est-elle précise, écrite et limitée — l'usage réel ne dérive pas de l'usage déclaré ?",
    options: SCALE_OPTIONS,
    remediation: "Rédiger une finalité limitative et prévoir une revue à chaque évolution d'usage.",
  },
  {
    code: 'N4',
    section: 'N',
    kind: 'single',
    weight: 2,
    wording:
      "La tâche présente-t-elle les caractéristiques qui rendent une IA pertinente : volume important, données non structurées (texte, image, son), grande variabilité des cas, absence de règles explicites ?",
    why: 'Une IA n’apporte quelque chose que si la tâche est trop variable ou trop volumineuse pour être écrite en règles. Sinon une règle métier fait mieux, pour moins cher et sans risque de dérive.',
    options: [
      { value: '2', label: 'Oui : au moins deux de ces caractéristiques, constatées et écrites', score: 2 },
      { value: '1', label: 'En partie : une seule caractéristique, ou constat non documenté', score: 1 },
      { value: '0', label: 'Non : la tâche se décrit en règles explicites', score: 0 },
    ],
    remediation:
      'Décrire la tâche par des chiffres (volume mensuel, nature des données, part de cas atypiques) et vérifier qu’une règle métier ou un traitement statistique ne suffirait pas.',
  },
  {
    code: 'N5',
    section: 'N',
    kind: 'single',
    weight: 2,
    wording:
      "Le gain attendu est-il chiffré, avec une mesure de référence prise avant l'IA (temps passé, taux d'erreur, volume traité) ?",
    why: 'Sans mesure avant / après, l’utilité de l’application ne peut être ni prouvée ni contestée : on ne saura pas si elle mérite d’être maintenue.',
    options: [
      { value: '2', label: 'Oui : mesure de référence et cible chiffrées', score: 2 },
      { value: '1', label: 'Un gain est annoncé, mais sans mesure de référence', score: 1 },
      { value: '0', label: 'Non, le gain attendu n’est pas chiffré', score: 0 },
    ],
    remediation:
      'Mesurer la situation actuelle (temps, coût, qualité) sur un échantillon représentatif, puis fixer une cible chiffrée avant le déploiement.',
  },
  {
    code: 'N6',
    section: 'N',
    kind: 'single',
    weight: 2,
    wording:
      "Le retour sur investissement a-t-il été estimé : coûts de mise en œuvre et coûts récurrents (licences, appels d'API, infrastructure, supervision humaine, maintenance) comparés aux gains chiffrés ?",
    why: 'Le coût d’une IA ne s’arrête pas à sa mise en place : les appels, la supervision et la maintenance courent tous les mois. Les coûts récurrents sont ceux suivis dans le module FinOps.',
    options: [
      { value: '2', label: 'Oui : coûts complets et gains chiffrés, avec un horizon de rentabilité', score: 2 },
      { value: '1', label: 'Estimation partielle : coûts de mise en œuvre seuls, ou gains non chiffrés', score: 1 },
      { value: '0', label: 'Non, aucune estimation', score: 0 },
    ],
    remediation:
      'Poser un calcul simple sur 12 à 24 mois : coûts de mise en œuvre et coûts récurrents (repris du suivi FinOps) face aux gains mesurés, en indiquant à partir de quand l’application devient rentable.',
  },
  {
    code: 'N7',
    section: 'N',
    kind: 'single',
    weight: 1,
    wording:
      'Le bénéfice réel sera-t-il mesuré après la mise en production, avec une décision explicite (poursuivre, corriger, arrêter) si la cible n’est pas atteinte ?',
    why: 'C’est ce qui distingue une IA utile d’une IA qu’on garde par habitude : une date de revue, et le droit d’arrêter.',
    options: [
      { value: '2', label: 'Oui : date de revue fixée et critère d’arrêt écrit', score: 2 },
      { value: '1', label: 'Un suivi est prévu, sans date ni critère d’arrêt', score: 1 },
      { value: '0', label: 'Non, aucun bilan prévu', score: 0 },
    ],
    remediation:
      'Programmer une revue à trois ou six mois : comparer les gains mesurés à la cible, et acter la suite (poursuite, correction ou arrêt).',
  },

  // --- 2. Données et vie privée ---------------------------------------------------
  {
    code: 'D1',
    section: 'D',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: hasPersonalData,
    wording:
      "L'application est-elle exempte de traitement de données sensibles (santé, opinions, biométrie…) sans accord explicite du DPO ?",
    options: SCALE_OPTIONS,
    remediation:
      'Recenser les catégories de données traitées, supprimer ou anonymiser les données sensibles non nécessaires, et faire valider le traitement résiduel par le DPO.',
    legacy: 'A2',
  },
  {
    code: 'D2',
    section: 'D',
    kind: 'scale',
    weight: 2,
    showIf: hasPersonalData,
    wording: 'La base légale du traitement est-elle identifiée et la minimisation appliquée (on ne collecte que le nécessaire) ?',
    options: SCALE_OPTIONS,
    remediation: 'Documenter la base légale par traitement et supprimer les champs sans finalité.',
  },
  {
    code: 'D3',
    section: 'D',
    kind: 'scale',
    weight: 2,
    showIf: { all: [hasPersonalData, { any: [hasCriticalDomain, { q: 'D1', anyOf: ['0', '1'] }] }] },
    wording: "Une analyse d'impact sur la protection des données (AIPD / DPIA) a-t-elle été réalisée ?",
    why: 'Exigée par le RGPD dès que le traitement présente un risque élevé : domaine sensible ou données sensibles.',
    options: SCALE_OPTIONS,
    remediation: 'Conduire une AIPD avec le DPO avant tout déploiement.',
  },
  {
    code: 'D4',
    section: 'D',
    kind: 'scale',
    weight: 4,
    critical: true,
    wording: "Les données traitées par l'IA sont-elles hébergées dans une zone validée par l'entreprise (ex: UE) ?",
    options: SCALE_OPTIONS,
    remediation:
      "Documenter la zone d'hébergement des données auprès de l'éditeur et, si elle est hors zone validée, migrer vers une région conforme ou obtenir une dérogation écrite du DPO.",
    legacy: 'A1',
  },
  {
    code: 'D5',
    section: 'D',
    kind: 'scale',
    weight: 2,
    showIf: { q: 'C6', noneOf: ['api'] },
    wording: "Données d'entraînement : provenance licite, droits d'usage vérifiés et documentation disponible ?",
    options: SCALE_OPTIONS,
    remediation: 'Constituer une fiche de provenance des jeux de données (source, licence, date, biais connus).',
  },
  {
    code: 'D6',
    section: 'D',
    kind: 'scale',
    weight: 1,
    showIf: hasPersonalData,
    wording: 'Une durée de conservation est-elle définie et les droits des personnes (accès, effacement, opposition) sont-ils opérationnels ?',
    options: SCALE_OPTIONS,
    remediation: 'Définir les durées de conservation et une procédure de réponse aux demandes sous un mois.',
  },

  // --- 3. Transparence et explicabilité -------------------------------------------
  {
    code: 'T1',
    section: 'T',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: generatesOrInteracts,
    wording:
      "Les utilisateurs finaux sont-ils informés qu'ils interagissent avec ou reçoivent des résultats générés par une IA ?",
    options: SCALE_OPTIONS,
    remediation:
      "Ajouter une mention légale visible sur l'interface de l'application indiquant que les résultats sont générés par intelligence artificielle, puis soumettre à nouveau.",
    legacy: 'B1',
  },
  {
    code: 'T2',
    section: 'T',
    kind: 'scale',
    weight: 2,
    wording: "Le Process Owner est-il capable d'expliquer globalement comment l'IA produit ses résultats (explicabilité) ?",
    options: SCALE_OPTIONS,
    remediation:
      "Obtenir de l'éditeur une note d'explicabilité (type de modèle, données d'entraînement, limites connues) et former le Process Owner à la restituer.",
    legacy: 'B2',
  },
  {
    code: 'T3',
    section: 'T',
    kind: 'scale',
    weight: 2,
    showIf: generatesContent,
    wording: 'Les contenus générés sont-ils marqués (filigrane, métadonnées, mention explicite) ?',
    options: SCALE_OPTIONS,
    remediation: 'Activer le marquage natif du fournisseur ou ajouter une mention systématique sur les contenus produits.',
  },
  {
    code: 'T4',
    section: 'T',
    kind: 'scale',
    weight: 1,
    wording: 'Une documentation technique existe-t-elle (fiche modèle, performances mesurées, limites connues) ?',
    options: SCALE_OPTIONS,
    remediation: "Rédiger une fiche modèle d'une page, mise à jour à chaque version.",
  },

  // --- 4. Supervision humaine et robustesse ---------------------------------------
  {
    code: 'S1',
    section: 'S',
    kind: 'scale',
    weight: 4,
    critical: true,
    wording: 'Y a-t-il un "Humain dans la boucle" (Human in the loop) pour valider les décisions critiques prises par l\'IA ?',
    options: SCALE_OPTIONS,
    remediation:
      'Identifier les décisions à effet significatif et instaurer une validation humaine obligatoire avant application, avec traçabilité du validateur.',
    legacy: 'C1',
  },
  {
    code: 'S2',
    section: 'S',
    kind: 'scale',
    weight: 2,
    showIf: hasCriticalDomain,
    wording: 'Les personnes concernées disposent-elles d’un recours : contester une décision, obtenir une explication, parler à un humain ?',
    options: SCALE_OPTIONS,
    remediation: "Publier une procédure de recours et l'afficher au point de décision.",
  },
  {
    code: 'S3',
    section: 'S',
    kind: 'scale',
    weight: 2,
    wording: 'Des tests de robustesse ont-ils été menés (cas limites, entrées inattendues, dérive dans le temps) ?',
    options: SCALE_OPTIONS,
    remediation: 'Constituer un jeu de tests de non-régression et le rejouer à chaque mise à jour du modèle.',
  },
  {
    code: 'S4',
    section: 'S',
    kind: 'scale',
    weight: 2,
    wording: "Les décisions et sorties de l'IA sont-elles journalisées de façon à permettre un audit a posteriori ?",
    options: SCALE_OPTIONS,
    remediation: 'Journaliser entrée, sortie, version du modèle et horodatage, avec une durée de conservation définie.',
  },
  {
    code: 'S5',
    section: 'S',
    kind: 'scale',
    weight: 2,
    showIf: hasCriticalDomain,
    wording: "Un plan existe-t-il en cas d'erreur ou d'indisponibilité de l'IA (procédure dégradée, correction, communication) ?",
    options: SCALE_OPTIONS,
    remediation: "Rédiger un plan d'incident : qui décide d'arrêter, comment on revient en arrière, qui informe les personnes.",
  },

  // --- 5. Équité et biais ---------------------------------------------------------
  {
    code: 'E1',
    section: 'E',
    kind: 'scale',
    weight: 2,
    wording: "Des tests ont-ils été réalisés pour s'assurer que l'IA ne reproduit pas de biais discriminatoires ?",
    options: SCALE_OPTIONS,
    remediation:
      'Réaliser une campagne de tests de biais par population (genre, âge, origine, handicap…), documenter les résultats et planifier une revue annuelle.',
    legacy: 'C2',
  },
  {
    code: 'E2',
    section: 'E',
    kind: 'scale',
    weight: 2,
    showIf: hasCriticalDomain,
    wording: "Les populations affectées et les critères d'équité retenus sont-ils définis par écrit ?",
    options: SCALE_OPTIONS,
    remediation: "Nommer les groupes à protéger et la métrique d'équité (parité, égalité des chances…) avant les tests.",
  },
  {
    code: 'E3',
    section: 'E',
    kind: 'scale',
    weight: 1,
    wording: "Les utilisateurs sont-ils formés aux limites de l'IA pour éviter une confiance excessive ?",
    why: 'L’« automation bias » : on tend à faire confiance à une machine même quand elle se trompe.',
    options: SCALE_OPTIONS,
    remediation: 'Intégrer un module « limites et bonnes pratiques » à la formation des utilisateurs.',
  },

  // --- 6. Biais cognitifs et algorithmiques ---------------------------------------
  // Deux familles de biais, traitées ensemble parce qu'elles se nourrissent l'une
  // l'autre : les biais *algorithmiques* viennent des données, du choix des
  // variables et de l'annotation ; les biais *cognitifs* viennent des humains qui
  // conçoivent, paramètrent et croient le système. Le thème 5 mesure le résultat
  // (l'IA discrimine-t-elle ?), celui-ci s'intéresse aux causes et aux moyens de
  // détection.
  {
    code: 'BI1',
    section: 'BI',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: hasCriticalDomain,
    wording:
      "Les données sur lesquelles repose le système ont-elles été analysées pour y chercher des biais (sur-représentation d'un groupe, décisions passées discriminatoires, période ou zone géographique non représentative) ?",
    why: 'C’est la première cause de biais algorithmique : un modèle appris sur les décisions passées d’une organisation en reproduit les discriminations, et les applique désormais à grande échelle.',
    options: SCALE_OPTIONS,
    remediation:
      "Mesurer la représentation de chaque groupe concerné dans les données et la comparer à la population réelle ; rééquilibrer ou compléter ce qui manque. Si le modèle vient d'un fournisseur, exiger sa documentation de données (fiche modèle, populations couvertes, biais connus).",
  },
  {
    code: 'BI2',
    section: 'BI',
    kind: 'scale',
    weight: 2,
    showIf: trainedByUs,
    wording:
      "Le processus de collecte et d'annotation des données est-il documenté : qui annote, selon quelles consignes écrites, avec quel contrôle de cohérence ?",
    why: 'Une consigne d’annotation ambiguë, ou une équipe d’annotateurs peu diverse, fabrique un biais que les tests sur le modèle ne rattrapent pas — l’erreur est déjà dans la vérité de référence.',
    options: SCALE_OPTIONS,
    remediation:
      "Rédiger un guide d'annotation, faire annoter un même échantillon par deux personnes, mesurer leur taux d'accord et corriger les consignes en cas de désaccord marqué.",
  },
  {
    code: 'BI3',
    section: 'BI',
    kind: 'single',
    weight: 2,
    wording:
      "Le poids réel de chaque variable dans les résultats a-t-il été examiné, afin de repérer une variable qui pèse anormalement lourd ?",
    why: 'Ancrage algorithmique : le modèle accorde une importance excessive à une variable dominante — le revenu initial dans un score de crédit, l’historique dans une répartition budgétaire. Les méthodes d’explicabilité (SHAP, LIME) attribuent à chaque variable sa contribution réelle à la décision.',
    options: [
      { value: '2', label: "Oui, avec une méthode d'explicabilité (SHAP, LIME ou équivalent)", score: 2 },
      { value: '1', label: 'Partiellement : lecture manuelle des pondérations, sans outil', score: 1 },
      { value: '0', label: 'Non, le poids des variables n’est pas connu', score: 0 },
    ],
    remediation:
      "Analyser la contribution des variables (SHAP, LIME) sur un échantillon représentatif ; normaliser ou repondérer celles qui dominent, puis vérifier que les résultats restent stables.",
  },
  {
    code: 'BI4',
    section: 'BI',
    kind: 'scale',
    weight: 2,
    showIf: generatesOrInteracts,
    wording:
      "Les consignes système et les exemples fournis au modèle ont-ils été testés en faisant varier leur ordre et leur formulation ?",
    why: 'Le même ancrage, côté IA générative : un modèle de langage se cale fortement sur le premier contexte reçu. Permuter deux exemples ou reformuler une consigne suffit parfois à changer la réponse.',
    options: SCALE_OPTIONS,
    remediation:
      "Constituer un jeu de cas de référence et le rejouer en permutant l'ordre des exemples et en reformulant la consigne ; documenter les écarts observés et figer la formulation retenue.",
  },
  {
    code: 'BI5',
    section: 'BI',
    kind: 'scale',
    weight: 2,
    showIf: { any: [hasCriticalDomain, generatesContent] },
    wording:
      "L'effet d'un signe de prestige (école, diplôme, marque, service d'origine, ancienneté) sur les résultats a-t-il été testé ?",
    why: 'Effet de halo : une impression favorable sur un seul aspect déteint sur l’appréciation d’ensemble. Un tri de CV qui privilégie une école prestigieuse en fait un critère de compétence, ce qu’elle n’est pas ; un modèle génératif écrit spontanément plus favorablement sur les marques connues.',
    options: SCALE_OPTIONS,
    remediation:
      "Rejouer des cas identiques en ne changeant que le signe de prestige et vérifier que le résultat ne bouge pas ; si l'écart est significatif, réduire le poids de la variable, la retirer, ou la masquer au modèle.",
  },
  {
    code: 'BI6',
    section: 'BI',
    kind: 'scale',
    weight: 2,
    wording:
      "Les biais détectés donnent-ils lieu à une correction effectivement mise en œuvre, puis à une nouvelle mesure qui vérifie qu'elle a fonctionné ?",
    why: 'Détecter sans corriger ne change rien, et corriger sans remesurer ne prouve rien. C’est aussi ce qui rend la démarche opposable en cas de contrôle.',
    options: SCALE_OPTIONS,
    remediation:
      "Tenir un registre des biais : mesure initiale, correction appliquée (rééquilibrage des données, repondération, contrainte d'équité, filtrage), mesure après correction, date et responsable.",
  },
  {
    code: 'BI7',
    section: 'BI',
    kind: 'scale',
    weight: 1,
    wording:
      "Les personnes qui conçoivent et valident le système sont-elles sensibilisées à leurs propres biais cognitifs (confirmation, ancrage, effet de halo) ?",
    why: 'Les biais du système commencent souvent chez l’humain : ne retenir que les variables qui confirment ce qu’on croit déjà, se fier au premier chiffre obtenu, juger un fournisseur sur sa notoriété. Aucun outil ne corrige cela : seules la formation et la relecture par un tiers le font.',
    options: SCALE_OPTIONS,
    remediation:
      "Ajouter un module « biais cognitifs » à la formation de l'équipe projet, et faire relire le choix des variables et des critères par une personne extérieure au projet.",
  },
  {
    code: 'BI8',
    section: 'BI',
    kind: 'scale',
    weight: 1,
    wording:
      "Les biais sont-ils remesurés périodiquement après la mise en production, sur les données réellement traitées ?",
    why: 'Les populations, les usages et les données évoluent : un système équitable au lancement peut cesser de l’être sans qu’aucune ligne de code n’ait changé.',
    options: SCALE_OPTIONS,
    remediation:
      "Programmer une remesure au moins annuelle sur les données de production, et la rattacher à la revue de conformité (la conformité est de toute façon revue tous les 12 mois).",
  },

  // --- 7. Sécurité -------------------------------------------------------------------
  {
    code: 'SE1',
    section: 'SE',
    kind: 'scale',
    weight: 2,
    wording: "L'accès à l'outil est-il restreint par le SSO avec une gestion stricte des permissions ?",
    options: SCALE_OPTIONS,
    remediation:
      "Raccorder l'application au SSO d'entreprise et définir des profils d'accès par rôle, avec revue périodique des habilitations.",
    legacy: 'A3',
  },
  {
    code: 'SE2',
    section: 'SE',
    kind: 'scale',
    weight: 2,
    showIf: generatesOrInteracts,
    wording: "L'application est-elle protégée contre les attaques propres à l'IA (injection de prompt, extraction de données, contournement des consignes) ?",
    options: SCALE_OPTIONS,
    remediation: 'Filtrer les entrées, cloisonner les données accessibles au modèle et tester les injections connues.',
  },
  {
    code: 'SE3',
    section: 'SE',
    kind: 'scale',
    weight: 2,
    showIf: usesThirdPartyApi,
    wording: "Le contrat avec le fournisseur interdit-il l'usage de nos données pour entraîner ses modèles et couvre-t-il la confidentialité ?",
    options: SCALE_OPTIONS,
    remediation: "Vérifier les conditions (opt-out d'entraînement, zone de traitement, sous-traitants) et les faire valider par le juridique.",
  },

  // --- 8. Frugalité et FinOps -------------------------------------------------------
  {
    code: 'F1',
    section: 'F',
    kind: 'scale',
    weight: 2,
    wording: "Les coûts d'utilisation (licences, requêtes API, compute) sont-ils monitorés et plafonnés ?",
    options: SCALE_OPTIONS,
    remediation: 'Mettre en place un suivi mensuel des coûts et définir un plafond avec alerte au dépassement, remonté dans le rapport FinOps.',
    legacy: 'D1',
  },
  {
    code: 'F2',
    section: 'F',
    kind: 'scale',
    weight: 2,
    wording: "L'empreinte carbone (entraînement + inférence) a-t-elle été estimée ?",
    options: SCALE_OPTIONS,
    remediation: "Estimer l'empreinte avec un outil (CodeCarbon, calculateur du fournisseur) et suivre son évolution.",
  },
  {
    code: 'F3',
    section: 'F',
    kind: 'single',
    weight: 2,
    wording: "Où tourne l'IA ?",
    options: [
      { value: '2', label: 'On-premise, ou cloud dans une région à faible intensité carbone', score: 2 },
      { value: '1', label: 'Cloud, sans critère carbone dans le choix de la région', score: 1 },
      { value: '0', label: 'Inconnu', score: 0 },
    ],
    remediation: 'Choisir une région à faible intensité carbone et documenter le choix.',
  },
  {
    code: 'F4',
    section: 'F',
    kind: 'scale',
    weight: 1,
    wording: 'Des optimisations réduisent-elles la consommation (cache des réponses, traitement par lots, modèle distillé ou quantifié) ?',
    options: SCALE_OPTIONS,
    remediation: 'Mettre en place un cache et évaluer un modèle plus petit sur les cas simples.',
  },
  {
    code: 'F5',
    section: 'F',
    kind: 'scale',
    weight: 1,
    wording: "Le volume d'appels est-il maîtrisé (pas d'appels redondants ou inutiles) ?",
    options: SCALE_OPTIONS,
    remediation: 'Auditer les appels sur une semaine et supprimer les redondances.',
  },

  // --- 9. Réglementation — Union européenne --------------------------------------------
  {
    code: 'UE1',
    section: 'UE',
    kind: 'yesno',
    showIf: deployedIn('eu'),
    wording:
      "L'application met-elle en œuvre une pratique interdite par l'AI Act (art. 5) : notation sociale, manipulation ou exploitation de vulnérabilités, catégorisation biométrique par attributs sensibles, reconnaissance des émotions au travail ou en formation, identification biométrique à distance en temps réel dans l'espace public, constitution de bases faciales par moissonnage ?",
    why: 'Ce sont les seuls usages formellement interdits par la loi européenne : aucune mesure ne peut les rendre acceptables.',
    options: [
      { value: 'no', label: 'Non' },
      { value: 'yes', label: 'Oui' },
    ],
    blockingValue: 'yes',
    blockMessage: "Pratique interdite dans l'Union européenne (article 5 de l'AI Act).",
  },
  {
    code: 'UE2',
    section: 'UE',
    kind: 'scale',
    weight: 2,
    showIf: deployedIn('eu'),
    wording: 'La classification de risque AI Act a-t-elle été réalisée et documentée (inacceptable / haut / limité / minimal) ?',
    options: SCALE_OPTIONS,
    remediation: 'Réaliser et écrire la classification ; en cas de doute, consulter le juridique.',
  },
  {
    code: 'UE3',
    section: 'UE',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: { all: [deployedIn('eu'), hasCriticalDomain] },
    wording:
      "Système probablement à haut risque (annexe III) : les obligations sont-elles couvertes — gestion des risques, gouvernance des données, documentation technique, enregistrement dans la base européenne, évaluation de conformité ?",
    options: SCALE_OPTIONS,
    remediation: 'Lancer le chantier de conformité haut risque avec le juridique ; ne pas déployer avant.',
  },
  {
    code: 'UE4',
    section: 'UE',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('eu'), generatesOrInteracts] },
    wording: "Obligations de transparence (art. 50) : information des personnes, marquage des contenus synthétiques et des hypertrucages ?",
    options: SCALE_OPTIONS,
    remediation: "Ajouter l'information et le marquage prévus par l'article 50.",
  },
  {
    code: 'UE5',
    section: 'UE',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('eu'), hasPersonalData] },
    wording: 'RGPD : traitement inscrit au registre, base légale, AIPD si requise, DPO consulté ?',
    options: SCALE_OPTIONS,
    remediation: 'Compléter le registre des traitements et consulter le DPO.',
  },
  {
    code: 'UE6',
    section: 'UE',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('eu'), hasPersonalData] },
    wording: "Les transferts de données hors UE sont-ils encadrés (décision d'adéquation, clauses contractuelles types) ?",
    options: SCALE_OPTIONS,
    remediation: 'Cartographier les transferts et mettre en place les garanties appropriées.',
  },
  {
    code: 'UE7',
    section: 'UE',
    kind: 'scale',
    weight: 1,
    showIf: { all: [deployedIn('eu'), { q: 'C6', anyOf: ['api', 'openweights'] }] },
    wording: "Le fournisseur du modèle général respecte-t-il ses obligations GPAI (documentation, politique droits d'auteur, résumé des données d'entraînement) ?",
    options: SCALE_OPTIONS,
    remediation: 'Demander la documentation GPAI au fournisseur.',
  },
  {
    code: 'UE8',
    section: 'UE',
    kind: 'scale',
    weight: 1,
    showIf: deployedIn('eu'),
    wording: "Le personnel qui utilise ou supervise l'IA a-t-il reçu une formation adaptée (maîtrise de l'IA, art. 4) ?",
    options: SCALE_OPTIONS,
    remediation: 'Organiser une sensibilisation adaptée aux rôles.',
  },

  // --- 9. Réglementation — États-Unis ----------------------------------------------
  {
    code: 'US1',
    section: 'US',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: { all: [deployedIn('us'), { q: 'C3', anyOf: ['employment'] }] },
    wording: "Outil de décision d'emploi automatisé : audit de biais indépendant annuel et notification des candidats (NYC Local Law 144 et lois similaires) ?",
    options: SCALE_OPTIONS,
    remediation: 'Commander un audit de biais indépendant et publier la notification requise.',
  },
  {
    code: 'US2',
    section: 'US',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: { all: [deployedIn('us'), { q: 'C3', anyOf: ['biometric'] }] },
    wording: 'Consentement écrit préalable et politique de conservation pour les données biométriques (Illinois BIPA, Texas, Washington) ?',
    options: SCALE_OPTIONS,
    remediation: 'Mettre en place le consentement écrit et publier la politique de conservation.',
  },
  {
    code: 'US3',
    section: 'US',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: { all: [deployedIn('us'), { q: 'C3', anyOf: ['health'] }] },
    wording: 'Données de santé protégées : conformité HIPAA (accords de sous-traitance, sécurité, usage minimal) ?',
    options: SCALE_OPTIONS,
    remediation: 'Conclure les accords de sous-traitance (BAA) avec les fournisseurs et documenter les mesures.',
  },
  {
    code: 'US4',
    section: 'US',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('us'), { q: 'C3', anyOf: ['credit'] }] },
    wording: "Décisions de crédit ou d'assurance : motifs de refus explicables et non-discrimination (FCRA, ECOA) ?",
    options: SCALE_OPTIONS,
    remediation: 'Produire des motifs de refus lisibles et tester la discrimination par proxy.',
  },
  {
    code: 'US5',
    section: 'US',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('us'), hasCriticalDomain] },
    wording: "Lois d'État sur l'IA à haut risque (Colorado AI Act…) : analyse d'impact, notification des personnes, prévention de la discrimination algorithmique ?",
    options: SCALE_OPTIONS,
    remediation: "Réaliser l'analyse d'impact et prévoir la notification des personnes.",
  },
  {
    code: 'US6',
    section: 'US',
    kind: 'scale',
    weight: 2,
    showIf: deployedIn('us'),
    wording: "La communication sur les capacités de l'IA est-elle exacte et non trompeuse (FTC Act §5) ?",
    options: SCALE_OPTIONS,
    remediation: 'Relire les supports marketing et la documentation avec le juridique.',
  },
  {
    code: 'US7',
    section: 'US',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('us'), hasPersonalData] },
    wording: "Droits des consommateurs (CCPA/CPRA et lois d'État) : opt-out des décisions automatisées, accès, suppression ?",
    options: SCALE_OPTIONS,
    remediation: "Offrir l'opt-out et une procédure d'accès / suppression.",
  },

  // --- 9. Réglementation — Chine ------------------------------------------------------
  {
    code: 'CN1',
    section: 'CN',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: { all: [deployedIn('cn'), generatesOrInteracts] },
    wording: "Service accessible au public : enregistrement de l'algorithme auprès de la CAC et évaluation de sécurité réalisés (mesures provisoires sur l'IA générative) ?",
    options: SCALE_OPTIONS,
    remediation: "Engager la procédure d'enregistrement avec un conseil local.",
  },
  {
    code: 'CN2',
    section: 'CN',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('cn'), generatesContent] },
    wording: "Marquage explicite et implicite des contenus synthétiques (mesures d'étiquetage 2025, dispositions deep synthesis) ?",
    options: SCALE_OPTIONS,
    remediation: 'Mettre en place les deux niveaux de marquage.',
  },
  {
    code: 'CN3',
    section: 'CN',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('cn'), hasPersonalData] },
    wording: "PIPL : consentement séparé pour les données sensibles, analyse d'impact, désignation d'un responsable ?",
    options: SCALE_OPTIONS,
    remediation: "Adapter les parcours de consentement et documenter l'analyse d'impact.",
  },
  {
    code: 'CN4',
    section: 'CN',
    kind: 'scale',
    weight: 4,
    critical: true,
    showIf: { all: [deployedIn('cn'), hasPersonalData] },
    wording: 'Localisation des données et transfert transfrontalier autorisé (évaluation de sécurité CAC, contrat standard ou certification) ?',
    options: SCALE_OPTIONS,
    remediation: 'Cartographier les flux ; obtenir le mécanisme de transfert adapté avant tout déploiement.',
  },
  {
    code: 'CN5',
    section: 'CN',
    kind: 'scale',
    weight: 2,
    showIf: deployedIn('cn'),
    wording: "Si l'application recommande ou classe des contenus : enregistrement de l'algorithme et possibilité pour l'utilisateur de désactiver la personnalisation ? (répondre « Oui » si non concerné)",
    options: SCALE_OPTIONS,
    remediation: "Ajouter l'option de désactivation et vérifier l'enregistrement.",
  },
  {
    code: 'CN6',
    section: 'CN',
    kind: 'scale',
    weight: 2,
    showIf: { all: [deployedIn('cn'), generatesContent] },
    wording: 'Modération : mécanismes de contrôle des contenus générés conformes aux exigences locales ?',
    options: SCALE_OPTIONS,
    remediation: 'Mettre en place un filtrage et une procédure de signalement.',
  },
  {
    code: 'CN7',
    section: 'CN',
    kind: 'scale',
    weight: 2,
    showIf: deployedIn('cn'),
    wording: "Données d'entraînement : licéité et respect de la propriété intellectuelle documentés ?",
    options: SCALE_OPTIONS,
    remediation: 'Constituer le dossier de provenance exigé.',
  },

  // --- 9. Réglementation — autres pays ------------------------------------------------
  {
    code: 'AU1',
    section: 'AU',
    kind: 'scale',
    weight: 2,
    showIf: deployedIn('other'),
    wording: 'Une revue juridique locale (protection des données, IA, secteur) a-t-elle été menée pour chaque autre pays concerné ?',
    options: SCALE_OPTIONS,
    remediation: 'Mandater une revue juridique par pays avant déploiement.',
  },
];

/** Questions de la v1, conservées pour afficher les évaluations déjà soumises. */
export const LEGACY_QUESTIONS_V1: { code: string; wording: string }[] = [
  { code: 'A1', wording: "Les données traitées par l'IA sont-elles hébergées dans une zone validée par l'entreprise (ex: UE) ?" },
  { code: 'A2', wording: "L'application est-elle exempte de traitement de données personnelles sensibles (santé, opinions, etc.) sans accord explicite du DPO ?" },
  { code: 'A3', wording: "L'accès à l'outil est-il restreint par le SSO avec une gestion stricte des permissions ?" },
  { code: 'B1', wording: "Les utilisateurs finaux sont-ils informés qu'ils interagissent avec ou reçoivent des résultats générés par une IA ?" },
  { code: 'B2', wording: "Le Process Owner est-il capable d'expliquer globalement comment l'IA produit ses résultats (explicabilité) ?" },
  { code: 'C1', wording: 'Y a-t-il un "Humain dans la boucle" (Human in the loop) pour valider les décisions critiques prises par l\'IA ?' },
  { code: 'C2', wording: "Des tests ont-ils été réalisés pour s'assurer que l'IA ne reproduit pas de biais discriminatoires ?" },
  { code: 'D1', wording: "Les coûts d'utilisation (licences, requêtes API, compute) sont-ils monitorés et plafonnés ?" },
  { code: 'D2', wording: "Le modèle d'IA choisi est-il proportionné au besoin (ex: ne pas utiliser un LLM massif pour une simple classification de texte) ?" },
];

/** Criticité métier renseignée en informations préliminaires (non notée). */
export const BUSINESS_CRITICALITIES = [
  { code: 'low', label: 'Faible' },
  { code: 'medium', label: 'Moyenne' },
  { code: 'high', label: 'Haute' },
] as const;
export type BusinessCriticality = (typeof BUSINESS_CRITICALITIES)[number]['code'];

// ---------------------------------------------------------------------------
// Seuils
// ---------------------------------------------------------------------------

/** ≥ 86 : conforme (production). */
/** Durée moyenne de saisie d'une question, en minutes. Sert aux estimations affichées. */
export const MINUTES_PER_QUESTION = 0.5;

export const COMPLIANT_MIN = 86;
/** ≥ 61 : partiellement conforme (test / pilote). En dessous : non conforme. */
export const PARTIAL_MIN = 61;
/** Score maximal atteignable quand une question critique est manquée. */
export const CRITICAL_CAP = 60;

export type Verdict = 'compliant' | 'partially_compliant' | 'non_compliant' | 'blocked';

export const VERDICT_LABELS: Record<Verdict, string> = {
  compliant: 'Conforme — déployable en production',
  partially_compliant: 'Partiellement conforme — autorisée en test ou pilote',
  non_compliant: 'Non conforme — non déployable',
  blocked: 'Refusée',
};

// ---------------------------------------------------------------------------
// Lecture des réponses et conditions
// ---------------------------------------------------------------------------

export function getQuestion(code: string): Question | undefined {
  return QUESTIONS.find((question) => question.code === code);
}

/** Libellé d'une question, v2 ou v1 (pour l'historique). */
export function questionWording(code: string): string {
  return getQuestion(code)?.wording ?? LEGACY_QUESTIONS_V1.find((q) => q.code === code)?.wording ?? code;
}

/** Une réponse sous forme de liste de chaînes, quel que soit le type de question. */
function asValues(value: AnswerValue | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [String(value)];
}

export function evaluateCondition(condition: Condition, answers: Answers): boolean {
  if ('all' in condition) return condition.all.every((child) => evaluateCondition(child, answers));
  if ('any' in condition) return condition.any.some((child) => evaluateCondition(child, answers));
  const values = asValues(answers[condition.q]);
  if ('anyOf' in condition) return values.some((value) => condition.anyOf.includes(value));
  return values.length > 0 && !values.some((value) => condition.noneOf.includes(value));
}

/** La question s'affiche-t-elle avec ces réponses de cadrage ? */
export function isApplicable(question: Question, answers: Answers): boolean {
  return !question.showIf || evaluateCondition(question.showIf, answers);
}

/** Questions applicables, dans l'ordre du questionnaire. */
export function applicableQuestions(answers: Answers): Question[] {
  return QUESTIONS.filter((question) => isApplicable(question, answers));
}

/** Sections qui ont au moins une question applicable (le cadrage toujours). */
export function applicableSections(answers: Answers): Section[] {
  const applicable = applicableQuestions(answers);
  return SECTIONS.filter(
    (section) => section.code === 'framing' || applicable.some((question) => question.section === section.code),
  );
}

/** Score 0–2 d'une réponse notée, ou `undefined` si pas de réponse. */
function answerScore(question: Question, value: AnswerValue | undefined): 0 | 1 | 2 | undefined {
  if (value === undefined || Array.isArray(value)) return undefined;
  const option = question.options?.find((candidate) => candidate.value === String(value));
  return option?.score;
}

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

export interface SectionScore {
  code: SectionCode;
  label: string;
  pointsObtained: number;
  pointsApplicable: number;
  /** 0–100 sur le périmètre de la section, `null` si rien d'applicable. */
  score: number | null;
  answered: number;
  total: number;
}

export interface Recommendation {
  code: string;
  section: SectionCode;
  wording: string;
  remediation: string;
  /** Points que cette action permettrait de récupérer. */
  pointsRecoverable: number;
  critical: boolean;
}

export interface ScoringResult {
  /** Codes des questions notées applicables au parcours. */
  applicable: string[];
  /** Codes, parmi les applicables ET le cadrage, restés sans réponse. */
  missing: string[];
  complete: boolean;
  pointsObtained: number;
  pointsApplicable: number;
  /** 0–100 (déjà plafonné le cas échéant). `null` si bloqué. */
  score: number | null;
  /** Questions critiques manquées, qui plafonnent le score à 60. */
  cappedBy: string[];
  /** Question ayant déclenché un blocage, ou `null`. */
  blockedBy: string | null;
  blockMessage: string | null;
  /** Verdict prévu si le questionnaire était soumis tel quel. */
  verdict: Verdict;
  sections: SectionScore[];
  /** Actions classées par points récupérables, critiques d'abord. */
  recommendations: Recommendation[];
  /** Durée estimée de saisie, en minutes, pour le parcours applicable. */
  estimatedMinutes: number;
}

export function verdictFor(score: number, cappedBy: string[]): Verdict {
  if (cappedBy.length > 0) return 'non_compliant';
  if (score >= COMPLIANT_MIN) return 'compliant';
  if (score >= PARTIAL_MIN) return 'partially_compliant';
  return 'non_compliant';
}

/**
 * Calcule score, verdict, sous-scores et recommandations.
 *
 * Une question applicable sans réponse compte pour 0 point obtenu (le score en
 * direct monte au fil de la saisie) et rend le résultat incomplet : la
 * soumission est alors refusée par le serveur.
 */
export function scoreEvaluation(answers: Answers): ScoringResult {
  const questions = applicableQuestions(answers);
  const framing = questions.filter((question) => question.section === 'framing');
  const scored = questions.filter((question) => question.weight !== undefined);

  // --- Blocages : la première question bloquante répondue par sa valeur fatale.
  const blocker = questions.find(
    (question) => question.blockingValue !== undefined && asValues(answers[question.code]).includes(question.blockingValue),
  );

  const missing = [...framing, ...scored]
    .filter((question) => {
      const value = answers[question.code];
      return value === undefined || (Array.isArray(value) && value.length === 0);
    })
    .map((question) => question.code);

  let pointsObtained = 0;
  let pointsApplicable = 0;
  const cappedBy: string[] = [];
  const recommendations: Recommendation[] = [];
  const perSection = new Map<SectionCode, { obtained: number; applicable: number; answered: number; total: number }>();

  for (const question of scored) {
    const weight = question.weight!;
    const level = answerScore(question, answers[question.code]);
    const obtained = level === undefined ? 0 : (weight * level) / 2;

    pointsApplicable += weight;
    pointsObtained += obtained;

    const bucket = perSection.get(question.section) ?? { obtained: 0, applicable: 0, answered: 0, total: 0 };
    bucket.applicable += weight;
    bucket.obtained += obtained;
    bucket.total += 1;
    if (level !== undefined) bucket.answered += 1;
    perSection.set(question.section, bucket);

    if (question.critical && level === 0) cappedBy.push(question.code);
    if (level !== undefined && level < 2 && question.remediation) {
      recommendations.push({
        code: question.code,
        section: question.section,
        wording: question.wording,
        remediation: question.remediation,
        pointsRecoverable: weight - obtained,
        critical: Boolean(question.critical) && level === 0,
      });
    }
  }

  const raw = pointsApplicable > 0 ? Math.round((pointsObtained / pointsApplicable) * 100) : 0;
  const score = cappedBy.length > 0 ? Math.min(raw, CRITICAL_CAP) : raw;

  recommendations.sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    return b.pointsRecoverable - a.pointsRecoverable;
  });

  const sections: SectionScore[] = SECTIONS.filter((section) => perSection.has(section.code)).map((section) => {
    const bucket = perSection.get(section.code)!;
    return {
      code: section.code,
      label: section.label,
      pointsObtained: bucket.obtained,
      pointsApplicable: bucket.applicable,
      score: bucket.applicable > 0 ? Math.round((bucket.obtained / bucket.applicable) * 100) : null,
      answered: bucket.answered,
      total: bucket.total,
    };
  });

  return {
    applicable: scored.map((question) => question.code),
    missing,
    complete: missing.length === 0,
    pointsObtained,
    pointsApplicable,
    score: blocker ? null : score,
    cappedBy,
    blockedBy: blocker?.code ?? null,
    blockMessage: blocker?.blockMessage ?? null,
    verdict: blocker ? 'blocked' : verdictFor(score, cappedBy),
    sections,
    recommendations,
    // Cadrage compris : lui aussi se remplit.
    estimatedMinutes: Math.max(1, Math.round((framing.length + scored.length) * MINUTES_PER_QUESTION)),
  };
}
