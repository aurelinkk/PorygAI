import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { all } from '../src/db/connection.js';
import { ACCOUNTS, createTestApp, loginAs } from './helpers.js';

describe('authentification', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('connexion réussie : cookie httpOnly + SameSite=Strict, et audit "login"', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: ACCOUNTS.standard, password: 'Poryg2026!' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ email: ACCOUNTS.standard, role: 'standard' });

    const cookie = response.cookies.find((c) => c.name === 'poryg_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(cookie.value.length).toBeGreaterThanOrEqual(40);

    const audit = all<{ action: string }>(app.db, "SELECT action FROM audit_log WHERE entity = 'user' AND action = 'login'");
    expect(audit).toHaveLength(1);
  });

  it('mauvais mot de passe et e-mail inconnu renvoient le même message', async () => {
    const wrongPassword = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: ACCOUNTS.standard, password: 'nope' },
    });
    const unknownEmail = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: 'inconnu@poryg.local', password: 'nope' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());

    const failed = all(app.db, "SELECT 1 FROM audit_log WHERE action = 'login_failed'");
    expect(failed).toHaveLength(2);
  });

  it('valide le corps de la requête', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'pas-un-email' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.json().error.fields).toHaveProperty('email');
    expect(response.json().error.fields).toHaveProperty('password');
  });

  it('/me renvoie user=null sans session, puis l’utilisateur avec ; logout invalide la session', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json().user).toBeNull();

    const cookie = await loginAs(app, ACCOUNTS.dpo);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.role).toBe('dpo');

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.json().user).toBeNull();
  });

  it('un cookie forgé ne donne pas accès', async () => {
    const forged = { cookie: 'poryg_session=abcdefghijklmnopqrstuvwxyz0123456789ABCD' };
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: forged });
    expect(me.json().user).toBeNull();
    const protectedRoute = await app.inject({ method: 'GET', url: '/api/applications', headers: forged });
    expect(protectedRoute.statusCode).toBe(401);
  });

  it('refuse une requête mutante venant d’un autre site (CSRF)', async () => {
    const cookie = await loginAs(app, ACCOUNTS.appManager);
    const crossSite = await app.inject({
      method: 'POST', url: '/api/auth/logout', headers: { cookie, 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.statusCode).toBe(403);

    const badOrigin = await app.inject({
      method: 'POST', url: '/api/auth/logout', headers: { cookie, origin: 'https://evil.example' },
    });
    expect(badOrigin.statusCode).toBe(403);
  });
});

describe('limitation de débit sur le login', () => {
  it('bloque après le nombre de tentatives autorisé', async () => {
    const app = await createTestApp({ loginRateLimitMax: 3 });
    const attempt = () =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ACCOUNTS.standard, password: 'nope' } });
    for (let i = 0; i < 3; i += 1) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    await app.close();
  });
});
