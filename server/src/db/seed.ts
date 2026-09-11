/**
 * Jeu de données de démonstration : deux organisations, un utilisateur par rôle
 * et quelques applications couvrant tous les statuts. Idempotent : ne fait rien
 * si des applications existent déjà.
 *
 * La deuxième organisation (« Atelier Nova », formule Découverte) est là pour
 * que la démonstration montre ce qui ne se voit pas autrement : le sélecteur
 * d'organisation, le cloisonnement des données, et une jauge de formule
 * gratuite. Elle est volontairement vide d'applications : c'est aussi ce que
 * voit quelqu'un qui vient de créer la sienne.
 *
 * Mot de passe commun à tous les comptes de démo : Poryg2026!
 */
import { hashPassword } from '../auth/password.js';
import { recordAudit } from '../audit.js';
import { estimateCo2, highestSensitivity } from '@poryg/shared';
import { addMonths, currentMonth, nowIso } from '../lib/time.js';
import { one, run, transaction, type Db } from './connection.js';

export const DEMO_PASSWORD = 'Poryg2026!';

/**
 * L'organisation d'accueil créée par la migration 006 (id 1), renommée ici pour
 * la démonstration. Le renommage est sans risque : le seed ne s'exécute que sur
 * une base vide d'applications.
 */
export const DEMO_ORGANIZATION = { id: 1, name: 'Poryg Industries', slug: 'poryg-industries' };

/** Deuxième organisation : formule gratuite, deux personnes, aucune application. */
export const DEMO_SECOND_ORGANIZATION = {
  name: 'Atelier Nova',
  slug: 'atelier-nova',
  plan: 'free',
  members: [
    { email: 'alice.martin@poryg.local', role: 'ai_officer' },
    { email: 'camille.roux@poryg.local', role: 'app_manager' },
  ],
} as const;

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
  /** Tout ce que l'application traite : le jeu de démo doit montrer des croisements. */
  sensitivities: string[];
  aiType: string;
  owner: string; // email
  status: string;
  validUntil?: string;
  deletedBy?: string; // email
  deletedAt?: string;
  monthlyCost: number;
  /**
   * Consommation mensuelle en kWh. `undefined` = empreinte non déclarée : le jeu
   * de démonstration doit contenir les deux cas, l'indicateur de couverture du
   * rapport n'aurait rien à montrer sinon.
   */
  monthlyKwh?: number;
}

const DEMO_APPS: DemoApp[] = [
  {
    name: 'Assistant Recrutement',
    description: 'Aide à la rédaction des offres et pré-sélection des candidatures.',
    domain: 'rh', sensitivities: ['internal', 'personal'], aiType: 'genai',
    owner: 'camille.roux@poryg.local', status: 'compliant', validUntil: '2027-04-12T00:00:00.000Z',
    monthlyCost: 18500,
    monthlyKwh: 42000,
  },
  {
    name: 'Scoring Crédit',
    description: "Notation automatique des demandes de crédit des clients particuliers.",
    domain: 'finance', sensitivities: ['confidential', 'personal'], aiType: 'ml_predictive',
    owner: 'camille.roux@poryg.local', status: 'non_compliant',
    monthlyCost: 9800,
    monthlyKwh: 6500,
  },
  {
    name: 'Chatbot Support',
    description: 'Agent conversationnel de premier niveau pour le support client.',
    domain: 'client', sensitivities: ['internal', 'personal'], aiType: 'genai',
    owner: 'camille.roux@poryg.local', status: 'in_progress',
    monthlyCost: 14200,
    monthlyKwh: 31000,
  },
  {
    name: 'Prévision Stock v1',
    description: 'Ancien modèle de prévision des stocks, remplacé par la v2.',
    domain: 'supply', sensitivities: ['internal'], aiType: 'ml_predictive',
    owner: 'camille.roux@poryg.local', status: 'deleted',
    deletedBy: 'alice.martin@poryg.local', deletedAt: '2026-06-15T09:12:00.000Z',
    monthlyCost: 0,
  },
  {
    name: 'Détection Fraude',
    description: 'Détection en temps réel des transactions suspectes.',
    domain: 'finance', sensitivities: ['confidential'], aiType: 'ml_predictive',
    owner: 'alice.martin@poryg.local', status: 'compliant',
    // Volontairement expirée : au démarrage, le job de conformité la repasse "In progress".
    validUntil: '2026-08-01T00:00:00.000Z',
    monthlyCost: 7300,
    monthlyKwh: 9800,
  },
  {
    name: 'Résumé de réunions',
    description: 'Transcription et synthèse automatique des réunions internes.',
    domain: 'it', sensitivities: ['internal'], aiType: 'genai',
    owner: 'camille.roux@poryg.local', status: 'draft',
    monthlyCost: 1200,
  },
  {
    name: 'Tri automatique des CV',
    description: 'Classement des CV reçus selon leur adéquation au poste.',
    domain: 'rh', sensitivities: ['internal', 'personal', 'sensitive'], aiType: 'nlp',
    owner: 'camille.roux@poryg.local', status: 'in_progress',
    monthlyCost: 4600,
    monthlyKwh: 12500,
  },
  {
    name: 'Recommandation produits',
    description: 'Personnalisation des recommandations sur le site e-commerce.',
    domain: 'marketing', sensitivities: ['public', 'personal'], aiType: 'recommendation',
    owner: 'alice.martin@poryg.local', status: 'compliant', validUntil: '2027-02-20T00:00:00.000Z',
    monthlyCost: 6400,
  },
];

export async function seedDatabase(db: Db, log: (message: string) => void = () => {}): Promise<boolean> {
  // On teste la présence d'applications, pas d'utilisateurs : les comptes de
  // l'équipe sont créés par la migration 002 et ne doivent pas bloquer le seed.
  const existing = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM applications');
  if (existing && existing.n > 0) {
    log('[db] seed ignoré : la base contient déjà des applications');
    return false;
  }

  // Le hachage est asynchrone (CPU), on le fait avant d'ouvrir la transaction.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  transaction(db, () => {
    // Le compte ne porte plus de rôle : c'est l'appartenance à une organisation
    // qui le porte (voir migration 006 et modules/organizations.repo.ts).
    const userIds = new Map<string, number>();
    for (const user of DEMO_USERS) {
      const result = run(
        db,
        'INSERT OR IGNORE INTO users (email, display_name, password_hash) VALUES (?, ?, ?)',
        user.email, user.displayName, passwordHash,
      );
      const id = Number(result.lastInsertRowid)
        || one<{ id: number }>(db, 'SELECT id FROM users WHERE email = ?', user.email)!.id;
      userIds.set(user.email, id);
      run(
        db,
        `INSERT OR IGNORE INTO memberships (organization_id, user_id, role) VALUES (?, ?, ?)`,
        DEMO_ORGANIZATION.id, id, user.role,
      );
    }

    run(
      db, 'UPDATE organizations SET name = ?, slug = ? WHERE id = ?',
      DEMO_ORGANIZATION.name, DEMO_ORGANIZATION.slug, DEMO_ORGANIZATION.id,
    );

    // Deuxième organisation : Alice appartient aux deux, ce qui donne au
    // sélecteur d'organisation quelque chose à sélectionner.
    const second = DEMO_SECOND_ORGANIZATION;
    const alice = userIds.get(second.members[0].email)!;
    const secondId = Number(
      run(
        db, 'INSERT INTO organizations (name, slug, plan, created_by) VALUES (?, ?, ?, ?)',
        second.name, second.slug, second.plan, alice,
      ).lastInsertRowid,
    );
    for (const member of second.members) {
      run(
        db, 'INSERT INTO memberships (organization_id, user_id, role, invited_by) VALUES (?, ?, ?, ?)',
        secondId, userIds.get(member.email)!, member.role, alice,
      );
    }
    recordAudit(db, {
      actorId: alice, entity: 'organization', entityId: secondId, action: 'organization_created',
      after: { name: second.name, slug: second.slug, plan: second.plan },
    });

    const month = currentMonth();
    const previousMonths = [addMonths(`${month}-01T00:00:00.000Z`, -1), addMonths(`${month}-01T00:00:00.000Z`, -2)]
      .map((iso) => iso.slice(0, 7));

    DEMO_APPS.forEach((app, index) => {
      const code = `APP-${String(index + 1).padStart(4, '0')}`;
      // Déclarations étalées sur l'année écoulée : sans cela, l'historique des
      // tableaux de bord serait une seule colonne au mois courant.
      const declaredAt = addMonths(nowIso(), -((DEMO_APPS.length - 1 - index) % 11));
      const ownerId = userIds.get(app.owner)!;
      const deletedBy = app.deletedBy ? userIds.get(app.deletedBy)! : null;
      const result = run(
        db,
        `INSERT INTO applications
           (organization_id, code, name, description, business_domain, data_sensitivity,
            data_sensitivities_json, ai_type, process_owner_id, status, compliance_valid_until,
            created_by, created_at, updated_at, deleted_by, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        DEMO_ORGANIZATION.id, code, app.name, app.description, app.domain,
        highestSensitivity(app.sensitivities), JSON.stringify(app.sensitivities), app.aiType, ownerId,
        app.status, app.validUntil ?? null, ownerId, declaredAt, declaredAt, deletedBy, app.deletedAt ?? null,
      );
      const appId = Number(result.lastInsertRowid);
      recordAudit(db, {
        actorId: null, entity: 'application', entityId: appId, action: 'seed',
        after: { code, status: app.status }, at: declaredAt,
      });

      // Coûts : mois courant + 2 mois d'historique (légèrement différents).
      // L'énergie suit la même variation que le coût ; le carbone en découle avec
      // le facteur d'intensité partagé (`estimateCo2`).
      if (app.status !== 'deleted') {
        const inserer = (periode: string, facteur: number) => {
          const kwh = app.monthlyKwh ? Math.round(app.monthlyKwh * facteur) : 0;
          run(
            db,
            `INSERT INTO finops_costs (application_id, period_month, amount_eur, energy_kwh, co2_kg, source)
             VALUES (?, ?, ?, ?, ?, ?)`,
            appId, periode, Math.round(app.monthlyCost * facteur), kwh, estimateCo2(kwh), 'seed',
          );
        };
        inserer(month, 1);
        previousMonths.forEach((pm, i) => inserer(pm, 0.9 - i * 0.08));
      }
    });
  });

  log(
    `[db] seed : ${DEMO_USERS.length} utilisateurs, 2 organisations, ` +
    `${DEMO_APPS.length} applications (${nowIso()})`,
  );
  return true;
}
