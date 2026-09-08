/**
 * GET /api/users → annuaire des utilisateurs actifs (pour choisir un Process Owner).
 * Tout utilisateur connecté peut le consulter ; pas d'e-mail exposé inutilement.
 */
import type { FastifyInstance } from 'fastify';
import type { Role } from '@poryg/shared';
import { all, type Db } from '../db/connection.js';

interface DirectoryRow {
  id: number;
  display_name: string;
  role: Role;
}

export function registerUsersRoutes(app: FastifyInstance, options: { db: Db }): void {
  app.get('/api/users', { preHandler: app.requireAuth }, async () => {
    const rows = all<DirectoryRow>(
      options.db, 'SELECT id, display_name, role FROM users WHERE is_active = 1 ORDER BY display_name',
    );
    return { users: rows.map((row) => ({ id: row.id, displayName: row.display_name, role: row.role })) };
  });
}
