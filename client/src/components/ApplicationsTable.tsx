/**
 * Tableau d'applications, triable (colonnes de la charte : APPLICATION ·
 * DOMAINE · STATUT, plus la date de dernière modification).
 *
 * Le tri est fait dans le navigateur : les listes affichées sont courtes
 * (8 sur l'accueil, 200 au maximum dans l'inventaire), donc c'est instantané et
 * cela évite un aller-retour serveur. Si l'inventaire devait dépasser quelques
 * centaines de lignes, il faudrait trier en SQL et paginer.
 *
 * Accessibilité : chaque en-tête triable est un vrai <button> dans un <th>, et
 * le <th> porte `aria-sort` — c'est ce que les lecteurs d'écran annoncent. La
 * flèche n'est qu'un renfort visuel (aria-hidden).
 *
 * Une application supprimée reste affichée, grisée et barrée, avec « par qui / quand ».
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AI_TYPES, APP_STATUSES, BUSINESS_DOMAINS, labelOf, type ApplicationDto } from '@poryg/shared';
import { cx, formatDate, formatDateTime, formatMonthYear } from '../lib/format';
import { StatusPill } from './ui/Badges';

type SortKey = 'name' | 'businessDomain' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

interface Column {
  key: SortKey;
  label: string;
  /** Sens appliqué au premier clic : alphabétique croissant, mais dates du plus récent au plus ancien. */
  defaultDirection: SortDirection;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Application', defaultDirection: 'asc' },
  { key: 'businessDomain', label: 'Domaine', defaultDirection: 'asc' },
  { key: 'status', label: 'Statut', defaultDirection: 'asc' },
  // Libellé court : « Dernière modification » passe sur deux lignes dans la carte de l'accueil.
  { key: 'updatedAt', label: 'Modifiée le', defaultDirection: 'desc' },
];

/** Compare deux applications sur une colonne, toujours en ordre croissant. */
function compare(a: ApplicationDto, b: ApplicationDto, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    case 'businessDomain':
      return labelOf(BUSINESS_DOMAINS, a.businessDomain).localeCompare(
        labelOf(BUSINESS_DOMAINS, b.businessDomain), 'fr', { sensitivity: 'base' },
      );
    case 'status':
      // Ordre du cycle de vie (draft → … → deleted), plus parlant qu'un tri alphabétique.
      return APP_STATUSES.indexOf(a.status) - APP_STATUSES.indexOf(b.status);
    case 'updatedAt':
      // Dates ISO 8601 : l'ordre lexicographique est l'ordre chronologique.
      return a.updatedAt.localeCompare(b.updatedAt);
  }
}

interface ApplicationsTableProps {
  applications: ApplicationDto[];
  /** id du titre qui nomme le tableau (aria-labelledby) */
  labelledBy: string;
}

export function ApplicationsTable({ applications, labelledBy }: ApplicationsTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'updatedAt',
    direction: 'desc',
  });

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    // Copie : on ne réordonne jamais le tableau reçu en props.
    return [...applications].sort((a, b) => compare(a, b, sort.key) * factor);
  }, [applications, sort]);

  function toggle(column: Column) {
    setSort((current) =>
      current.key === column.key
        ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, direction: column.defaultDirection },
    );
  }

  if (applications.length === 0) {
    return <p className="muted">Aucune application à afficher.</p>;
  }

  return (
    <div
      className="table-wrap"
      // Rend le défilement horizontal atteignable au clavier (WCAG 2.1.1).
      // `group` et non `region` : la carte parente est déjà un landmark portant
      // ce même titre, deux landmarks homonymes seraient une erreur.
      tabIndex={0}
      role="group"
      aria-labelledby={labelledBy}
    >
      <table className="table" aria-labelledby={labelledBy}>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const isActive = sort.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className={cx('table__sort', isActive && 'table__sort--active')}
                    onClick={() => toggle(column)}
                  >
                    {column.label}
                    <span className="table__sort-icon" aria-hidden="true">
                      {isActive ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((app) => (
            <tr key={app.id} className={cx(app.status === 'deleted' && 'is-deleted')}>
              <th scope="row">
                <Link to={`/applications/${app.id}`} className="table__name">
                  {app.name}
                </Link>
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
              <td>
                {/* <time> porte la date lisible par une machine ; l'affichage reste en français. */}
                <time dateTime={app.updatedAt} className="mono table__date">
                  {formatDateTime(app.updatedAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
