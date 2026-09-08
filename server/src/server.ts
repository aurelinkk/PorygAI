/**
 * Point d'entrée : construit l'application, lance les jobs périodiques, écoute.
 */
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth/session.js';
import { config } from './config.js';
import { scheduleComplianceExpiry } from './jobs/compliance-expiry.js';

const app = await buildApp();
const log = (message: string) => app.log.info(message);

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
