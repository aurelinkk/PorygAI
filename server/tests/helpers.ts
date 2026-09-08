/**
 * Utilitaires de test : application complète sur une base SQLite en mémoire,
 * migrée et peuplée avec le jeu de démo. Chaque test a sa propre base.
 */
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DEMO_PASSWORD, seedDatabase } from '../src/db/seed.js';

export const ACCOUNTS = {
  aiOfficer: 'alice.martin@poryg.local',
  appManager: 'camille.roux@poryg.local',
  dpo: 'david.nguyen@poryg.local',
  auditor: 'emma.bernard@poryg.local',
  standard: 'lucas.petit@poryg.local',
} as const;

export async function createTestApp(options: { loginRateLimitMax?: number } = {}): Promise<FastifyInstance> {
  const app = await buildApp({
    dbPath: ':memory:',
    logger: false,
    loginRateLimit: { max: options.loginRateLimitMax ?? 1000, timeWindow: '1 minute' },
  });
  await seedDatabase(app.db);
  await app.ready();
  return app;
}

/** Se connecte et renvoie l'en-tête Cookie à réutiliser dans les requêtes suivantes. */
export async function loginAs(app: FastifyInstance, email: string, password = DEMO_PASSWORD): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (response.statusCode !== 200) throw new Error(`login ${email} → ${response.statusCode} ${response.body}`);
  const cookie = response.cookies.find((c) => c.name === 'poryg_session');
  if (!cookie) throw new Error('cookie de session absent');
  return `${cookie.name}=${cookie.value}`;
}

export const validApplication = {
  name: 'Assistant Juridique',
  description: 'Analyse de contrats.',
  businessDomain: 'juridique',
  dataSensitivity: 'confidential',
  aiType: 'genai',
  processOwnerId: 2, // Camille Roux (2e utilisateur du seed)
};
