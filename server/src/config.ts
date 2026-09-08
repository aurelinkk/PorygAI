/**
 * Configuration du serveur, lue depuis les variables d'environnement.
 * Un fichier `.env` à la racine du projet est chargé s'il existe (voir `.env.example`).
 * Aucune dépendance : Node fournit `process.loadEnvFile()`.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// server/src/config.ts → racine du projet
const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));

const envFile = resolve(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * Lit une variable d'environnement en traitant la chaîne vide comme "non définie".
 * Indispensable : un `.env` copié depuis `.env.example` contient des lignes comme
 * `COOKIE_SECRET=` — sans ce filtre, `??` renverrait la chaîne vide au lieu du défaut.
 */
const read = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
};

const nodeEnv = read('NODE_ENV', 'development');

export const config = {
  rootDir: ROOT_DIR,
  nodeEnv,
  isProduction: nodeEnv === 'production',

  /** L'API n'écoute que sur localhost par défaut. API_HOST=0.0.0.0 pour l'exposer sur le réseau.
   *  (Variables préfixées API_ pour ne pas entrer en conflit avec le PORT d'autres outils.) */
  host: read('API_HOST', '127.0.0.1'),
  port: Number(read('API_PORT', '3000')),

  dbPath: resolve(ROOT_DIR, read('DB_PATH', 'data/poryg.db')),

  session: {
    cookieName: 'poryg_session',
    ttlHours: Number(read('SESSION_TTL_HOURS', '8')),
  },

  /**
   * Secret de signature des cookies techniques (état de connexion SSO).
   * Sans valeur configurée, un secret aléatoire est tiré au démarrage : les
   * connexions Google en cours au moment d'un redémarrage échouent alors avec un
   * message clair, ce qui est acceptable en développement.
   */
  cookieSecret: read('COOKIE_SECRET', randomBytes(32).toString('hex')),

  /** SSO Google. Activé seulement si l'identifiant ET le secret sont fournis. */
  google: {
    clientId: read('GOOGLE_CLIENT_ID', ''),
    clientSecret: read('GOOGLE_CLIENT_SECRET', ''),
    redirectUri: read('GOOGLE_REDIRECT_URI', 'http://localhost:5173/api/auth/google/callback'),
  },

  /** Limite de tentatives de connexion par IP (anti force brute). */
  loginRateLimit: { max: 5, timeWindow: '1 minute' },

  /** Dossier du front compilé, servi par l'API en production uniquement. */
  clientDistDir: resolve(ROOT_DIR, 'client/dist'),
} as const;

/** Le SSO Google est-il utilisable ? (sinon, seule la connexion par mot de passe existe) */
export const isGoogleEnabled = Boolean(config.google.clientId && config.google.clientSecret);
