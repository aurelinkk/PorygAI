import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { all, one, run } from '../src/db/connection.js';
import { expireCompliances } from '../src/jobs/compliance-expiry.js';
import { createTestApp } from './helpers.js';

describe('règles de gestion en base', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('une conformité échue repasse "in_progress" avec une trace système', async () => {
    const before = one<{ status: string }>(app.db, "SELECT status FROM applications WHERE name = 'Détection Fraude'");
    expect(before?.status).toBe('compliant');

    const n = expireCompliances(app.db, '2026-09-08T00:00:00.000Z');
    expect(n).toBe(1); // seule "Détection Fraude" (échue au 2026-08-01) bascule

    const after = one<{ status: string }>(app.db, "SELECT status FROM applications WHERE name = 'Détection Fraude'");
    expect(after?.status).toBe('in_progress');

    const stillCompliant = all(app.db, "SELECT 1 FROM applications WHERE status = 'compliant'");
    expect(stillCompliant).toHaveLength(2);

    const audit = one<{ actor_id: number | null; before_json: string }>(
      app.db, "SELECT actor_id, before_json FROM audit_log WHERE action = 'compliance_expired'",
    );
    expect(audit?.actor_id).toBeNull();
    expect(JSON.parse(audit!.before_json).complianceValidUntil).toBe('2026-08-01T00:00:00.000Z');

    // Idempotent : un second passage ne fait rien.
    expect(expireCompliances(app.db, '2026-09-08T00:00:00.000Z')).toBe(0);
  });

  it('la suppression physique d’une application est bloquée par la base', () => {
    expect(() => run(app.db, 'DELETE FROM applications WHERE id = 1')).toThrow(/Suppression physique interdite/);
    expect(all(app.db, 'SELECT 1 FROM applications WHERE id = 1')).toHaveLength(1);
  });

  it('le journal d’audit est immuable', () => {
    expect(() => run(app.db, "UPDATE audit_log SET action = 'x' WHERE id = 1")).toThrow(/immuable/);
    expect(() => run(app.db, 'DELETE FROM audit_log WHERE id = 1')).toThrow(/immuable/);
  });
});
