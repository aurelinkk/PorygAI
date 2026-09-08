/**
 * Journal d'audit. Règle du projet : TOUTE mutation métier appelle `recordAudit`
 * dans la même transaction que l'écriture. `actorId: null` = action du système.
 */
import { run, type Db } from './db/connection.js';

export interface AuditEntry {
  actorId: number | null;
  entity: 'application' | 'user' | 'session' | 'finops_cost';
  entityId: number | string;
  action: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

export function recordAudit(db: Db, entry: AuditEntry): void {
  run(
    db,
    `INSERT INTO audit_log (actor_id, entity, entity_id, action, before_json, after_json, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entry.actorId,
    entry.entity,
    String(entry.entityId),
    entry.action,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
    entry.ip ?? null,
  );
}
