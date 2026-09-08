import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('hachage des mots de passe (scrypt)', () => {
  it('vérifie un mot de passe correct et rejette un mauvais', async () => {
    const hash = await hashPassword('Poryg2026!');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('Poryg2026!', hash)).toBe(true);
    expect(await verifyPassword('poryg2026!', hash)).toBe(false);
  });

  it('produit un hash différent à chaque fois (sel aléatoire)', async () => {
    const a = await hashPassword('même mot de passe');
    const b = await hashPassword('même mot de passe');
    expect(a).not.toBe(b);
  });

  it('rejette un format de hash inconnu sans lever', async () => {
    expect(await verifyPassword('x', 'md5$abc')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});
