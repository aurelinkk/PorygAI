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
  'application:update': ['ai_officer', 'app_manager'], // + règle "propriétaire" (canEditApplication)
  'application:update_any': ['ai_officer'], // modifier même sans en être propriétaire
  'application:submit': ['ai_officer', 'app_manager'], // envoyer un brouillon à l'audit
  'application:delete': ['ai_officer'], // suppression logique uniquement
  'application:restore': ['ai_officer'],
  'application:history': ['ai_officer', 'app_manager', 'dpo', 'auditor'],

  // Évaluation éthique
  'evaluation:read': ['ai_officer', 'app_manager', 'dpo', 'auditor'],
  'evaluation:fill': ['ai_officer', 'app_manager', 'auditor'], // saisir / enregistrer un brouillon
  'evaluation:decide': ['ai_officer', 'auditor'], // soumettre : déclenche le verdict automatique
  'evaluation:dpo_opinion': ['ai_officer', 'dpo'],

  // Plans d'action (lot 4)
  'action_plan:create': ['ai_officer', 'auditor', 'dpo'],
  'action_plan:execute': ['ai_officer', 'app_manager'],

  // FinOps & BI
  'finops:read': ['ai_officer', 'app_manager', 'dpo', 'auditor'],
  'finops:write': ['ai_officer', 'app_manager'], // + règle « propriétaire » pour l'Application Manager
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

/** Ce qu'il faut savoir d'une application pour décider qui peut agir dessus. */
export interface ApplicationSubject {
  status: string;
  processOwner: { id: number };
  createdBy: { id: number } | null;
}

/** L'utilisateur est-il « propriétaire » de cette application ? */
export function ownsApplication(user: { id: number }, application: ApplicationSubject): boolean {
  return application.processOwner.id === user.id || application.createdBy?.id === user.id;
}

/**
 * Modification : il faut la permission de base, ne pas viser une application
 * supprimée, et — sauf pour les rôles ayant `application:update_any` — en être
 * propriétaire (Process Owner ou déclarant).
 *
 * Vérifié côté serveur (sécurité) et côté client (masquage des actions).
 */
export function canEditApplication(user: { id: number; role: Role }, application: ApplicationSubject): boolean {
  if (application.status === 'deleted') return false;
  if (!can(user.role, 'application:update')) return false;
  if (can(user.role, 'application:update_any')) return true;
  return ownsApplication(user, application);
}

/** Saisie d'un coût : l'AI Officer sur toute application, le manager sur les siennes. */
export function canEditCosts(user: { id: number; role: Role }, application: ApplicationSubject): boolean {
  if (application.status === 'deleted') return false;
  if (!can(user.role, 'finops:write')) return false;
  if (can(user.role, 'application:update_any')) return true;
  return ownsApplication(user, application);
}

/** Envoi à l'audit : uniquement depuis le statut Draft, par un propriétaire (ou l'AI Officer). */
export function canSubmitApplication(user: { id: number; role: Role }, application: ApplicationSubject): boolean {
  if (application.status !== 'draft') return false;
  if (!can(user.role, 'application:submit')) return false;
  if (can(user.role, 'application:update_any')) return true;
  return ownsApplication(user, application);
}
