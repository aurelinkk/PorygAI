/**
 * Journal d'audit. Règle du projet : TOUTE mutation métier appelle `recordAudit`
 * dans la même transaction que l'écriture. `actorId: null` = action du système.
 */
import { run, type Db } from './db/connection.js';

export interface AuditEntry {
  actorId: number | null;
  entity: 'application' | 'user' | 'session' | 'finops_cost' | 'organization' | 'membership';
  entityId: number | string;
  action: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  /**
   * Horodatage explicite. Réservé au jeu de démonstration, qui étale son
   * historique sur plusieurs mois ; en fonctionnement normal on laisse la
   * valeur par défaut de SQLite (l'instant présent).
   */
  at?: string;
}

export function recordAudit(db: Db, entry: AuditEntry): void {
  run(
    db,
    `INSERT INTO audit_log (actor_id, entity, entity_id, action, before_json, after_json, ip, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
    entry.actorId,
    entry.entity,
    String(entry.entityId),
    entry.action,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
    entry.ip ?? null,
    entry.at ?? null,
  );
}
