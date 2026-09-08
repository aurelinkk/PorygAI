/**
 * Accès SQLite via le module intégré `node:sqlite` (Node ≥ 22.13) : aucune
 * dépendance native à compiler. L'API est synchrone et volontairement simple.
 *
 * Si un jour il fallait changer de moteur, seul ce fichier et les requêtes SQL
 * des repositories seraient concernés (le reste manipule des DTO).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;     -- lectures concurrentes aux écritures
    PRAGMA foreign_keys = ON;      -- SQLite ne les vérifie pas par défaut !
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

/** Petits raccourcis typés pour garder les repositories lisibles. */
export function one<T>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

/** Exécute `fn` dans une transaction ; rollback automatique en cas d'exception. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
