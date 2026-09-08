/**
 * Badges de rôle et pastilles de statut, couleurs de la charte.
 * Le statut n'est jamais porté par la couleur seule : la pastille est
 * décorative (aria-hidden) et le libellé est toujours affiché.
 */
import { ROLE_LABELS, STATUS_LABELS, type AppStatus, type Role } from '@poryg/shared';

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`role-badge role-badge--${role}`}>{ROLE_LABELS[role]}</span>;
}

export function StatusPill({ status }: { status: AppStatus }) {
  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
