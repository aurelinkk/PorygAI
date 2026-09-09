/**
 * Tableaux de bord BI — historique et utilisation du parc d'applications IA.
 *
 * Le rapport FinOps répond « combien ça coûte » ; celui-ci répond « où en est le
 * parc, comment il évolue, et où ça coince ». Trois partis pris repris du FinOps :
 *
 *  - les agrégations sont faites en SQL, le code ne sert qu'à combler les mois
 *    vides et à calculer les parts ;
 *  - la visibilité des brouillons s'applique partout, pour qu'un tableau de bord
 *    ne révèle pas l'existence du brouillon d'un autre ;
 *  - le coût n'est calculé que si l'utilisateur a `finops:read` — on ne renvoie
 *    pas une donnée pour la masquer ensuite côté client.
 *
 * Les sous-scores par thème sont relus depuis `evaluations.sections_json`, écrit
 * à la soumission : c'est le résultat qui a fait foi ce jour-là, pas un recalcul
 * avec le questionnaire d'aujourd'hui.
 */
import {
  AI_TYPES, AUDIT_ACTION_LABELS, BUSINESS_DOMAINS, DATA_SENSITIVITIES, STATUS_LABELS,
  can, getQuestion, monthKey, questionWording, shiftMonth,
  type BiCountRow, type BiHistoryRow, type BiReportDto, type SectionScore, type UserDto,
} from '@poryg/shared';
import type { SQLInputValue } from 'node:sqlite';
import { all, one, type Db } from '../db/connection.js';
import { visibilityClause } from './applications.repo.js';

/** Horizon d'alerte sur les échéances de conformité, en jours. */
const EXPIRY_HORIZON_DAYS = 90;
/** Nombre de lignes gardées dans les classements (thèmes faibles, questions manquées). */
const TOP_ROWS = 5;

interface Scope {
  sql: string;
  params: SQLInputValue[];
}

/** Périmètre visible par l'utilisateur, applications supprimées comprises. */
function scopeFor(user: UserDto): Scope {
  const visibility = visibilityClause(user);
  return { sql: visibility.sql, params: [...visibility.params] };
}

/** Idem, mais limité au parc vivant : un tableau de bord décrit ce qui tourne. */
function activeScopeFor(user: UserDto): Scope {
  const scope = scopeFor(user);
  return { sql: `a.status <> 'deleted' AND ${scope.sql}`, params: scope.params };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Répartition ordonnée d'après un référentiel, et non d'après les données : les
 * catégories vides restent visibles (« aucune application sensible » est une
 * information), et l'ordre ne change pas d'un mois à l'autre.
 */
function countRows(
  counts: Map<string, number>,
  order: readonly { code: string; label: string }[],
): BiCountRow[] {
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return order.map(({ code, label }) => {
    const count = counts.get(code) ?? 0;
    return { key: code, label, count, share: total > 0 ? count / total : 0 };
  });
}

function countsOf(db: Db, column: string, scope: Scope): Map<string, number> {
  const rows = all<{ key: string; n: number }>(
    db,
    `SELECT ${column} AS key, COUNT(*) AS n FROM applications a WHERE ${scope.sql} GROUP BY ${column}`,
    ...scope.params,
  );
  return new Map(rows.map((row) => [row.key, row.n]));
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

export function buildBiReport(db: Db, user: UserDto, months: number): BiReportDto {
  const scope = scopeFor(user);
  const active = activeScopeFor(user);
  const currentMonth = monthKey(new Date());
  const firstMonth = shiftMonth(currentMonth, -(months - 1));
  // Borne haute des comparaisons de dates ISO : '2026-04' < '2026-04-01T…' < '2026-05'.
  const firstDay = `${firstMonth}-01`;

  // --- Parc actuel ---------------------------------------------------------
  const statusCounts = countsOf(db, 'a.status', active);
  const total = [...statusCounts.values()].reduce((sum, n) => sum + n, 0);
  const decided = (['compliant', 'partially_compliant', 'non_compliant'] as const).reduce(
    (sum, status) => sum + (statusCounts.get(status) ?? 0),
    0,
  );

  const portfolio: BiReportDto['portfolio'] = {
    total,
    complianceRate: decided > 0 ? round2((statusCounts.get('compliant') ?? 0) / decided) : null,
    // Le statut `deleted` n'existe pas dans ce périmètre : inutile de l'afficher.
    byStatus: countRows(
      statusCounts,
      Object.entries(STATUS_LABELS)
        .filter(([code]) => code !== 'deleted')
        .map(([code, label]) => ({ code, label })),
    ),
    byDomain: countRows(countsOf(db, 'a.business_domain', active), BUSINESS_DOMAINS),
    bySensitivity: countRows(countsOf(db, 'a.data_sensitivity', active), DATA_SENSITIVITIES),
    byAiType: countRows(countsOf(db, 'a.ai_type', active), AI_TYPES),
  };

  // --- Historique mensuel --------------------------------------------------
  // Deux requêtes plutôt qu'une jointure : une application peut être déclarée un
  // mois et évaluée un autre, les deux séries n'ont pas la même clé.
  const declaredRows = all<{ month: string; n: number }>(
    db,
    `SELECT substr(a.created_at, 1, 7) AS month, COUNT(*) AS n
       FROM applications a
      WHERE ${scope.sql} AND a.created_at >= ?
      GROUP BY month`,
    ...scope.params, firstDay,
  );
  const declaredByMonth = new Map(declaredRows.map((row) => [row.month, row.n]));

  const verdictRows = all<{ month: string; verdict: string | null; n: number }>(
    db,
    `SELECT substr(e.submitted_at, 1, 7) AS month, e.verdict AS verdict, COUNT(*) AS n
       FROM evaluations e JOIN applications a ON a.id = e.application_id
      WHERE ${scope.sql} AND e.status = 'submitted' AND e.submitted_at >= ?
      GROUP BY month, verdict`,
    ...scope.params, firstDay,
  );
  const verdictsByMonth = new Map<string, Map<string, number>>();
  for (const row of verdictRows) {
    const bucket = verdictsByMonth.get(row.month) ?? new Map<string, number>();
    bucket.set(row.verdict ?? 'unknown', row.n);
    verdictsByMonth.set(row.month, bucket);
  }

  const history: BiHistoryRow[] = [];
  for (let index = 0; index < months; index += 1) {
    const month = shiftMonth(firstMonth, index);
    const verdicts = verdictsByMonth.get(month) ?? new Map<string, number>();
    const at = (verdict: string) => verdicts.get(verdict) ?? 0;
    history.push({
      month,
      declared: declaredByMonth.get(month) ?? 0,
      submitted: [...verdicts.values()].reduce((sum, n) => sum + n, 0),
      compliant: at('compliant'),
      partiallyCompliant: at('partially_compliant'),
      // Une évaluation refusée (blocage) est une non-conformité : elle se compte ici.
      nonCompliant: at('non_compliant') + at('blocked'),
    });
  }

  // --- Qualité des évaluations soumises sur la fenêtre ----------------------
  const submittedRows = all<{ id: number; score: number | null; sections: string }>(
    db,
    `SELECT e.id AS id, e.score AS score, e.sections_json AS sections
       FROM evaluations e JOIN applications a ON a.id = e.application_id
      WHERE ${scope.sql} AND e.status = 'submitted' AND e.submitted_at >= ?`,
    ...scope.params, firstDay,
  );
  const scored = submittedRows.filter((row) => row.score !== null);

  // Moyenne des sous-scores par thème, sur les évaluations où le thème s'appliquait.
  const perSection = new Map<string, { label: string; sum: number; n: number }>();
  for (const row of submittedRows) {
    let sections: SectionScore[] = [];
    try {
      sections = JSON.parse(row.sections) as SectionScore[];
    } catch {
      continue; // évaluation v1 ou colonne vide : elle ne porte pas de sous-scores
    }
    for (const section of sections) {
      if (section.score === null) continue;
      const bucket = perSection.get(section.code) ?? { label: section.label, sum: 0, n: 0 };
      bucket.sum += section.score;
      bucket.n += 1;
      perSection.set(section.code, bucket);
    }
  }

  const weakestSections = [...perSection.entries()]
    .map(([code, bucket]) => ({
      code,
      label: bucket.label,
      averageScore: Math.round(bucket.sum / bucket.n),
      evaluations: bucket.n,
    }))
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, TOP_ROWS);

  // Questions manquées : réponse dont l'option vaut 0 point. On relit la définition
  // du questionnaire plutôt que de supposer que « 0 » est toujours la valeur basse.
  const answerRows = all<{ code: string; value: string; n: number }>(
    db,
    `SELECT ans.question_code AS code, ans.value_json AS value, COUNT(*) AS n
       FROM evaluation_answers ans
       JOIN evaluations e ON e.id = ans.evaluation_id
       JOIN applications a ON a.id = e.application_id
      WHERE ${scope.sql} AND e.status = 'submitted' AND e.submitted_at >= ?
      GROUP BY ans.question_code, ans.value_json`,
    ...scope.params, firstDay,
  );
  const missedByQuestion = new Map<string, number>();
  for (const row of answerRows) {
    const question = getQuestion(row.code);
    if (!question?.weight) continue;
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }
    const option = question.options?.find((candidate) => candidate.value === String(value));
    if (option?.score !== 0) continue;
    missedByQuestion.set(row.code, (missedByQuestion.get(row.code) ?? 0) + row.n);
  }

  const topGaps = [...missedByQuestion.entries()]
    .map(([code, missed]) => ({
      code,
      section: getQuestion(code)?.section ?? '',
      wording: questionWording(code),
      missed,
    }))
    .sort((a, b) => b.missed - a.missed || a.code.localeCompare(b.code))
    .slice(0, TOP_ROWS);

  const quality: BiReportDto['quality'] = {
    submitted: submittedRows.length,
    averageScore:
      scored.length > 0 ? Math.round(scored.reduce((sum, row) => sum + row.score!, 0) / scored.length) : null,
    weakestSections,
    topGaps,
  };

  // --- Plans d'action ------------------------------------------------------
  const actionRow = one<{ open: number; done: number; overdue: number }>(
    db,
    `SELECT
        SUM(CASE WHEN p.status = 'open' THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN p.status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN p.status = 'open' AND p.due_date IS NOT NULL AND p.due_date < date('now')
                 THEN 1 ELSE 0 END) AS overdue
       FROM action_plans p JOIN applications a ON a.id = p.application_id
      WHERE ${active.sql}`,
    ...active.params,
  );
  const actions: BiReportDto['actions'] = {
    open: actionRow?.open ?? 0,
    done: actionRow?.done ?? 0,
    overdue: actionRow?.overdue ?? 0,
  };

  // --- Échéances de conformité ---------------------------------------------
  const expiringRows = all<{ id: number; code: string; name: string; valid_until: string }>(
    db,
    `SELECT a.id AS id, a.code AS code, a.name AS name, a.compliance_valid_until AS valid_until
       FROM applications a
      WHERE ${active.sql} AND a.status = 'compliant' AND a.compliance_valid_until IS NOT NULL
        AND a.compliance_valid_until <= datetime('now', ?)
      ORDER BY a.compliance_valid_until`,
    ...active.params, `+${EXPIRY_HORIZON_DAYS} days`,
  );
  const nowMs = Date.now();
  const expired = one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM audit_log l
       JOIN applications a ON CAST(a.id AS TEXT) = l.entity_id
      WHERE ${scope.sql} AND l.entity = 'application' AND l.action = 'compliance_expired' AND l.at >= ?`,
    ...scope.params, firstDay,
  );

  const compliance: BiReportDto['compliance'] = {
    expiringSoon: expiringRows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      validUntil: row.valid_until,
      daysLeft: Math.ceil((new Date(row.valid_until).getTime() - nowMs) / 86_400_000),
    })),
    expired: expired?.n ?? 0,
  };

  // --- Activité de la plateforme -------------------------------------------
  const activityRows = all<{ month: string; n: number }>(
    db,
    `SELECT substr(l.at, 1, 7) AS month, COUNT(*) AS n
       FROM audit_log l JOIN applications a ON CAST(a.id AS TEXT) = l.entity_id
      WHERE ${scope.sql} AND l.entity = 'application' AND l.at >= ?
      GROUP BY month`,
    ...scope.params, firstDay,
  );
  const eventsByMonth = new Map(activityRows.map((row) => [row.month, row.n]));

  const actionRows = all<{ key: string; n: number }>(
    db,
    `SELECT l.action AS key, COUNT(*) AS n
       FROM audit_log l JOIN applications a ON CAST(a.id AS TEXT) = l.entity_id
      WHERE ${scope.sql} AND l.entity = 'application' AND l.at >= ?
      GROUP BY l.action
      ORDER BY n DESC`,
    ...scope.params, firstDay,
  );
  const eventTotal = actionRows.reduce((sum, row) => sum + row.n, 0);

  const activeUsers = one<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT l.actor_id) AS n
       FROM audit_log l JOIN applications a ON CAST(a.id AS TEXT) = l.entity_id
      WHERE ${scope.sql} AND l.entity = 'application' AND l.at >= ? AND l.actor_id IS NOT NULL`,
    ...scope.params, firstDay,
  );

  const activity: BiReportDto['activity'] = {
    byMonth: Array.from({ length: months }, (_, index) => {
      const month = shiftMonth(firstMonth, index);
      return { month, events: eventsByMonth.get(month) ?? 0 };
    }),
    byAction: actionRows.map((row) => ({
      key: row.key,
      label: AUDIT_ACTION_LABELS[row.key] ?? row.key,
      count: row.n,
      share: eventTotal > 0 ? row.n / eventTotal : 0,
    })),
    activeUsers: activeUsers?.n ?? 0,
  };

  // --- Coût du mois, seulement pour qui y a droit ---------------------------
  let monthlyCostEur: number | null = null;
  if (can(user.role, 'finops:read')) {
    const cost = one<{ total: number | null }>(
      db,
      `SELECT SUM(c.amount_eur) AS total
         FROM finops_costs c JOIN applications a ON a.id = c.application_id
        WHERE ${active.sql} AND c.period_month = ?`,
      ...active.params, currentMonth,
    );
    monthlyCostEur = round2(cost?.total ?? 0);
  }

  return { months, currentMonth, portfolio, history, quality, actions, compliance, activity, monthlyCostEur };
}

