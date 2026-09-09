/**
 * Point d'entrée : construit l'application, lance les jobs périodiques, écoute.
 */
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth/session.js';
import { config } from './config.js';
import { seedDatabase } from './db/seed.js';
import { scheduleComplianceExpiry } from './jobs/compliance-expiry.js';

const app = await buildApp();
const log = (message: string) => app.log.info(message);

/**
 * Base fraîche en développement : le démarrage applique les migrations mais ne
 * semait rien, alors que la page de connexion propose les comptes de démo. Ils
 * n'existaient donc pas et la connexion par mot de passe échouait.
 * `seedDatabase` ne fait rien dès que la base contient une application.
 */
if (!config.isProduction) await seedDatabase(app.db, log);

const stopComplianceJob = scheduleComplianceExpiry(app.db, log);

const purge = () => {
  const n = purgeExpiredSessions(app.db);
  if (n > 0) log(`[jobs] ${n} session(s) expirée(s) purgée(s)`);
};
purge();
const purgeTimer = setInterval(purge, 3_600_000);
purgeTimer.unref();

const shutdown = async (signal: string) => {
  log(`${signal} reçu, arrêt en cours…`);
  stopComplianceJob();
  clearInterval(purgeTimer);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
log(`Poryg'AI API prête — mode ${config.nodeEnv}, base ${config.dbPath}`);
