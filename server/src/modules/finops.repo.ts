/**
 * Rapport FinOps — phase « Inform » du cycle FinOps : savoir qui dépense quoi.
 *
 * Deux partis pris :
 *  - les applications **supprimées** sont exclues (elles ne tournent plus) ;
 *  - la règle de visibilité des brouillons s'applique comme partout ailleurs, pour
 *    qu'un rapport ne révèle pas l'existence du brouillon d'un autre.
 *
 * Toutes les agrégations sont faites en SQL ; le code ne sert qu'à combler les
 * mois sans dépense et à calculer les parts.
 */
import {
  BUSINESS_DOMAINS, STATUS_LABELS, labelOf, monthKey, shiftMonth,
  type ApplicationCostDto, type AppStatus, type FinopsBreakdownRow,
  type FinopsReportDto, type SaveCostInput, type UserDto,
} from '@poryg/shared';
import type { SQLInputValue } from 'node:sqlite';
import { recordAudit } from '../audit.js';
import { all, one, run, transaction, type Db } from '../db/connection.js';
import { visibilityClause } from './applications.repo.js';

/** Coûts saisis à la main (par opposition au jeu de démonstration ou à un import). */
const MANUAL_SOURCE = 'manuel';

interface Scope {
  sql: string;
  params: SQLInputValue[];
}

/** Périmètre commun à toutes les requêtes du rapport. */
function scopeFor(user: UserDto): Scope {
  const visibility = visibilityClause(user);
  return {
    sql: `a.status <> 'deleted' AND ${visibility.sql}`,
    params: [...visibility.params],
  };
}

function share(amount: number, total: number): number {
  return total > 0 ? amount / total : 0;
}

/** Arrondi au centime : les sommes de flottants produisent sinon des 0.000000001. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildFinopsReport(db: Db, user: UserDto, months: number): FinopsReportDto {
  const scope = scopeFor(user);
  const currentMonth = monthKey(new Date());
  const previousMonth = shiftMonth(currentMonth, -1);
  const firstMonth = shiftMonth(currentMonth, -(months - 1));

  // --- Série mensuelle, mois vides compris ---------------------------------
  const monthlyRows = all<{ month: string; total: number }>(
    db,
    `SELECT c.period_month AS month, SUM(c.amount_eur) AS total
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month >= ? AND c.period_month <= ?
      GROUP BY c.period_month`,
    ...scope.params, firstMonth, currentMonth,
  );
  const byMonth = new Map(monthlyRows.map((row) => [row.month, round2(row.total)]));

  const monthly: FinopsReportDto['monthly'] = [];
  for (let index = 0; index < months; index += 1) {
    const month = shiftMonth(firstMonth, index);
    monthly.push({ month, amountEur: byMonth.get(month) ?? 0 });
  }

  const currentTotal = byMonth.get(currentMonth) ?? 0;
  const previousTotal = byMonth.get(previousMonth) ?? 0;
  const windowTotal = round2(monthly.reduce((sum, entry) => sum + entry.amountEur, 0));
  const variationPct =
    previousTotal > 0 ? round2(((currentTotal - previousTotal) / previousTotal) * 100) : null;

  // --- Répartition par application (mois courant) ---------------------------
  const applicationRows = all<{
    id: number; code: string; name: string; status: AppStatus; total: number;
  }>(
    db,
    `SELECT a.id, a.code, a.name, a.status, SUM(c.amount_eur) AS total
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month = ?
      GROUP BY a.id
      ORDER BY total DESC`,
    ...scope.params, currentMonth,
  );
  const byApplication = applicationRows.map((row) => ({
    key: row.code,
    label: row.name,
    applicationId: row.id,
    code: row.code,
    status: row.status,
    amountEur: round2(row.total),
    share: share(row.total, currentTotal),
    applications: 1,
  }));

  // --- Répartition par domaine métier ---------------------------------------
  const domainRows = all<{ domain: string; total: number; n: number }>(
    db,
    `SELECT a.business_domain AS domain, SUM(c.amount_eur) AS total, COUNT(DISTINCT a.id) AS n
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month = ?
      GROUP BY a.business_domain
      ORDER BY total DESC`,
    ...scope.params, currentMonth,
  );
  const byDomain: FinopsBreakdownRow[] = domainRows.map((row) => ({
    key: row.domain,
    label: labelOf(BUSINESS_DOMAINS, row.domain),
    amountEur: round2(row.total),
    share: share(row.total, currentTotal),
    applications: row.n,
  }));

  // --- Répartition par statut de conformité ---------------------------------
  // C'est le croisement qui parle à une direction : combien coûte le non-conforme.
  const statusRows = all<{ status: AppStatus; total: number; n: number }>(
    db,
    `SELECT a.status, SUM(c.amount_eur) AS total, COUNT(DISTINCT a.id) AS n
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month = ?
      GROUP BY a.status
      ORDER BY total DESC`,
    ...scope.params, currentMonth,
  );
  const byStatus: FinopsBreakdownRow[] = statusRows.map((row) => ({
    key: row.status,
    label: STATUS_LABELS[row.status],
    amountEur: round2(row.total),
    share: share(row.total, currentTotal),
    applications: row.n,
  }));

  // --- Couverture : sans coût saisi, le rapport est incomplet ---------------
  const missing = all<{ id: number; code: string; name: string }>(
    db,
    `SELECT a.id, a.code, a.name
       FROM applications a
      WHERE ${scope.sql} AND a.status <> 'draft'
        AND NOT EXISTS (
          SELECT 1 FROM finops_costs c WHERE c.application_id = a.id AND c.period_month = ?
        )
      ORDER BY a.name`,
    ...scope.params, currentMonth,
  );
  const activeTotal = one<{ n: number }>(
    db, `SELECT COUNT(*) AS n FROM applications a WHERE ${scope.sql} AND a.status <> 'draft'`, ...scope.params,
  )!.n;

  return {
    currentMonth,
    currentTotal,
    previousMonth,
    previousTotal,
    variationPct,
    windowTotal,
    monthly,
    byApplication,
    byDomain,
    byStatus,
    coverage: { withCost: activeTotal - missing.length, total: activeTotal, missing },
  };
}

// --- Saisie des coûts -------------------------------------------------------

interface CostRow {
  id: number;
  application_id: number;
  period_month: string;
  amount_eur: number;
  source: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

const SELECT_COST = `
  SELECT c.*, u.display_name AS created_by_name
    FROM finops_costs c LEFT JOIN users u ON u.id = c.created_by
`;

function toDto(row: CostRow): ApplicationCostDto {
  return {
    id: row.id,
    applicationId: row.application_id,
    periodMonth: row.period_month,
    amountEur: row.amount_eur,
    source: row.source,
    createdBy: row.created_by && row.created_by_name
      ? { id: row.created_by, displayName: row.created_by_name }
      : null,
    createdAt: row.created_at,
  };
}

/** Coûts d'une application, du mois le plus récent au plus ancien. */
export function listApplicationCosts(db: Db, applicationId: number): ApplicationCostDto[] {
  return all<CostRow>(
    db, `${SELECT_COST} WHERE c.application_id = ? ORDER BY c.period_month DESC, c.source`, applicationId,
  ).map(toDto);
}

/**
 * Enregistre le coût d'un mois. La contrainte UNIQUE (application, mois, source)
 * garantit une seule saisie manuelle par mois : une nouvelle valeur remplace
 * l'ancienne, et le remplacement est tracé dans le journal d'audit.
 */
export function saveCost(
  db: Db, applicationId: number, input: SaveCostInput, actor: UserDto, ip?: string,
): ApplicationCostDto {
  return transaction(db, () => {
    const existing = one<CostRow>(
      db,
      `${SELECT_COST} WHERE c.application_id = ? AND c.period_month = ? AND c.source = ?`,
      applicationId, input.periodMonth, MANUAL_SOURCE,
    );

    run(
      db,
      `INSERT INTO finops_costs (application_id, period_month, amount_eur, source, created_by)
            VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (application_id, period_month, source)
       DO UPDATE SET amount_eur = excluded.amount_eur, created_by = excluded.created_by`,
      applicationId, input.periodMonth, input.amountEur, MANUAL_SOURCE, actor.id,
    );

    const saved = one<CostRow>(
      db,
      `${SELECT_COST} WHERE c.application_id = ? AND c.period_month = ? AND c.source = ?`,
      applicationId, input.periodMonth, MANUAL_SOURCE,
    )!;

    recordAudit(db, {
      actorId: actor.id,
      entity: 'finops_cost',
      entityId: saved.id,
      action: existing ? 'cost_updated' : 'cost_added',
      before: existing ? { periodMonth: existing.period_month, amountEur: existing.amount_eur } : undefined,
      after: { applicationId, periodMonth: input.periodMonth, amountEur: input.amountEur },
      ip,
    });

    return toDto(saved);
  });
}
