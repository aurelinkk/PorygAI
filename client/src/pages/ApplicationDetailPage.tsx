/**
 * Fiche d'une application : informations déclarées, traçabilité, actions
 * disponibles selon le rôle, et historique complet issu du journal d'audit.
 *
 * Les actions affichées viennent du champ `permissions` calculé par l'API :
 * un seul endroit décide, le client ne fait que suivre.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AI_TYPES, AUDIT_ACTION_LABELS, BUSINESS_DOMAINS, DATA_SENSITIVITIES, DECIDED_STATUSES, can,
  STATUS_DESCRIPTIONS, STATUS_LABELS, labelOf,
  type ApplicationDto, type AppStatus, type AuditEntryDto,
} from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useApi, type ApiQuery } from '../api/useApi';
import { useUser } from '../auth/AuthContext';
import { FIELD_LABELS } from '../components/ApplicationForm';
import { Alert } from '../components/ui/Alert';
import { StatusPill } from '../components/ui/Badges';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Loading, LoadingScreen } from '../components/ui/Loading';
import { EvaluationSummary, type EvaluationResponse } from '../components/EvaluationSummary';
import { CostCard, type CostsResponse } from '../components/CostEntry';
import { formatDate, formatDateTime } from '../lib/format';

interface DetailResponse {
  application: ApplicationDto;
  permissions: { edit: boolean; submit: boolean; delete: boolean; restore: boolean; history: boolean };
}

export function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const initialFlash = (location.state as { flash?: string } | null)?.flash ?? null;

  // Les trois requêtes de la page partent EN PARALLÈLE dès le montage. Si les
  // sous-composants les lançaient eux-mêmes, elles attendraient que la fiche
  // soit chargée pour être montés : soit trois allers-retours en cascade.
  const { data, error, loading, reload } = useApi<DetailResponse>(`/api/applications/${id}`);
  const history = useApi<{ history: AuditEntryDto[] }>(`/api/applications/${id}/history`);
  const evaluation = useApi<EvaluationResponse>(`/api/applications/${id}/evaluation`);
  const costs = useApi<CostsResponse>(
    can(user.role, 'finops:read') ? `/api/applications/${id}/costs` : null,
  );
  const [flash, setFlash] = useState<string | null>(initialFlash);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'delete' | 'submit' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = data ? `${data.application.name} · Poryg'AI` : "Application · Poryg'AI";
  }, [data]);

  // Le message d'arrivée ne doit pas réapparaître si l'utilisateur rafraîchit.
  useEffect(() => {
    if (initialFlash) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(path: string, successMessage: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/applications/${id}/${path}`);
      setConfirming(null);
      setFlash(successMessage);
      reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "L'action a échoué.");
    } finally {
      setBusy(false);
    }
  }

  // Écran d'attente au tout premier chargement seulement : lors d'un rechargement
  // (après une action), on garde la page affichée plutôt que de la démonter.
  if (loading && !data) {
    return (
      <LoadingScreen message="Chargement de la fiche…" />
    );
  }
  if (error || !data) {
    return (
      <div className="card message-card">
        <p className="eyebrow mono">{error?.status === 404 ? '404' : 'Erreur'}</p>
        <h1 className="page-title">Application introuvable</h1>
        <p>{error?.message ?? "Cette application n'existe pas ou ne vous est pas accessible."}</p>
        <ButtonLink to="/applications" variant="secondary">
          Retour à l'inventaire
        </ButtonLink>
      </div>
    );
  }

  const { application, permissions } = data;
  const isDeleted = application.status === 'deleted';
  // L'évaluation n'a de sens qu'une fois l'application envoyée à l'audit.
  const canEvaluate = !isDeleted && application.status !== 'draft' && can(user.role, 'evaluation:read');
  /**
   * Un verdict rendu ferme le questionnaire. Pour réévaluer, il faut qu'un
   * événement l'ait justifié : une action corrective terminée, l'expiration
   * annuelle, ou une modification qui remet l'application en audit.
   * Le serveur applique la même règle (`assertEvaluable`) ; ici, c'est du confort.
   */
  const verdictRendu = DECIDED_STATUSES.includes(application.status);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">{application.code}</p>
          <h1 className={`page-title${isDeleted ? ' is-struck' : ''}`}>{application.name}</h1>
        </div>
        <div className="detail-actions">
          {permissions.edit && (
            <ButtonLink to={`/applications/${application.id}/modifier`} variant="secondary" small>
              Modifier
            </ButtonLink>
          )}
          {permissions.submit && (
            <Button variant="primary" small onClick={() => setConfirming('submit')} disabled={busy}>
              Envoyer à l'audit
            </Button>
          )}
          {canEvaluate &&
            (verdictRendu ? (
              <>
                <Button variant="primary" small disabled aria-describedby="evaluate-locked">
                  Évaluer
                </Button>
                <span id="evaluate-locked" className="visually-hidden">
                  Indisponible : cette application a déjà reçu un verdict. Terminez une action de son plan
                  d'action pour la remettre en audit et la réévaluer.
                </span>
              </>
            ) : (
              <ButtonLink to={`/applications/${application.id}/evaluation`} variant="primary" small>
                Évaluer
              </ButtonLink>
            ))}
          {permissions.delete && (
            <Button variant="ghost" small onClick={() => setConfirming('delete')} disabled={busy}>
              Supprimer
            </Button>
          )}
          {permissions.restore && (
            <Button variant="secondary" small onClick={() => void runAction('restore', 'Application restaurée.')} disabled={busy}>
              Restaurer
            </Button>
          )}
        </div>
      </div>

      {flash && <Alert tone="success">{flash}</Alert>}
      {actionError && <Alert tone="error">{actionError}</Alert>}

      {/* Confirmation en ligne plutôt qu'une fenêtre modale : pas de piège au
          clavier à gérer, et le contexte de la page reste lisible. */}
      {confirming === 'delete' && (
        <ConfirmPanel
          title="Supprimer cette application ?"
          description="La suppression est logique : l'enregistrement reste en base, grisé et barré, avec la mention de qui l'a supprimé et quand. Un AI Officer peut la restaurer."
          confirmLabel="Confirmer la suppression"
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void runAction('delete', `${application.code} a été supprimée (suppression logique).`)}
        />
      )}
      {confirming === 'submit' && (
        <ConfirmPanel
          title="Envoyer cette application à l'audit ?"
          description="Elle passera du statut Draft à In progress et deviendra visible dans les tableaux de conformité."
          confirmLabel="Envoyer à l'audit"
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void runAction('submit', `${application.code} est maintenant en cours d'audit.`)}
        />
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <Card title="Informations déclarées" titleId="infos-title">
            <dl className="definitions">
              <Definition label="Statut">
                <StatusPill status={application.status} />
                <span className="definitions__note">{STATUS_DESCRIPTIONS[application.status as AppStatus]}</span>
              </Definition>
              <Definition label="Description">
                {application.description || <span className="muted">Non renseignée</span>}
              </Definition>
              <Definition label="Domaine métier">{labelOf(BUSINESS_DOMAINS, application.businessDomain)}</Definition>
              <Definition label="Type d'IA">{labelOf(AI_TYPES, application.aiType)}</Definition>
              <Definition label="Sensibilité des données">
                {labelOf(DATA_SENSITIVITIES, application.dataSensitivity)}
              </Definition>
              <Definition label="Process Owner">{application.processOwner.displayName}</Definition>
              {application.complianceValidUntil && (
                <Definition label="Conformité valable jusqu'au">
                  <span className="mono">{formatDate(application.complianceValidUntil)}</span>
                </Definition>
              )}
            </dl>
          </Card>

          {canEvaluate && (
            <EvaluationSummary
              applicationId={application.id}
              status={application.status}
              query={evaluation}
              onChange={() => {
                reload();
                evaluation.reload();
              }}
            />
          )}

          {can(user.role, 'finops:read') && (
            <CostCard
              applicationId={application.id}
              query={costs}
              editable={!isDeleted}
              onSaved={costs.reload}
            />
          )}

          {permissions.history && <HistoryCard query={history} />}
        </div>

        <Card title="Traçabilité" titleId="tracability-title" className="detail-side">
          <dl className="definitions definitions--compact">
            <Definition label="Déclarée par">
              {application.createdBy?.displayName ?? <span className="muted">Système</span>}
              <span className="definitions__note mono">{formatDateTime(application.createdAt)}</span>
            </Definition>
            <Definition label="Dernière modification">
              <span className="mono">{formatDateTime(application.updatedAt)}</span>
            </Definition>
            {isDeleted && (
              <Definition label="Supprimée par">
                {application.deletedBy?.displayName ?? <span className="muted">Système</span>}
                {application.deletedAt && (
                  <span className="definitions__note mono">{formatDateTime(application.deletedAt)}</span>
                )}
              </Definition>
            )}
          </dl>
          <p className="muted detail-side__note">
            Aucun enregistrement n'est supprimé physiquement : toute action reste tracée.
          </p>
        </Card>
      </div>

      <p className="back-link">
        <ButtonLink to="/applications" variant="ghost" small>
          ← Retour à l'inventaire
        </ButtonLink>
      </p>
    </>
  );
}

function Definition({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="definitions__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface ConfirmPanelProps {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmPanel({ title, description, confirmLabel, busy, onConfirm, onCancel }: ConfirmPanelProps) {
  return (
    <section className="confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
      <h2 id="confirm-title" className="confirm__title">
        {title}
      </h2>
      <p id="confirm-desc">{description}</p>
      <div className="form-actions">
        {/* autoFocus : l'action se confirme au clavier sans chercher le bouton. */}
        <Button onClick={onConfirm} disabled={busy} autoFocus>
          {busy ? 'En cours…' : confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
      </div>
    </section>
  );
}

/**
 * Actions écrites par la machine, pas décidées par quelqu'un : elles sont
 * conservées telles quelles dans `audit_log` (règle du projet : toute mutation
 * journalise) mais **regroupées à l'affichage**. Une passe dans le questionnaire
 * en produisait une douzaine, qui noyaient les décisions.
 */
const AUTOMATIC_ACTIONS: Record<string, (count: number) => string> = {
  evaluation_saved: (n) => `${n} enregistrements automatiques du brouillon`,
  seed: (n) => `${n} entrées du jeu de démonstration`,
};

type TimelineItem =
  | { kind: 'entry'; entry: AuditEntryDto }
  | { kind: 'group'; action: string; entries: AuditEntryDto[] };

/** Replie les suites d'événements automatiques identiques en une seule ligne. */
function groupHistory(history: AuditEntryDto[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const entry of history) {
    const dernier = items.at(-1);
    if (AUTOMATIC_ACTIONS[entry.action] && dernier?.kind === 'group' && dernier.action === entry.action) {
      dernier.entries.push(entry);
    } else if (AUTOMATIC_ACTIONS[entry.action]) {
      items.push({ kind: 'group', action: entry.action, entries: [entry] });
    } else {
      items.push({ kind: 'entry', entry });
    }
  }
  // Un événement automatique isolé n'a rien à replier : il redevient une ligne.
  return items.map((item) =>
    item.kind === 'group' && item.entries.length === 1 ? { kind: 'entry', entry: item.entries[0]! } : item,
  );
}

function HistoryCard({ query }: { query: ApiQuery<{ history: AuditEntryDto[] }> }) {
  const { data, error, loading } = query;
  const items = data ? groupHistory(data.history) : [];
  const replies = data ? data.history.length - items.length : 0;

  return (
    <Card title="Historique" titleId="history-title">
      {loading && (
        <Loading message="Chargement de l'historique…" />
      )}
      {error && <Alert tone="error">{error.message}</Alert>}
      {data && data.history.length === 0 && <p className="muted">Aucun événement enregistré.</p>}
      {replies > 0 && (
        <p className="muted">
          {replies} enregistrement{replies > 1 ? 's' : ''} automatique{replies > 1 ? 's' : ''} replié
          {replies > 1 ? 's' : ''} pour laisser voir les décisions. Rien n'est supprimé : dépliez pour les lire.
        </p>
      )}
      {data && data.history.length > 0 && (
        <ol className="timeline">
          {items.map((item) =>
            item.kind === 'entry' ? (
              <TimelineEntry key={item.entry.id} entry={item.entry} />
            ) : (
              <TimelineGroup key={item.entries[0]!.id} action={item.action} entries={item.entries} />
            ),
          )}
        </ol>
      )}
    </Card>
  );
}

function TimelineEntry({ entry }: { entry: AuditEntryDto }) {
  return (
    <li className={`timeline__item timeline__item--${toneFor(entry)}`}>
      <p className="timeline__head">
        <span className="timeline__action">{AUDIT_ACTION_LABELS[entry.action] ?? entry.action}</span>
        <span className="timeline__meta mono">
          {entry.actor?.displayName ?? 'Système'} · {formatDateTime(entry.at)}
        </span>
      </p>
      {entry.changes.length > 0 && (
        <ul className="timeline__changes">
          {entry.changes.map((change) => (
            <li key={change.field}>
              <strong>{FIELD_LABELS[change.field] ?? change.field}</strong> :{' '}
              <span className="timeline__before">{display(change.field, change.before)}</span>
              {' → '}
              <span className="timeline__after">{display(change.field, change.after)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Une suite d'événements automatiques, dépliable. L'historique reste complet. */
function TimelineGroup({ action, entries }: { action: string; entries: AuditEntryDto[] }) {
  // La frise va du plus récent au plus ancien : la période va donc du dernier au premier.
  const debut = entries.at(-1)!;
  const fin = entries[0]!;
  const auteurs = new Set(entries.map((entry) => entry.actor?.displayName ?? 'Système'));

  return (
    <li className={`timeline__item timeline__item--${toneFor(fin)}`}>
      <details className="timeline__group">
        <summary className="timeline__head">
          <span className="timeline__action">{AUTOMATIC_ACTIONS[action]!(entries.length)}</span>
          <span className="timeline__meta mono">
            {auteurs.size === 1 ? [...auteurs][0] : `${auteurs.size} personnes`} ·{' '}
            {formatDateTime(debut.at)} → {formatDateTime(fin.at)}
          </span>
        </summary>
        <ol className="timeline timeline--nested">
          {entries.map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} />
          ))}
        </ol>
      </details>
    </li>
  );
}

/**
 * Couleur de la pastille de la frise, par type d'événement.
 *
 * La couleur ne fait que renforcer : le libellé de l'action est toujours affiché
 * juste à côté, donc l'information ne repose jamais sur elle seule.
 */
const TIMELINE_TONES: Record<string, string> = {
  create: 'create', // rose : naissance de la fiche
  seed: 'neutral', // gris : donnée technique
  update: 'update', // bleu : modification
  submit: 'progress', // bleu : passage en audit
  compliance_expired: 'progress', // bleu : retour en audit
  evaluation_saved: 'draft', // violet : brouillon, comme le statut Draft
  delete: 'neutral', // gris : comme le statut Deleted
  restore: 'done', // vert : retour à la vie
  action_plan_done: 'done', // vert : action soldée
};

function toneFor(entry: AuditEntryDto): string {
  // Une évaluation soumise prend la couleur de son verdict, lu dans le
  // changement de statut que l'entrée porte déjà.
  if (entry.action === 'evaluation_submitted') {
    const status = entry.changes.find((change) => change.field === 'status')?.after;
    if (status === 'compliant') return 'done';
    if (status === 'partially_compliant') return 'partial';
    return 'alert';
  }
  return TIMELINE_TONES[entry.action] ?? 'neutral';
}

/** Rend une valeur d'historique lisible (codes → libellés, vide → « : »). */
function display(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return ':';
  const text = String(value);
  switch (field) {
    case 'status':
      return STATUS_LABELS[text as AppStatus] ?? text;
    case 'businessDomain':
      return labelOf(BUSINESS_DOMAINS, text);
    case 'aiType':
      return labelOf(AI_TYPES, text);
    case 'dataSensitivity':
      return labelOf(DATA_SENSITIVITIES, text);
    case 'complianceValidUntil':
      return formatDate(text);
    default:
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
}
