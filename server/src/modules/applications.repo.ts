/**
 * Accès aux applications IA. Toute écriture passe par ici et journalise dans audit_log.
 *
 * Règle de visibilité : un brouillon (draft) n'est visible que par son Process Owner,
 * son créateur, et les rôles ayant `application:read_all_drafts` (AI Officer).
 */
import { can, type AppStatus, type ApplicationDto, type CreateApplicationInput, type UserDto } from '@poryg/shared';
import { recordAudit } from '../audit.js';
import { all, one, run, transaction, type Db } from '../db/connection.js';

export interface ApplicationRow {
  id: number;
  code: string;
  name: string;
  description: string;
  business_domain: string;
  data_sensitivity: string;
  ai_type: string;
  process_owner_id: number;
  owner_name: string;
  status: AppStatus;
  compliance_valid_until: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_by: number | null;
  deleted_by_name: string | null;
  deleted_at: string | null;
}

const SELECT_APPLICATION = `
  SELECT a.*,
         owner.display_name   AS owner_name,
         creator.display_name AS created_by_name,
         deleter.display_name AS deleted_by_name
    FROM applications a
    JOIN users owner   ON owner.id   = a.process_owner_id
    LEFT JOIN users creator ON creator.id = a.created_by
    LEFT JOIN users deleter ON deleter.id = a.deleted_by
`;

export function toDto(row: ApplicationRow): ApplicationDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    businessDomain: row.business_domain,
    dataSensitivity: row.data_sensitivity,
    aiType: row.ai_type,
    processOwner: { id: row.process_owner_id, displayName: row.owner_name },
    status: row.status,
    complianceValidUntil: row.compliance_valid_until,
    createdAt: row.created_at,
    createdBy: row.created_by && row.created_by_name ? { id: row.created_by, displayName: row.created_by_name } : null,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by && row.deleted_by_name ? { id: row.deleted_by, displayName: row.deleted_by_name } : null,
  };
}

/** Clause SQL de visibilité pour un utilisateur donné (à insérer après WHERE). */
export function visibilityClause(user: UserDto): { sql: string; params: number[] } {
  if (can(user.role, 'application:read_all_drafts')) return { sql: '1 = 1', params: [] };
  return {
    sql: "(a.status <> 'draft' OR a.process_owner_id = ? OR a.created_by = ?)",
    params: [user.id, user.id],
  };
}

export function listApplications(db: Db, user: UserDto, limit = 200): ApplicationDto[] {
  const visibility = visibilityClause(user);
  const rows = all<ApplicationRow>(
    db,
    `${SELECT_APPLICATION} WHERE ${visibility.sql} ORDER BY a.updated_at DESC LIMIT ?`,
    ...visibility.params, limit,
  );
  return rows.map(toDto);
}

export function getApplication(db: Db, id: number): ApplicationDto | null {
  const row = one<ApplicationRow>(db, `${SELECT_APPLICATION} WHERE a.id = ?`, id);
  return row ? toDto(row) : null;
}

/** Crée une application en statut `draft`, avec un code séquentiel APP-NNNN. */
export function createApplication(
  db: Db, input: CreateApplicationInput, actor: UserDto, ip?: string,
): ApplicationDto {
  return transaction(db, () => {
    const next = one<{ n: number }>(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS n FROM applications')!.n;
    const code = `APP-${String(next).padStart(4, '0')}`;

    const result = run(
      db,
      `INSERT INTO applications
         (code, name, description, business_domain, data_sensitivity, ai_type, process_owner_id, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      code, input.name, input.description, input.businessDomain, input.dataSensitivity, input.aiType,
      input.processOwnerId, actor.id, actor.id,
    );
    const id = Number(result.lastInsertRowid);
    const created = getApplication(db, id)!;

    recordAudit(db, { actorId: actor.id, entity: 'application', entityId: id, action: 'create', after: created, ip });
    return created;
  });
}
