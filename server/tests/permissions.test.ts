import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, can, type Permission } from '@poryg/shared';

describe('matrice de permissions', () => {
  it("l'AI Officer possède toutes les permissions", () => {
    for (const permission of Object.keys(PERMISSIONS) as Permission[]) {
      expect(can('ai_officer', permission), permission).toBe(true);
    }
  });

  it("l'utilisateur standard ne peut que consulter", () => {
    expect(can('standard', 'application:read')).toBe(true);
    expect(can('standard', 'dashboard:read')).toBe(true);
    expect(can('standard', 'application:create')).toBe(false);
    expect(can('standard', 'evaluation:decide')).toBe(false);
    expect(can('standard', 'finops:read')).toBe(false);
  });

  it('seuls Auditeur et AI Officer décident de la conformité', () => {
    const allowed = ROLES.filter((role) => can(role, 'evaluation:decide'));
    expect(allowed.sort()).toEqual(['ai_officer', 'auditor']);
  });

  it("seul l'AI Officer peut supprimer (logiquement)", () => {
    expect(ROLES.filter((role) => can(role, 'application:delete'))).toEqual(['ai_officer']);
  });

  it('toutes les permissions référencent des rôles connus', () => {
    for (const roles of Object.values(PERMISSIONS)) {
      for (const role of roles) expect(ROLES).toContain(role);
    }
  });
});
