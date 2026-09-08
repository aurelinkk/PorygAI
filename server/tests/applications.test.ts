import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApplicationDto } from '@poryg/shared';
import { all, one } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs, validApplication } from './helpers.js';

describe('applications', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('exige une session (401) sur la liste et la création', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/applications' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/applications', payload: validApplication(app) })).statusCode).toBe(401);
  });

  it("un utilisateur standard ne peut pas déclarer d'application (403)", async () => {
    const cookie = await loginAs(app, ACCOUNTS.standard);
    const response = await app.inject({ method: 'POST', url: '/api/applications', payload: validApplication(app), headers: { cookie } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    expect(all(app.db, "SELECT 1 FROM applications WHERE name = 'Assistant Juridique'")).toHaveLength(0);
  });

  it("un Application Manager crée un brouillon avec code séquentiel et ligne d'audit", async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const response = await app.inject({ method: 'POST', url: '/api/applications', payload: validApplication(app), headers: { cookie } });
    expect(response.statusCode).toBe(201);

    const created: ApplicationDto = response.json().application;
    expect(created.code).toBe('APP-0009'); // 8 applications dans le seed
    expect(created.status).toBe('draft');
    expect(created.createdBy?.displayName).toBe('Camille Roux');
    expect(created.processOwner.displayName).toBe('Camille Roux');

    const audit = one<{ actor_id: number; action: string; after_json: string }>(
      app.db, "SELECT actor_id, action, after_json FROM audit_log WHERE entity = 'application' AND entity_id = ?", String(created.id),
    );
    expect(audit?.action).toBe('create');
    expect(audit?.actor_id).toBe(created.createdBy?.id);
    expect(JSON.parse(audit!.after_json).code).toBe('APP-0009');
  });

  it('renvoie une erreur de validation par champ', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const response = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie },
      payload: { name: 'A', businessDomain: 'inconnu', dataSensitivity: '', aiType: 'genai', processOwnerId: 'x' },
    });
    expect(response.statusCode).toBe(400);
    const { fields } = response.json().error;
    expect(Object.keys(fields).sort()).toEqual(['businessDomain', 'dataSensitivity', 'name', 'processOwnerId']);
  });

  it('refuse un Process Owner inconnu', async () => {
    const cookie = await loginAs(app, ACCOUNTS.aiOfficer);
    const response = await app.inject({
      method: 'POST', url: '/api/applications', headers: { cookie }, payload: { ...validApplication(app), processOwnerId: 999 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.processOwnerId).toBeDefined();
  });

  it("les brouillons ne sont visibles que par leur propriétaire et l'AI Officer", async () => {
    const listFor = async (email: string) => {
      const cookie = await loginAs(app, email);
      const response = await app.inject({ method: 'GET', url: '/api/applications', headers: { cookie } });
      return (response.json().applications as ApplicationDto[]).map((a) => a.status);
    };
    expect(await listFor(ACCOUNTS.standard)).not.toContain('draft');
    expect(await listFor(ACCOUNTS.auditor)).not.toContain('draft');
    expect(await listFor(ACCOUNTS.appManager)).toContain('draft'); // propriétaire du brouillon du seed
    expect(await listFor(ACCOUNTS.aiOfficer)).toContain('draft');
  });

  it('les applications supprimées restent listées avec leur traçabilité', async () => {
    const cookie = await loginAs(app, ACCOUNTS.standard);
    const response = await app.inject({ method: 'GET', url: '/api/applications', headers: { cookie } });
    const deleted = (response.json().applications as ApplicationDto[]).find((a) => a.status === 'deleted');
    expect(deleted).toBeDefined();
    expect(deleted?.deletedBy?.displayName).toBe('Alice Martin');
    expect(deleted?.deletedAt).toBe('2026-06-15T09:12:00.000Z');
  });

  it("un brouillon d'autrui renvoie 404 (pas d'information révélée)", async () => {
    const draft = one<{ id: number }>(app.db, "SELECT id FROM applications WHERE status = 'draft'")!;
    const cookie = await loginAs(app, ACCOUNTS.auditor);
    const response = await app.inject({ method: 'GET', url: `/api/applications/${draft.id}`, headers: { cookie } });
    expect(response.statusCode).toBe(404);
  });
});
