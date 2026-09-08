/**
 * Rôles et permissions de Poryg'AI.
 *
 * Règle d'or : cette matrice est la SEULE source de vérité.
 *  - Le serveur l'applique (refus 403) via `requirePermission()` — c'est la sécurité.
 *  - Le client l'utilise pour masquer les actions interdites — c'est du confort.
 *
 * Un utilisateur a exactement UN rôle (décision de simplicité, voir docs/roles-et-permissions.md).
 */

export const ROLES = ['ai_officer', 'app_manager', 'dpo', 'auditor', 'standard'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ai_officer: 'AI Officer',
  app_manager: 'Application Manager',
  dpo: 'DPO',
  auditor: 'Auditeur',
  standard: 'Utilisateur standard',
};

const ALL: readonly Role[] = ROLES;

/** Permission → rôles autorisés. Ajouter une ligne ici quand une fonctionnalité apparaît. */
export const PERMISSIONS = {
  // Inventaire
  'application:read': ALL,
  'application:read_all_drafts': ['ai_officer'], // voir les brouillons des autres
  'application:create': ['ai_officer', 'app_manager'],
  'application:update': ['ai_officer', 'app_manager'], // + règle "propriétaire" côté serveur
  'application:delete': ['ai_officer'], // suppression logique uniquement

  // Évaluation éthique (lots 3-4)
  'evaluation:fill': ['ai_officer', 'app_manager'],
  'evaluation:decide': ['ai_officer', 'auditor'],
  'evaluation:dpo_opinion': ['ai_officer', 'dpo'],

  // Plans d'action (lot 4)
  'action_plan:create': ['ai_officer', 'auditor', 'dpo'],
  'action_plan:execute': ['ai_officer', 'app_manager'],

  // FinOps & BI (lots 5-6)
  'finops:read': ['ai_officer', 'app_manager', 'dpo', 'auditor'],
  'dashboard:read': ALL,

  // Administration
  'admin:referentiels': ['ai_officer'],
  'admin:users': ['ai_officer'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** `can('auditor', 'evaluation:decide')` → true */
export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
