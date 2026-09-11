/**
 * GET /api/users → annuaire de l'organisation active (pour choisir un Process Owner).
 *
 * Seules les personnes de l'organisation courante y figurent : on ne désigne pas
 * responsable quelqu'un d'ailleurs, et l'annuaire ne doit pas révéler qui
 * travaille chez les autres. Le rôle affiché est celui tenu DANS cette
 * organisation, pas un attribut du compte.
 *
 * Pas d'adresse e-mail : le choix d'un Process Owner n'en a pas besoin. Elles ne
 * sont visibles que dans « Mon organisation », réservé à l'AI Officer.
 */
import type { FastifyInstance } from 'fastify';
import type { Role } from '@poryg/shared';
import { all, type Db } from '../db/connection.js';
import { currentOrganizationId } from './organizations.repo.js';

interface DirectoryRow {
  id: number;
  display_name: string;
  role: Role;
}

export function registerUsersRoutes(app: FastifyInstance, options: { db: Db }): void {
  app.get('/api/users', { preHandler: app.requirePermission('application:read') }, async (request) => {
    const rows = all<DirectoryRow>(
      options.db,
      `SELECT u.id, u.display_name, m.role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ? AND m.status = 'active' AND u.is_active = 1
        ORDER BY u.display_name`,
      currentOrganizationId(request.user!),
    );
    return { users: rows.map((row) => ({ id: row.id, displayName: row.display_name, role: row.role })) };
  });
}
