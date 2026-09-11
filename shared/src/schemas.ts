/**
 * Schémas de validation Zod, partagés : le client valide avant d'envoyer
 * (feedback immédiat), le serveur revalide TOUJOURS à l'entrée (sécurité).
 */
import { z } from 'zod';
import { PLANS } from './plans.js';
import { BUSINESS_CRITICALITIES } from './questionnaire.js';
import { AI_TYPES, BUSINESS_DOMAINS, DATA_SENSITIVITIES } from './referentiels.js';
import { ROLES } from './roles.js';
import { APP_STATUSES } from './statuses.js';

/** Transforme un référentiel en tuple de codes utilisable par z.enum(). */
const codes = <T extends readonly { code: string }[]>(list: T) =>
  list.map((item) => item.code) as [T[number]['code'], ...T[number]['code'][]];

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Adresse e-mail requise').email('Adresse e-mail invalide').max(254),
  password: z.string().min(1, 'Mot de passe requis').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// --- Organisations -----------------------------------------------------------

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Le nom de l'organisation doit faire au moins 2 caractères")
    .max(80, '80 caractères maximum'),
  plan: z.enum(PLANS, { errorMap: () => ({ message: 'Choisir une formule' }) }),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Réglages de l'organisation : mêmes champs, modifiables séparément ou ensemble. */
export const updateOrganizationSchema = createOrganizationSchema;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/**
 * Import de comptes : un texte collé, une personne par ligne.
 * Le format est volontairement tolérant (voir `parseMemberLine` côté serveur) ;
 * c'est le serveur qui analyse, et `dryRun` demande l'aperçu du même traitement
 * plutôt qu'une seconde implémentation côté client qui pourrait en diverger.
 */
export const importMembersSchema = z.object({
  text: z.string().min(1, 'Collez au moins une ligne').max(100_000, 'Fichier trop volumineux'),
  dryRun: z.boolean().default(false),
});
export type ImportMembersInput = z.infer<typeof importMembersSchema>;

/** Modification d'une personne dans l'organisation : son rôle, sa présence. */
export const updateMemberSchema = z.object({
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Choisir un rôle' }) }),
  status: z.enum(['active', 'disabled']).default('active'),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

// --- Applications ------------------------------------------------------------

export const createApplicationSchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit faire au moins 2 caractères').max(120, '120 caractères maximum'),
  description: z.string().trim().max(2000, '2000 caractères maximum').default(''),
  businessDomain: z.enum(codes(BUSINESS_DOMAINS), { errorMap: () => ({ message: 'Choisir un domaine métier' }) }),
  /**
   * Une application croise souvent plusieurs natures de données (des données
   * internes ET des données personnelles). On les saisit toutes ; le serveur en
   * dérive le niveau le plus élevé (`highestSensitivity`) pour tout ce qui a
   * besoin d'une seule valeur.
   */
  dataSensitivities: z
    .array(z.enum(codes(DATA_SENSITIVITIES)))
    .min(1, 'Indiquer au moins une nature de données traitées')
    .max(DATA_SENSITIVITIES.length)
    // Rangée dans l'ordre du référentiel et dédoublonnée ici, donc des deux
    // côtés : l'affichage est stable et deux sélections identiques saisies dans
    // un ordre différent ne passent pas pour un changement.
    .transform((selection) =>
      DATA_SENSITIVITIES.filter((item) => selection.includes(item.code)).map((item) => item.code),
    ),
  aiType: z.enum(codes(AI_TYPES), { errorMap: () => ({ message: "Choisir un type d'IA" }) }),
  processOwnerId: z.coerce.number({ invalid_type_error: 'Désigner un Process Owner' }).int().positive('Désigner un Process Owner'),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

/**
 * Modification : mêmes champs que la déclaration (le formulaire d'édition les
 * affiche tous). Schéma distinct pour pouvoir diverger sans casser la création.
 */
export const updateApplicationSchema = createApplicationSchema;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

/**
 * Champs dont la modification remet une application conforme (ou non conforme)
 * en cours d'audit : ils changent ce qui a été évalué. Un changement de nom, de
 * description ou de Process Owner ne déclenche pas de réévaluation.
 *
 * C'est bien la LISTE des sensibilités qui compte, pas le niveau le plus élevé :
 * ajouter « données personnelles » à une application qui traitait déjà des
 * données de santé ne change pas le maximum, mais change ce qui a été audité.
 */
export const REEVALUATION_FIELDS = ['businessDomain', 'dataSensitivities', 'aiType'] as const;

/** Une chaîne de requête vide (`?status=`) doit valoir « non filtré ». */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' || value === undefined ? undefined : value), schema.optional());

/**
 * Une réponse : échelle (0/1/2 en nombre ou en chaîne), valeur d'un choix, ou
 * liste de valeurs pour un choix multiple.
 */
const answerValueSchema = z.union([
  z.number().int().min(0).max(2),
  z.string().max(40),
  z.array(z.string().max(40)).max(20),
]);

/** Informations préliminaires (non notées) + réponses au questionnaire. */
export const saveEvaluationSchema = z.object({
  toolVendor: z.string().trim().max(200, '200 caractères maximum').default(''),
  purpose: z.string().trim().max(2000, '2000 caractères maximum').default(''),
  businessCriticality: z.enum(codes(BUSINESS_CRITICALITIES)).optional().nullable(),
  /** code de question → réponse. Une question sans réponse est simplement absente. */
  answers: z.record(z.string(), answerValueSchema).default({}),
  comments: z.record(z.string(), z.string().trim().max(1000)).default({}),
});
export type SaveEvaluationInput = z.infer<typeof saveEvaluationSchema>;

/** À la soumission, les informations préliminaires deviennent obligatoires. */
export const submitEvaluationSchema = saveEvaluationSchema.extend({
  toolVendor: z.string().trim().min(2, "Indiquer l'outil et son éditeur").max(200),
  purpose: z.string().trim().min(10, 'Décrire la finalité précise (10 caractères minimum)').max(2000),
  businessCriticality: z.enum(codes(BUSINESS_CRITICALITIES), {
    errorMap: () => ({ message: 'Indiquer la criticité métier' }),
  }),
});
export type SubmitEvaluationInput = z.infer<typeof submitEvaluationSchema>;

/**
 * Saisie mensuelle d'une application : coût, énergie et carbone.
 *
 * Les deux dernières sont facultatives : toutes les équipes ne savent pas encore
 * mesurer leur consommation : mais elles font partie de la même saisie : demander
 * l'empreinte au moment où l'on saisit la facture est le seul moyen qu'elle soit
 * renseignée un jour.
 */
export const saveCostSchema = z.object({
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois attendu au format AAAA-MM'),
  amountEur: z.coerce
    .number({ invalid_type_error: 'Montant invalide' })
    .min(0, 'Le montant ne peut pas être négatif')
    .max(100_000_000, 'Montant hors limites'),
  energyKwh: z.coerce
    .number({ invalid_type_error: 'Consommation invalide' })
    .min(0, 'La consommation ne peut pas être négative')
    .max(1_000_000_000, 'Consommation hors limites')
    .default(0),
  co2Kg: z.coerce
    .number({ invalid_type_error: 'Empreinte invalide' })
    .min(0, "L'empreinte ne peut pas être négative")
    .max(1_000_000_000, 'Empreinte hors limites')
    .default(0),
});
export type SaveCostInput = z.infer<typeof saveCostSchema>;

/** Fenêtre d'analyse du rapport FinOps, en nombre de mois. */
export const finopsQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(6),
});

/** Même fenêtre pour les tableaux de bord BI, avec un historique par défaut plus long. */
export const biQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});

export const applicationFiltersSchema = z.object({
  /** Recherche libre sur le nom, le code et la description. */
  q: optional(z.string().trim().max(120)),
  status: optional(z.enum(APP_STATUSES)),
  domain: optional(z.enum(codes(BUSINESS_DOMAINS))),
  sensitivity: optional(z.enum(codes(DATA_SENSITIVITIES))),
});
export type ApplicationFilters = z.infer<typeof applicationFiltersSchema>;
