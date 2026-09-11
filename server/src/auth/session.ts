/**
 * Sessions côté serveur, stockées en base. Le navigateur ne détient qu'un
 * identifiant aléatoire dans un cookie httpOnly : rien d'exploitable côté JS,
 * et une session se révoque en supprimant sa ligne.
 */
import { randomBytes } from 'node:crypto';
import type { UserDto } from '@poryg/shared';
import { one, run, type Db } from '../db/connection.js';
import { resolveActiveMembership } from '../modules/organizations.repo.js';
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
  organization_id: number | null;
  id: number;
  email: string;
  display_name: string;
  is_active: number;
}

/**
 * Change l'organisation active d'une session. Vérifier l'appartenance est du
 * ressort de l'appelant (routes/organizations.routes.ts) : ici on écrit.
 */
export function setSessionOrganization(db: Db, sessionId: string, organizationId: number): void {
  run(db, 'UPDATE sessions SET organization_id = ? WHERE id = ?', organizationId, sessionId);
}

/**
 * Retrouve l'utilisateur d'une session valide, et prolonge la session
 * (expiration glissante). Renvoie `null` si inconnue, expirée ou compte désactivé.
 */
export function resolveSession(db: Db, sessionId: string, ttlHours: number): UserDto | null {
  const row = one<SessionUserRow>(
    db,
    `SELECT s.expires_at, s.organization_id, u.id, u.email, u.display_name, u.is_active
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

  // Expiration glissante, mais on n'écrit pas à CHAQUE requête : une page en
  // charge plusieurs, et chaque écriture touche le journal WAL pour rien. On ne
  // prolonge que lorsqu'il reste moins de la moitié de la durée de vie : le
  // comportement pour l'utilisateur est identique.
  const halfLife = addHours(now, ttlHours / 2);
  if (row.expires_at < halfLife) {
    run(db, 'UPDATE sessions SET expires_at = ? WHERE id = ?', addHours(now, ttlHours), sessionId);
  }

  // L'organisation active, et le rôle qui va avec : le rôle n'est pas un
  // attribut du compte mais de l'appartenance (voir modules/organizations.repo).
  // Si l'organisation mémorisée n'est plus accessible (personne retirée,
  // organisation supprimée), on retombe sur la première appartenance valide
  // plutôt que de laisser la session sur une organisation qui n'est plus la
  // sienne.
  const membership = resolveActiveMembership(db, row.id, row.organization_id);
  if (membership && membership.organizationId !== row.organization_id) {
    run(db, 'UPDATE sessions SET organization_id = ? WHERE id = ?', membership.organizationId, sessionId);
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    // Sans organisation : le rôle le moins doté, et aucune donnée métier
    // accessible (requirePermission refuse tant qu'il n'y a pas d'organisation).
    role: membership?.role ?? 'standard',
    organizationId: membership?.organizationId ?? null,
  };
}

export function deleteSession(db: Db, sessionId: string): void {
  run(db, 'DELETE FROM sessions WHERE id = ?', sessionId);
}

/** Ménage périodique (les sessions expirées ne sont pas supprimées à la volée). */
export function purgeExpiredSessions(db: Db): number {
  return Number(run(db, 'DELETE FROM sessions WHERE expires_at <= ?', nowIso()).changes);
}
