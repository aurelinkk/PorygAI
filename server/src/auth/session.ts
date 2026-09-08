/**
 * Sessions côté serveur, stockées en base. Le navigateur ne détient qu'un
 * identifiant aléatoire dans un cookie httpOnly : rien d'exploitable côté JS,
 * et une session se révoque en supprimant sa ligne.
 */
import { randomBytes } from 'node:crypto';
import type { Role, UserDto } from '@poryg/shared';
import { one, run, type Db } from '../db/connection.js';
import { addHours, nowIso } from '../lib/time.js';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export function createSession(db: Db, userId: number, ttlHours: number, meta: SessionMeta = {}): string {
  const id = randomBytes(32).toString('base64url'); // 256 bits d'entropie
  run(
    db,
    'INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
    id, userId, addHours(nowIso(), ttlHours), meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null,
  );
  return id;
}

interface SessionUserRow {
  expires_at: string;
  id: number;
  email: string;
  display_name: string;
  role: Role;
  is_active: number;
}

/**
 * Retrouve l'utilisateur d'une session valide, et prolonge la session
 * (expiration glissante). Renvoie `null` si inconnue, expirée ou compte désactivé.
 */
export function resolveSession(db: Db, sessionId: string, ttlHours: number): UserDto | null {
  const row = one<SessionUserRow>(
    db,
    `SELECT s.expires_at, u.id, u.email, u.display_name, u.role, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    sessionId,
  );
  if (!row || !row.is_active) return null;

  const now = nowIso();
  if (row.expires_at <= now) {
    deleteSession(db, sessionId);
    return null;
  }
  run(db, 'UPDATE sessions SET expires_at = ? WHERE id = ?', addHours(now, ttlHours), sessionId);

  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}

export function deleteSession(db: Db, sessionId: string): void {
  run(db, 'DELETE FROM sessions WHERE id = ?', sessionId);
}

/** Ménage périodique (les sessions expirées ne sont pas supprimées à la volée). */
export function purgeExpiredSessions(db: Db): number {
  return Number(run(db, 'DELETE FROM sessions WHERE expires_at <= ?', nowIso()).changes);
}
