/**
 * Rapport FinOps responsable : savoir qui dépense quoi, consomme quoi, émet quoi.
 *
 * Le FinOps classique optimise une facture. Appliqué à l'IA responsable, il suit
 * **trois grandeurs à la fois** : le coût en euros, l'énergie en kWh et
 * l'empreinte en kg CO₂ : parce qu'un arbitrage entre un modèle massif et un
 * modèle frugal ne se tranche pas sur le seul montant. Le rapport reprend les
 * trois principes du FinOps (`FINOPS_PRINCIPLES` de @poryg/shared) :
 *
 *  - **Visibilité** : la couverture de la donnée : qui a saisi son coût, et qui a
 *    déclaré son empreinte. Ce qui n'est pas mesuré ne peut pas être arbitré.
 *  - **Responsabilité** : chaque ligne est rattachée à une application et à son
 *    Process Owner ; la répartition par statut montre ce que coûte le non conforme.
 *  - **Optimisation continue** : les leviers (`levers`) ne sont proposés que
 *    lorsque les données les justifient, avec les applications concernées.
 *
 * Deux partis pris inchangés :
 *  - les applications **supprimées** sont exclues (elles ne tournent plus) ;
 *  - la règle de visibilité des brouillons s'applique comme partout ailleurs, pour
 *    qu'un rapport ne révèle pas l'existence du brouillon d'un autre.
 *
 * Toutes les agrégations sont faites en SQL ; le code ne sert qu'à combler les
 * mois sans dépense, à calculer les parts et à croiser avec le questionnaire.
 */
import {
  BUSINESS_DOMAINS, STATUS_LABELS, labelOf, monthKey, shiftMonth,
  type ApplicationCostDto, type ApplicationFinopsDto, type AppStatus, type FinopsBreakdownRow,
  estimateCo2,
  hostingIntensity,
  type FinopsImpactDto, type FinopsLeverDto, type FinopsReportDto, type FinopsTotals,
  type SaveCostInput, type SectionScore, type UserDto,
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

/** Les trois colonnes agrégées, écrites une fois pour toutes les requêtes. */
const SUMS = 'SUM(c.amount_eur) AS total, SUM(c.energy_kwh) AS kwh, SUM(c.co2_kg) AS co2';

interface SumRow {
  total: number | null;
  kwh: number | null;
  co2: number | null;
}

const totalsOf = (row: SumRow | undefined): FinopsTotals => ({
  amountEur: round2(row?.total ?? 0),
  energyKwh: round2(row?.kwh ?? 0),
  co2Kg: round2(row?.co2 ?? 0),
});

/** Nombre de lignes de code économisé : une répartition se construit toujours pareil. */
function breakdown(
  rows: (SumRow & { key: string; label: string; n?: number })[],
  currentTotal: number,
): FinopsBreakdownRow[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    ...totalsOf(row),
    share: share(row.total ?? 0, currentTotal),
    applications: row.n ?? 1,
  }));
}

/**
 * Sous-score du thème « Frugalité et FinOps » (F) de la dernière évaluation
 * soumise, par application.
 *
 * Il est relu depuis `sections_json`, écrit à la soumission : c'est la note qui a
 * fait foi ce jour-là, pas un recalcul avec le questionnaire d'aujourd'hui.
 */
function frugalityScores(db: Db, scope: Scope): Map<number, number> {
  const rows = all<{ application_id: number; sections: string }>(
    db,
    `SELECT e.application_id, e.sections_json AS sections
       FROM evaluations e JOIN applications a ON a.id = e.application_id
      WHERE ${scope.sql} AND e.status = 'submitted'
      ORDER BY e.submitted_at`,
    ...scope.params,
  );
  // Ordre croissant : la dernière évaluation lue écrase les précédentes.
  const scores = new Map<number, number>();
  for (const row of rows) {
    let sections: SectionScore[] = [];
    try {
      sections = JSON.parse(row.sections) as SectionScore[];
    } catch {
      continue; // évaluation v1 : pas de sous-scores par thème
    }
    const frugality = sections.find((section) => section.code === 'F');
    if (frugality?.score !== null && frugality?.score !== undefined) {
      scores.set(row.application_id, frugality.score);
    }
  }
  return scores;
}

export function buildFinopsReport(db: Db, user: UserDto, months: number): FinopsReportDto {
  const scope = scopeFor(user);
  const currentMonth = monthKey(new Date());
  const previousMonth = shiftMonth(currentMonth, -1);
  const firstMonth = shiftMonth(currentMonth, -(months - 1));

  // --- Série mensuelle, mois vides compris ---------------------------------
  const monthlyRows = all<SumRow & { month: string }>(
    db,
    `SELECT c.period_month AS month, ${SUMS}
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month >= ? AND c.period_month <= ?
      GROUP BY c.period_month`,
    ...scope.params, firstMonth, currentMonth,
  );
  const byMonth = new Map(monthlyRows.map((row) => [row.month, totalsOf(row)]));
  const zero: FinopsTotals = { amountEur: 0, energyKwh: 0, co2Kg: 0 };

  const monthly: FinopsReportDto['monthly'] = [];
  for (let index = 0; index < months; index += 1) {
    const month = shiftMonth(firstMonth, index);
    monthly.push({ month, ...(byMonth.get(month) ?? zero) });
  }

  const current = byMonth.get(currentMonth) ?? zero;
  const currentTotal = current.amountEur;
  const previousTotal = (byMonth.get(previousMonth) ?? zero).amountEur;
  const windowTotals: FinopsTotals = {
    amountEur: round2(monthly.reduce((sum, entry) => sum + entry.amountEur, 0)),
    energyKwh: round2(monthly.reduce((sum, entry) => sum + entry.energyKwh, 0)),
    co2Kg: round2(monthly.reduce((sum, entry) => sum + entry.co2Kg, 0)),
  };
  const windowTotal = windowTotals.amountEur;
  const variationPct =
    previousTotal > 0 ? round2(((currentTotal - previousTotal) / previousTotal) * 100) : null;

  // --- Répartition par application (mois courant) ---------------------------
  const applicationRows = all<SumRow & {
    id: number; code: string; name: string; status: AppStatus;
  }>(
    db,
    `SELECT a.id, a.code, a.name, a.status, ${SUMS}
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
    ...totalsOf(row),
    share: share(row.total ?? 0, currentTotal),
    applications: 1,
  }));

  // --- Répartition par domaine métier ---------------------------------------
  const domainRows = all<SumRow & { domain: string; n: number }>(
    db,
    `SELECT a.business_domain AS domain, ${SUMS}, COUNT(DISTINCT a.id) AS n
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month = ?
      GROUP BY a.business_domain
      ORDER BY total DESC`,
    ...scope.params, currentMonth,
  );
  const byDomain = breakdown(
    domainRows.map((row) => ({ ...row, key: row.domain, label: labelOf(BUSINESS_DOMAINS, row.domain) })),
    currentTotal,
  );

  // --- Répartition par statut de conformité ---------------------------------
  // C'est le croisement qui parle à une direction : combien coûte le non-conforme.
  const statusRows = all<SumRow & { status: AppStatus; n: number }>(
    db,
    `SELECT a.status, ${SUMS}, COUNT(DISTINCT a.id) AS n
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month = ?
      GROUP BY a.status
      ORDER BY total DESC`,
    ...scope.params, currentMonth,
  );
  const byStatus = breakdown(
    statusRows.map((row) => ({ ...row, key: row.status, label: STATUS_LABELS[row.status] })),
    currentTotal,
  );

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

  // Déclarer une empreinte n'est pas encore un réflexe : on la compte à part.
  const withFootprint = one<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT c.application_id) AS n
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month = ? AND c.energy_kwh > 0`,
    ...scope.params, currentMonth,
  )!.n;

  // --- Frugalité : ce que le questionnaire dit de ces mêmes applications ----
  const scores = frugalityScores(db, scope);
  const evaluated = scores.size;
  const averageScore = evaluated > 0
    ? Math.round([...scores.values()].reduce((sum, value) => sum + value, 0) / evaluated)
    : null;

  // Le croisement qui décide d'un arbitrage : cher ET mal noté en frugalité.
  const worstOffenders = byApplication
    .filter((row) => scores.has(row.applicationId) && scores.get(row.applicationId)! < 100 && row.amountEur > 0)
    .map((row) => ({
      id: row.applicationId,
      code: row.code,
      name: row.label,
      amountEur: row.amountEur,
      frugalityScore: scores.get(row.applicationId)!,
    }))
    .sort((a, b) => a.frugalityScore - b.frugalityScore || b.amountEur - a.amountEur)
    .slice(0, 5);

  return {
    currentMonth,
    currentTotal,
    previousMonth,
    previousTotal,
    variationPct,
    windowTotal,
    current,
    window: windowTotals,
    monthly,
    byApplication,
    byDomain,
    byStatus,
    coverage: { withCost: activeTotal - missing.length, withFootprint, total: activeTotal, missing },
    frugality: { averageScore, evaluated, worstOffenders },
    levers: buildLevers(db, scope, byApplication, missing),
  };
}

/**
 * Leviers d'optimisation, déduits des données : jamais affichés « dans le vide ».
 *
 * Deux sources :
 *  - la **couverture** de la saisie (un coût manquant, une empreinte non déclarée) ;
 *  - les **réponses au questionnaire** sur la frugalité (N2 : modèle proportionné,
 *    F3 : région d'hébergement, F4/F5 : optimisations et volume d'appels).
 *
 * Une réponse en dessous du maximum vaut levier : c'est exactement ce que le
 * plan d'action de l'évaluation demande de corriger, vu ici sous l'angle du coût.
 */
function buildLevers(
  db: Db,
  scope: Scope,
  byApplication: FinopsReportDto['byApplication'],
  missing: { id: number; code: string; name: string }[],
): FinopsLeverDto[] {
  const costOf = new Map(byApplication.map((row) => [row.applicationId, row.amountEur]));
  const identity = new Map(byApplication.map((row) => [row.applicationId, { code: row.code, name: row.label }]));
  const leviers = new Map<string, FinopsLeverDto['applications']>();
  const ajouter = (code: string, app: { id: number; code: string; name: string }, reason: string) => {
    const liste = leviers.get(code) ?? [];
    if (liste.some((entry) => entry.id === app.id)) return;
    liste.push({ ...app, amountEur: costOf.get(app.id) ?? 0, reason });
    leviers.set(code, liste);
  };

  for (const app of missing) ajouter('measure_cost', app, 'Aucun coût saisi pour le mois en cours');

  for (const row of byApplication) {
    if (row.amountEur > 0 && row.energyKwh === 0) {
      ajouter('measure_footprint', { id: row.applicationId, code: row.code, name: row.label },
        'Coût saisi, mais aucune consommation déclarée');
    }
    if (row.amountEur > 0 && ['non_compliant', 'partially_compliant'].includes(row.status)) {
      ajouter('question_need', { id: row.applicationId, code: row.code, name: row.label },
        `Dépense en cours sur une application ${STATUS_LABELS[row.status].toLowerCase()}`);
    }
  }

  // Réponses de la DERNIÈRE évaluation soumise, sur les questions de frugalité.
  const answers = all<{ application_id: number; code: string; name: string; question: string; value: string }>(
    db,
    `SELECT a.id AS application_id, a.code AS code, a.name AS name,
            ans.question_code AS question, ans.value_json AS value
       FROM evaluation_answers ans
       JOIN evaluations e ON e.id = ans.evaluation_id
       JOIN applications a ON a.id = e.application_id
      WHERE ${scope.sql}
        AND e.id = (SELECT MAX(id) FROM evaluations WHERE application_id = a.id AND status = 'submitted')
        AND ans.question_code IN ('N2', 'F3', 'F4', 'F5')`,
    ...scope.params,
  );

  const LEVIER_PAR_QUESTION: Record<string, { code: string; reason: string }> = {
    N2: { code: 'frugal_model', reason: 'Modèle jugé surdimensionné pour le besoin (N2)' },
    F3: { code: 'low_carbon_hosting', reason: "Hébergement sans critère carbone (F3)" },
    F4: { code: 'reduce_calls', reason: 'Aucune optimisation de consommation en place (F4)' },
    F5: { code: 'reduce_calls', reason: "Volume d'appels non maîtrisé (F5)" },
  };

  for (const row of answers) {
    const levier = LEVIER_PAR_QUESTION[row.question];
    if (!levier) continue;
    // Seules les réponses en dessous du maximum appellent une action.
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }
    if (String(value) === '2') continue;
    ajouter(levier.code, { id: row.application_id, code: row.code, name: row.name }, levier.reason);
  }

  return [...leviers.entries()]
    .map(([code, applications]) => ({
      code,
      applications: [...applications].sort((a, b) => b.amountEur - a.amountEur),
      amountEur: round2(applications.reduce((sum, entry) => sum + entry.amountEur, 0)),
    }))
    .sort((a, b) => b.amountEur - a.amountEur || b.applications.length - a.applications.length);
}

/**
 * Rapport FinOps d'une seule application. La visibilité et l'exclusion des
 * applications supprimées ne s'appliquent qu'aux **totaux de comparaison**
 * (part et rang) : l'application demandée est, elle, toujours détaillée : la
 * route a déjà vérifié qu'elle est visible par l'utilisateur.
 */
export function buildApplicationFinops(
  db: Db, user: UserDto, applicationId: number, months: number,
): ApplicationFinopsDto {
  const currentMonth = monthKey(new Date());
  const previousMonth = shiftMonth(currentMonth, -1);
  const firstMonth = shiftMonth(currentMonth, -(months - 1));

  const monthlyRows = all<SumRow & { month: string }>(
    db,
    `SELECT period_month AS month, SUM(amount_eur) AS total, SUM(energy_kwh) AS kwh, SUM(co2_kg) AS co2
       FROM finops_costs
      WHERE application_id = ? AND period_month >= ? AND period_month <= ?
      GROUP BY period_month`,
    applicationId, firstMonth, currentMonth,
  );
  const byMonth = new Map(monthlyRows.map((row) => [row.month, totalsOf(row)]));
  const zero: FinopsTotals = { amountEur: 0, energyKwh: 0, co2Kg: 0 };

  const monthly: ApplicationFinopsDto['monthly'] = [];
  for (let index = 0; index < months; index += 1) {
    const month = shiftMonth(firstMonth, index);
    monthly.push({ month, ...(byMonth.get(month) ?? zero) });
  }

  const current = byMonth.get(currentMonth) ?? zero;
  const currentTotal = current.amountEur;
  const previousTotal = (byMonth.get(previousMonth) ?? zero).amountEur;
  const windowTotals: FinopsTotals = {
    amountEur: round2(monthly.reduce((sum, entry) => sum + entry.amountEur, 0)),
    energyKwh: round2(monthly.reduce((sum, entry) => sum + entry.energyKwh, 0)),
    co2Kg: round2(monthly.reduce((sum, entry) => sum + entry.co2Kg, 0)),
  };
  const windowTotal = windowTotals.amountEur;

  // Répartition par source sur toute la fenêtre : sur un seul mois, une
  // application n'a souvent qu'une source, ce qui n'apprendrait rien.
  const sourceRows = all<SumRow & { source: string }>(
    db,
    `SELECT source, SUM(amount_eur) AS total, SUM(energy_kwh) AS kwh, SUM(co2_kg) AS co2
       FROM finops_costs
      WHERE application_id = ? AND period_month >= ? AND period_month <= ?
      GROUP BY source
      ORDER BY total DESC`,
    applicationId, firstMonth, currentMonth,
  );
  const bySource: FinopsBreakdownRow[] = breakdown(
    sourceRows.map((row) => ({ ...row, key: row.source, label: row.source })),
    windowTotal,
  );

  // Situer l'application : part de la dépense du mois, et rang.
  const scope = scopeFor(user);
  const companyTotal = round2(
    one<{ total: number | null }>(
      db,
      `SELECT SUM(c.amount_eur) AS total
         FROM finops_costs c JOIN applications a ON a.id = c.application_id
        WHERE ${scope.sql} AND c.period_month = ?`,
      ...scope.params, currentMonth,
    )?.total ?? 0,
  );

  const ranking = all<{ id: number }>(
    db,
    `SELECT a.id
       FROM finops_costs c JOIN applications a ON a.id = c.application_id
      WHERE ${scope.sql} AND c.period_month = ?
      GROUP BY a.id
      ORDER BY SUM(c.amount_eur) DESC`,
    ...scope.params, currentMonth,
  );
  const position = ranking.findIndex((row) => row.id === applicationId);

  return {
    applicationId,
    currentMonth,
    currentTotal,
    previousMonth,
    previousTotal,
    variationPct: previousTotal > 0 ? round2(((currentTotal - previousTotal) / previousTotal) * 100) : null,
    windowTotal,
    current,
    window: windowTotals,
    monthly,
    bySource,
    frugalityScore: frugalityScores(db, { sql: 'a.id = ?', params: [applicationId] }).get(applicationId) ?? null,
    companyTotal,
    shareOfCompany: share(currentTotal, companyTotal),
    rank: position >= 0 ? position + 1 : null,
    rankedOver: ranking.length,
    entries: listApplicationCosts(db, applicationId),
  };
}

// --- Saisie des coûts -------------------------------------------------------

interface CostRow {
  id: number;
  application_id: number;
  period_month: string;
  amount_eur: number;
  energy_kwh: number;
  co2_kg: number;
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
    energyKwh: row.energy_kwh,
    co2Kg: row.co2_kg,
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
      `INSERT INTO finops_costs (application_id, period_month, amount_eur, energy_kwh, co2_kg, source, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (application_id, period_month, source)
       DO UPDATE SET amount_eur = excluded.amount_eur, energy_kwh = excluded.energy_kwh,
                     co2_kg = excluded.co2_kg, created_by = excluded.created_by`,
      applicationId, input.periodMonth, input.amountEur, input.energyKwh, input.co2Kg, MANUAL_SOURCE, actor.id,
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
      before: existing
        ? {
            periodMonth: existing.period_month,
            amountEur: existing.amount_eur,
            energyKwh: existing.energy_kwh,
            co2Kg: existing.co2_kg,
          }
        : undefined,
      after: {
        applicationId,
        periodMonth: input.periodMonth,
        amountEur: input.amountEur,
        energyKwh: input.energyKwh,
        co2Kg: input.co2Kg,
      },
      ip,
    });

    return toDto(saved);
  });
}

/**
 * Impact FinOps annoncé à la fin du questionnaire d'évaluation.
 *
 * Une **projection**, jamais une prévision inventée : on prend les mois qui
 * portent réellement une donnée sur la fenêtre demandée, on en fait une moyenne
 * mensuelle, et on la ramène à douze mois. Sans donnée déclarée, `monthsObserved`
 * vaut 0 : il n'y a rien à annoncer, et c'est exactement ce que la question F6
 * du questionnaire demande de mettre en place.
 *
 * Le carbone suit la même règle : s'il a été déclaré, il est repris tel quel ;
 * sinon il est calculé depuis la consommation avec le facteur partagé, et
 * `co2Derived` le dit : un calcul ne doit pas passer pour une mesure.
 */
export function estimateFinopsImpact(db: Db, applicationId: number, months = 12): FinopsImpactDto {
  const currentMonth = monthKey(new Date());
  const firstMonth = shiftMonth(currentMonth, -(months - 1));

  const rows = all<SumRow & { month: string }>(
    db,
    `SELECT period_month AS month, SUM(amount_eur) AS total, SUM(energy_kwh) AS kwh, SUM(co2_kg) AS co2
       FROM finops_costs
      WHERE application_id = ? AND period_month >= ? AND period_month <= ?
      GROUP BY period_month
     HAVING total > 0 OR kwh > 0 OR co2 > 0`,
    applicationId, firstMonth, currentMonth,
  );

  const vide: FinopsTotals = { amountEur: 0, energyKwh: 0, co2Kg: 0 };
  const intensity = hostingIntensity(declaredHosting(db, applicationId));
  if (rows.length === 0) {
    return { monthsObserved: 0, monthly: vide, yearly: vide, co2Derived: false, co2Intensity: intensity };
  }

  const somme = rows.reduce(
    (acc, row) => ({
      amountEur: acc.amountEur + (row.total ?? 0),
      energyKwh: acc.energyKwh + (row.kwh ?? 0),
      co2Kg: acc.co2Kg + (row.co2 ?? 0),
    }),
    { ...vide },
  );

  // Empreinte non déclarée mais consommation connue : on la calcule, on le dit,
  // et on le fait avec l'intensité de la région DÉCLARÉE au questionnaire. Le
  // mix français appliqué partout aurait divisé par quatre l'empreinte d'une
  // application hébergée en Irlande, sans que rien ne le signale.
  const co2Derived = somme.co2Kg === 0 && somme.energyKwh > 0;
  const co2Total = co2Derived ? somme.energyKwh * intensity : somme.co2Kg;

  const monthly: FinopsTotals = {
    amountEur: round2(somme.amountEur / rows.length),
    energyKwh: round2(somme.energyKwh / rows.length),
    co2Kg: round2(co2Total / rows.length),
  };

  return {
    monthsObserved: rows.length,
    monthly,
    yearly: {
      amountEur: round2(monthly.amountEur * 12),
      energyKwh: round2(monthly.energyKwh * 12),
      co2Kg: round2(monthly.co2Kg * 12),
    },
    co2Derived,
    co2Intensity: intensity,
  };
}

/**
 * Hébergement (GF7) de la dernière évaluation soumise, s'il y en a une.
 * `undefined` si l'application n'a jamais été évaluée : l'appelant retombe alors
 * sur l'hypothèse défavorable.
 */
function declaredHosting(db: Db, applicationId: number): string | undefined {
  const row = one<{ value: string }>(
    db,
    `SELECT ans.value_json AS value
       FROM evaluation_answers ans
       JOIN evaluations e ON e.id = ans.evaluation_id
      WHERE e.application_id = ? AND e.status = 'submitted' AND ans.question_code = 'GF7'
      ORDER BY e.id DESC
      LIMIT 1`,
    applicationId,
  );
  if (!row) return undefined;
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}
