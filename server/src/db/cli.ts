/**
 * Outil en ligne de commande pour la base locale :
 *   npm run db:migrate   applique les migrations manquantes
 *   npm run db:seed      migre puis insère le jeu de démo (si base vide)
 *   npm run db:reset     supprime le fichier SQLite local, migre, seed
 */
import { rmSync } from 'node:fs';
import { config } from '../config.js';
import { openDatabase } from './connection.js';
import { runMigrations } from './migrate.js';
import { seedDatabase } from './seed.js';

const command = process.argv[2];
const log = (message: string) => console.log(message);

async function main() {
  switch (command) {
    case 'migrate': {
      const db = openDatabase(config.dbPath);
      const applied = runMigrations(db, log);
      if (applied.length === 0) log('[db] schéma déjà à jour');
      db.close();
      break;
    }
    case 'seed': {
      const db = openDatabase(config.dbPath);
      runMigrations(db, log);
      await seedDatabase(db, log);
      db.close();
      break;
    }
    case 'reset': {
      if (config.isProduction) throw new Error('db:reset est interdit en production');
      for (const suffix of ['', '-wal', '-shm']) rmSync(config.dbPath + suffix, { force: true });
      log(`[db] base supprimée : ${config.dbPath}`);
      const db = openDatabase(config.dbPath);
      runMigrations(db, log);
      await seedDatabase(db, log);
      db.close();
      break;
    }
    default:
      console.error('Usage : cli.ts <migrate|seed|reset>');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
