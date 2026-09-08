/**
 * Règle de gestion : une application est conforme pendant un an, puis repasse
 * automatiquement « In progress » pour être réévaluée.
 *
 * Exécuté au démarrage puis toutes les 24 h. Chaque bascule est journalisée
 * avec `actor_id = NULL` (action du système).
 */
import { recordAudit } from '../audit.js';
import { all, run, transaction, type Db } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

interface ExpiredRow {
  id: number;
  code: string;
  compliance_valid_until: string;
}

export function expireCompliances(db: Db, now: string = nowIso()): number {
  const expired = all<ExpiredRow>(
    db,
    `SELECT id, code, compliance_valid_until FROM applications
      WHERE status = 'compliant' AND compliance_valid_until IS NOT NULL AND compliance_valid_until < ?`,
    now,
  );

  transaction(db, () => {
    for (const row of expired) {
      run(db, "UPDATE applications SET status = 'in_progress', updated_by = NULL, updated_at = ? WHERE id = ?", now, row.id);
      recordAudit(db, {
        actorId: null,
        entity: 'application',
        entityId: row.id,
        action: 'compliance_expired',
        before: { status: 'compliant', complianceValidUntil: row.compliance_valid_until },
        after: { status: 'in_progress' },
      });
    }
  });
  return expired.length;
}

const ONE_DAY_MS = 24 * 3_600_000;

/** Planifie le job ; renvoie une fonction d'arrêt. */
export function scheduleComplianceExpiry(db: Db, log: (message: string) => void): () => void {
  const tick = () => {
    const n = expireCompliances(db);
    if (n > 0) log(`[jobs] ${n} conformité(s) expirée(s) → In progress`);
  };
  tick();
  const timer = setInterval(tick, ONE_DAY_MS);
  timer.unref(); // n'empêche pas le processus de s'arrêter
  return () => clearInterval(timer);
}
