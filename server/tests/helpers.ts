/**
 * Utilitaires de test : application complète sur une base SQLite en mémoire,
 * migrée et peuplée avec le jeu de démo. Chaque test a sa propre base.
 */
import type { FastifyInstance } from 'fastify';
import { applicableQuestions, type Answers } from '@poryg/shared';
import { buildApp } from '../src/app.js';
import type { GoogleConfig } from '../src/auth/google-sso.js';
import { one } from '../src/db/connection.js';
import { DEMO_PASSWORD, seedDatabase } from '../src/db/seed.js';

export const ACCOUNTS = {
  aiOfficer: 'alice.martin@poryg.local',
  appManager: 'camille.roux@poryg.local',
  dpo: 'david.nguyen@poryg.local',
  auditor: 'emma.bernard@poryg.local',
  standard: 'lucas.petit@poryg.local',
} as const;

export async function createTestApp(
  options: { loginRateLimitMax?: number; google?: GoogleConfig | null } = {},
): Promise<FastifyInstance> {
  const app = await buildApp({
    dbPath: ':memory:',
    logger: false,
    loginRateLimit: { max: options.loginRateLimitMax ?? 1000, timeWindow: '1 minute' },
    google: options.google ?? null,
  });
  await seedDatabase(app.db);
  await app.ready();
  return app;
}

/** Identifiant d'un utilisateur par e-mail (les ids dépendent de l'ordre des migrations). */
export function userId(app: FastifyInstance, email: string): number {
  const row = one<{ id: number }>(app.db, 'SELECT id FROM users WHERE email = ?', email);
  if (!row) throw new Error(`utilisateur introuvable : ${email}`);
  return row.id;
}

/** Se connecte et renvoie l'en-tête Cookie à réutiliser dans les requêtes suivantes. */
export async function loginAs(app: FastifyInstance, email: string, password = DEMO_PASSWORD): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (response.statusCode !== 200) throw new Error(`login ${email} → ${response.statusCode} ${response.body}`);
  const cookie = response.cookies.find((c) => c.name === 'poryg_session');
  if (!cookie) throw new Error('cookie de session absent');
  return `${cookie.name}=${cookie.value}`;
}

/** Charge utile valide pour POST /api/applications (Process Owner = Camille Roux). */
export function validApplication(app: FastifyInstance) {
  return {
    name: 'Assistant Juridique',
    description: 'Analyse de contrats.',
    businessDomain: 'juridique',
    dataSensitivities: ['internal', 'confidential'],
    aiType: 'genai',
    processOwnerId: userId(app, ACCOUNTS.appManager),
  };
}

// --- Questionnaire -----------------------------------------------------------

/**
 * Réponses de gouvernance FinOps **volontairement neutres** : leur ajustement de
 * score vaut zéro. Les tests qui portent sur le score du questionnaire ne sont
 * ainsi pas perturbés par le bonus/malus FinOps, qui a ses propres tests.
 */
export const NEUTRAL_GOVERNANCE: Answers = {
  GF1: 'manual',
  GF2: 'quarterly',
  GF3: ['cost', 'energy'],
  GF4: 'team',
  GF5: 'none',
  GF6: 'low',
  GF7: 'onprem',
  GF10: 'medium',
  GF11: 'standard',
};

/**
 * Remplit toutes les questions applicables : les questions notées au niveau
 * demandé, les questions obligatoires non notées avec la valeur neutre.
 *
 * La boucle tourne jusqu'à stabilité : répondre à une question peut en révéler
 * d'autres (`showIf`).
 */
export function answerAll(framing: Answers, level: '0' | '1' | '2' = '2', overrides: Answers = {}): Answers {
  const answers: Answers = { ...framing, ...NEUTRAL_GOVERNANCE, ...overrides };
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of applicableQuestions(answers)) {
      if (answers[question.code] !== undefined) continue;
      if (question.weight === undefined && !question.required) continue;
      answers[question.code] = question.weight === undefined ? '' : level;
      changed = true;
    }
  }
  return answers;
}
