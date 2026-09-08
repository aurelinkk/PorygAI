/**
 * Schémas de validation Zod, partagés : le client valide avant d'envoyer
 * (feedback immédiat), le serveur revalide TOUJOURS à l'entrée (sécurité).
 */
import { z } from 'zod';
import { AI_TYPES, BUSINESS_DOMAINS, DATA_SENSITIVITIES } from './referentiels.js';

/** Transforme un référentiel en tuple de codes utilisable par z.enum(). */
const codes = <T extends readonly { code: string }[]>(list: T) =>
  list.map((item) => item.code) as [T[number]['code'], ...T[number]['code'][]];

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Adresse e-mail requise').email('Adresse e-mail invalide').max(254),
  password: z.string().min(1, 'Mot de passe requis').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createApplicationSchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit faire au moins 2 caractères').max(120, '120 caractères maximum'),
  description: z.string().trim().max(2000, '2000 caractères maximum').default(''),
  businessDomain: z.enum(codes(BUSINESS_DOMAINS), { errorMap: () => ({ message: 'Choisir un domaine métier' }) }),
  dataSensitivity: z.enum(codes(DATA_SENSITIVITIES), {
    errorMap: () => ({ message: 'Indiquer la sensibilité des données' }),
  }),
  aiType: z.enum(codes(AI_TYPES), { errorMap: () => ({ message: "Choisir un type d'IA" }) }),
  processOwnerId: z.coerce.number({ invalid_type_error: 'Désigner un Process Owner' }).int().positive('Désigner un Process Owner'),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
