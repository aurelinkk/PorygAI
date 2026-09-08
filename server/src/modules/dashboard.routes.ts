/**
 * GET /api/dashboard/summary → indicateurs de la page d'accueil, adaptés au rôle.
 */
import type { FastifyInstance } from 'fastify';
import type { ApplicationDto, DashboardSummaryDto, UserDto } from '@poryg/shared';
import { all, one, type Db } from '../db/connection.js';
import { currentMonth } from '../lib/time.js';
import { listApplications } from './applications.repo.js';

interface StatusCount {
  status: string;
  n: number;
}

/** Bloc "Mes évaluations" : ce que ce rôle a à faire, avec une phrase d'explication. */
function myEvaluations(user: UserDto, applications: ApplicationDto[]): DashboardSummaryDto['myEvaluations'] {
  const items: DashboardSummaryDto['myEvaluations'] = [];
  const push = (application: ApplicationDto, hint: string) => items.push({ application, hint });

  for (const app of applications) {
    switch (user.role) {
      case 'app_manager':
        if (app.processOwner.id !== user.id) break;
        if (app.status === 'draft') push(app, 'Brouillon à compléter');
        else if (app.status === 'in_progress') push(app, 'Questionnaire à renseigner');
        else if (app.status === 'non_compliant') push(app, "Plan d'action à exécuter");
        break;
      case 'auditor':
        if (app.status === 'in_progress') push(app, 'À auditer');
        break;
      case 'dpo':
        if (app.status === 'in_progress' && ['personal', 'sensitive'].includes(app.dataSensitivity)) {
          push(app, 'Avis DPO attendu');
        }
        break;
      case 'ai_officer':
        if (app.status === 'in_progress') push(app, "En cours d'audit");
        else if (app.status === 'non_compliant') push(app, "Plan d'action à suivre");
        break;
      case 'standard':
        break;
    }
  }
  return items.slice(0, 6);
}

export function registerDashboardRoutes(app: FastifyInstance, options: { db: Db }): void {
  const { db } = options;

  app.get('/api/dashboard/summary', { preHandler: app.requirePermission('dashboard:read') }, async (request) => {
    const user = request.user!;
    const applications = listApplications(db, user);

    const counts = new Map(
      all<StatusCount>(db, 'SELECT status, COUNT(*) AS n FROM applications GROUP BY status').map((r) => [r.status, r.n]),
    );
    const count = (status: string) => counts.get(status) ?? 0;
    const total = [...counts.entries()].filter(([status]) => status !== 'deleted').reduce((sum, [, n]) => sum + n, 0);

    const month = currentMonth();
    const cost = one<{ total: number | null }>(
      db,
      `SELECT SUM(c.amount_eur) AS total
         FROM finops_costs c JOIN applications a ON a.id = c.application_id
        WHERE c.period_month = ? AND a.status <> 'deleted'`,
      month,
    );

    const summary: DashboardSummaryDto = {
      applications: total,
      compliant: count('compliant'),
      inProgress: count('in_progress'),
      nonCompliant: count('non_compliant'),
      monthlyCostEur: cost?.total ?? 0,
      month,
      recent: applications.slice(0, 8),
      myEvaluations: myEvaluations(user, applications),
    };
    return summary;
  });
}
