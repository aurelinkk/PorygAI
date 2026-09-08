/**
 * Jeu de données de démonstration : un utilisateur par rôle et quelques
 * applications couvrant tous les statuts. Idempotent : ne fait rien si des
 * utilisateurs existent déjà.
 *
 * Mot de passe commun à tous les comptes de démo : Poryg2026!
 */
import { hashPassword } from '../auth/password.js';
import { recordAudit } from '../audit.js';
import { addMonths, currentMonth, nowIso } from '../lib/time.js';
import { one, run, transaction, type Db } from './connection.js';

export const DEMO_PASSWORD = 'Poryg2026!';

export const DEMO_USERS = [
  { email: 'alice.martin@poryg.local', displayName: 'Alice Martin', role: 'ai_officer' },
  { email: 'camille.roux@poryg.local', displayName: 'Camille Roux', role: 'app_manager' },
  { email: 'david.nguyen@poryg.local', displayName: 'David Nguyen', role: 'dpo' },
  { email: 'emma.bernard@poryg.local', displayName: 'Emma Bernard', role: 'auditor' },
  { email: 'lucas.petit@poryg.local', displayName: 'Lucas Petit', role: 'standard' },
] as const;

interface DemoApp {
  name: string;
  description: string;
  domain: string;
  sensitivity: string;
  aiType: string;
  owner: string; // email
  status: string;
  validUntil?: string;
  deletedBy?: string; // email
  deletedAt?: string;
  monthlyCost: number;
}

const DEMO_APPS: DemoApp[] = [
  {
    name: 'Assistant Recrutement',
    description: 'Aide à la rédaction des offres et pré-sélection des candidatures.',
    domain: 'rh', sensitivity: 'personal', aiType: 'genai',
    owner: 'camille.roux@poryg.local', status: 'compliant', validUntil: '2027-04-12T00:00:00.000Z',
    monthlyCost: 18500,
  },
  {
    name: 'Scoring Crédit',
    description: "Notation automatique des demandes de crédit des clients particuliers.",
    domain: 'finance', sensitivity: 'personal', aiType: 'ml_predictive',
    owner: 'camille.roux@poryg.local', status: 'non_compliant',
    monthlyCost: 9800,
  },
  {
    name: 'Chatbot Support',
    description: 'Agent conversationnel de premier niveau pour le support client.',
    domain: 'client', sensitivity: 'personal', aiType: 'genai',
    owner: 'camille.roux@poryg.local', status: 'in_progress',
    monthlyCost: 14200,
  },
  {
    name: 'Prévision Stock v1',
    description: 'Ancien modèle de prévision des stocks, remplacé par la v2.',
    domain: 'supply', sensitivity: 'internal', aiType: 'ml_predictive',
    owner: 'camille.roux@poryg.local', status: 'deleted',
    deletedBy: 'alice.martin@poryg.local', deletedAt: '2026-06-15T09:12:00.000Z',
    monthlyCost: 0,
  },
  {
    name: 'Détection Fraude',
    description: 'Détection en temps réel des transactions suspectes.',
    domain: 'finance', sensitivity: 'confidential', aiType: 'ml_predictive',
    owner: 'alice.martin@poryg.local', status: 'compliant',
    // Volontairement expirée : au démarrage, le job de conformité la repasse "In progress".
    validUntil: '2026-08-01T00:00:00.000Z',
    monthlyCost: 7300,
  },
  {
    name: 'Résumé de réunions',
    description: 'Transcription et synthèse automatique des réunions internes.',
    domain: 'it', sensitivity: 'internal', aiType: 'genai',
    owner: 'camille.roux@poryg.local', status: 'draft',
    monthlyCost: 1200,
  },
  {
    name: 'Tri automatique des CV',
    description: 'Classement des CV reçus selon leur adéquation au poste.',
    domain: 'rh', sensitivity: 'sensitive', aiType: 'nlp',
    owner: 'camille.roux@poryg.local', status: 'in_progress',
    monthlyCost: 4600,
  },
  {
    name: 'Recommandation produits',
    description: 'Personnalisation des recommandations sur le site e-commerce.',
    domain: 'marketing', sensitivity: 'personal', aiType: 'recommendation',
    owner: 'alice.martin@poryg.local', status: 'compliant', validUntil: '2027-02-20T00:00:00.000Z',
    monthlyCost: 6400,
  },
];

export async function seedDatabase(db: Db, log: (message: string) => void = () => {}): Promise<boolean> {
  const existing = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users');
  if (existing && existing.n > 0) {
    log('[db] seed ignoré : des utilisateurs existent déjà');
    return false;
  }

  // Le hachage est asynchrone (CPU), on le fait avant d'ouvrir la transaction.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  transaction(db, () => {
    const userIds = new Map<string, number>();
    for (const user of DEMO_USERS) {
      const result = run(
        db,
        'INSERT INTO users (email, display_name, role, password_hash) VALUES (?, ?, ?, ?)',
        user.email, user.displayName, user.role, passwordHash,
      );
      userIds.set(user.email, Number(result.lastInsertRowid));
    }

    const month = currentMonth();
    const previousMonths = [addMonths(`${month}-01T00:00:00.000Z`, -1), addMonths(`${month}-01T00:00:00.000Z`, -2)]
      .map((iso) => iso.slice(0, 7));

    DEMO_APPS.forEach((app, index) => {
      const code = `APP-${String(index + 1).padStart(4, '0')}`;
      const ownerId = userIds.get(app.owner)!;
      const deletedBy = app.deletedBy ? userIds.get(app.deletedBy)! : null;
      const result = run(
        db,
        `INSERT INTO applications
           (code, name, description, business_domain, data_sensitivity, ai_type, process_owner_id,
            status, compliance_valid_until, created_by, deleted_by, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        code, app.name, app.description, app.domain, app.sensitivity, app.aiType, ownerId,
        app.status, app.validUntil ?? null, ownerId, deletedBy, app.deletedAt ?? null,
      );
      const appId = Number(result.lastInsertRowid);
      recordAudit(db, { actorId: null, entity: 'application', entityId: appId, action: 'seed', after: { code, status: app.status } });

      // Coûts : mois courant + 2 mois d'historique (légèrement différents).
      if (app.status !== 'deleted') {
        run(db, 'INSERT INTO finops_costs (application_id, period_month, amount_eur, source) VALUES (?, ?, ?, ?)',
          appId, month, app.monthlyCost, 'seed');
        previousMonths.forEach((pm, i) => {
          run(db, 'INSERT INTO finops_costs (application_id, period_month, amount_eur, source) VALUES (?, ?, ?, ?)',
            appId, pm, Math.round(app.monthlyCost * (0.9 - i * 0.08)), 'seed');
        });
      }
    });
  });

  log(`[db] seed : ${DEMO_USERS.length} utilisateurs, ${DEMO_APPS.length} applications (${nowIso()})`);
  return true;
}
