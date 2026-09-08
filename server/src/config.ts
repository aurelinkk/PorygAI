/**
 * Configuration du serveur, lue depuis les variables d'environnement.
 * Un fichier `.env` à la racine du projet est chargé s'il existe (voir `.env.example`).
 * Aucune dépendance : Node fournit `process.loadEnvFile()`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// server/src/config.ts → racine du projet
const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));

const envFile = resolve(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const nodeEnv = env.NODE_ENV ?? 'development';

export const config = {
  rootDir: ROOT_DIR,
  nodeEnv,
  isProduction: nodeEnv === 'production',

  /** L'API n'écoute que sur localhost par défaut. API_HOST=0.0.0.0 pour l'exposer sur le réseau.
   *  (Variables préfixées API_ pour ne pas entrer en conflit avec le PORT d'autres outils.) */
  host: env.API_HOST ?? '127.0.0.1',
  port: Number(env.API_PORT ?? 3000),

  dbPath: resolve(ROOT_DIR, env.DB_PATH ?? 'data/poryg.db'),

  session: {
    cookieName: 'poryg_session',
    ttlHours: Number(env.SESSION_TTL_HOURS ?? 8),
  },

  /** Limite de tentatives de connexion par IP (anti force brute). */
  loginRateLimit: { max: 5, timeWindow: '1 minute' },

  /** Dossier du front compilé, servi par l'API en production uniquement. */
  clientDistDir: resolve(ROOT_DIR, 'client/dist'),
} as const;
