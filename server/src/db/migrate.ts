/**
 * Migrations SQL minimalistes : les fichiers `migrations/NNN_nom.sql` sont
 * appliqués dans l'ordre, une seule fois, chacun dans une transaction.
 * La table `_migrations` mémorise ce qui a déjà été joué.
 *
 * Pour faire évoluer le schéma : ajouter un nouveau fichier, jamais modifier
 * un fichier déjà appliqué.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, run, transaction, type Db } from './connection.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export function runMigrations(db: Db, log: (message: string) => void = () => {}): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const applied = new Set(all<{ name: string }>(db, 'SELECT name FROM _migrations').map((row) => row.name));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      run(db, 'INSERT INTO _migrations (name) VALUES (?)', file);
    });
    log(`[db] migration appliquée : ${file}`);
    newlyApplied.push(file);
  }
  return newlyApplied;
}
