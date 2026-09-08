/**
 * Hachage des mots de passe avec scrypt (module `node:crypto`, aucune dépendance).
 * Paramètres alignés sur les recommandations OWASP : N=2^15, r=8, p=1 (~32 Mo).
 *
 * Format stocké : scrypt$N$r$p$<sel base64>$<hash base64>
 * Les paramètres sont dans la chaîne : on pourra les renforcer sans invalider
 * les anciens hashs.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PARAMS = { N: 32768, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEM = 128 * 1024 * 1024;

function derive(password: string, salt: Buffer, params: typeof PARAMS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...params, maxmem: MAX_MEM }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, saltB64, hashB64] = stored.split('$');
  if (algorithm !== 'scrypt' || !N || !r || !p || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, 'base64');
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), { N: Number(N), r: Number(r), p: Number(p) });
  // Comparaison en temps constant : ne révèle pas à quel octet ça diverge.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
