/**
 * Tableau d'applications (colonnes de la charte : APPLICATION · DOMAINE · STATUT).
 * Une application supprimée reste affichée, grisée et barrée, avec "par qui / quand".
 */
import { AI_TYPES, BUSINESS_DOMAINS, labelOf, type ApplicationDto } from '@poryg/shared';
import { cx, formatDate, formatMonthYear } from '../lib/format';
import { StatusPill } from './ui/Badges';

interface ApplicationsTableProps {
  applications: ApplicationDto[];
  /** id du titre qui nomme le tableau (aria-labelledby) */
  labelledBy: string;
}

export function ApplicationsTable({ applications, labelledBy }: ApplicationsTableProps) {
  if (applications.length === 0) {
    return <p className="muted">Aucune application à afficher.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="table" aria-labelledby={labelledBy}>
        <thead>
          <tr>
            <th scope="col">Application</th>
            <th scope="col">Domaine</th>
            <th scope="col">Statut</th>
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => (
            <tr key={app.id} className={cx(app.status === 'deleted' && 'is-deleted')}>
              <th scope="row">
                <span className="table__name">{app.name}</span>
                <span className="table__meta mono">
                  {app.code} · {labelOf(AI_TYPES, app.aiType)}
                </span>
              </th>
              <td>{labelOf(BUSINESS_DOMAINS, app.businessDomain)}</td>
              <td>
                <StatusPill status={app.status} />
                {app.status === 'compliant' && app.complianceValidUntil && (
                  <span className="table__meta mono">expire {formatMonthYear(app.complianceValidUntil)}</span>
                )}
                {app.status === 'deleted' && app.deletedAt && (
                  <span className="table__meta mono">
                    {app.deletedBy ? `par ${app.deletedBy.displayName} · ` : ''}
                    {formatDate(app.deletedAt)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
