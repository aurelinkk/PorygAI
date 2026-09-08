/**
 * Provider local : e-mail + mot de passe vérifiés contre `users.password_hash`.
 */
import { randomBytes } from 'node:crypto';
import { one, type Db } from '../db/connection.js';
import { hashPassword, verifyPassword } from './password.js';
import type { AuthProvider } from './provider.js';

interface UserCredentialsRow {
  email: string;
  display_name: string;
  password_hash: string | null;
  is_active: number;
}

// Hash "leurre" : quand l'e-mail est inconnu, on vérifie quand même un mot de
// passe pour que la réponse prenne le même temps (pas d'énumération de comptes).
const decoyHash = hashPassword(randomBytes(24).toString('base64'));

export function createLocalAuthProvider(db: Db): AuthProvider {
  return {
    kind: 'local',

    async authenticate(input) {
      if (input.kind !== 'password') return null;

      const row = one<UserCredentialsRow>(
        db,
        'SELECT email, display_name, password_hash, is_active FROM users WHERE email = ?',
        input.email,
      );

      const hashToCheck = row?.password_hash ?? (await decoyHash);
      const passwordOk = await verifyPassword(input.password, hashToCheck);

      if (!row || !row.password_hash || !row.is_active || !passwordOk) return null;
      return { email: row.email, displayName: row.display_name };
    },
  };
}
