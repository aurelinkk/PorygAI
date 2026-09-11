/**
 * « Mon organisation » : les réglages de l'organisation active et les personnes
 * qui y travaillent.
 *
 * Lecture ouverte à tous ses membres (savoir qui en fait partie et avec quel
 * rôle fait partie de la transparence attendue d'un registre) ; les
 * modifications sont réservées à l'AI Officer, et l'API le vérifie de toute
 * façon : les boutons masqués ne sont qu'un confort.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import {
  PLAN_DEFINITIONS, ROLES, ROLE_HINTS, ROLE_LABELS,
  type MemberDto, type OrganizationDto, type Plan, type Role,
} from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { PlanChoice, QuotaGauge } from '../components/Plans';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/Fields';
import { Loading } from '../components/ui/Loading';
import { formatDate } from '../lib/format';

interface CurrentResponse {
  organization: OrganizationDto;
  members: MemberDto[];
  permissions: { manage: boolean; members: boolean };
}

export function OrganizationPage() {
  const location = useLocation();
  const { refresh } = useAuth();
  const query = useApi<CurrentResponse>('/api/organizations/current');
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);

  useEffect(() => {
    document.title = "Mon organisation · Poryg'AI";
  }, []);

  /** Recharge la fiche ET le profil : formule et rôle sont affichés dans l'en-tête. */
  async function reload(message?: string) {
    query.reload();
    await refresh();
    if (message) setFlash(message);
  }

  if (query.loading && !query.data) return <Loading message="Chargement de l'organisation…" />;
  if (query.error || !query.data) {
    return (
      <div className="card message-card">
        <h1 className="page-title">Organisation indisponible</h1>
        <p>{query.error?.message ?? 'Impossible de charger votre organisation.'}</p>
      </div>
    );
  }

  const { organization, members, permissions } = query.data;
  const actifs = members.filter((member) => member.status === 'active');
  const retires = members.filter((member) => member.status === 'disabled');

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">{organization.slug}</p>
          <h1 className="page-title">{organization.name}</h1>
        </div>
        <div className="detail-actions">
          <ButtonLink to="/organisations" variant="ghost" small>
            ← Mes organisations
          </ButtonLink>
          {permissions.members && (
            <ButtonLink to="/organisation/import" variant="primary" small>
              Importer des comptes
            </ButtonLink>
          )}
        </div>
      </div>

      {flash && <Alert tone="success">{flash}</Alert>}

      <Card title="Formule et consommation" titleId="formule-titre">
        <p>
          Formule <strong>{PLAN_DEFINITIONS[organization.plan].label}</strong>
          {' : '}
          {PLAN_DEFINITIONS[organization.plan].priceEurPerMonth === 0
            ? 'gratuite'
            : `${PLAN_DEFINITIONS[organization.plan].priceEurPerMonth} € par mois`}
          . {PLAN_DEFINITIONS[organization.plan].tagline}
        </p>
        <div className="quotas quotas--wide">
          <QuotaGauge label="Applications déclarées" used={organization.usage.applications} max={organization.usage.maxApplications} />
          <QuotaGauge label="Personnes" used={organization.usage.members} max={organization.usage.maxMembers} />
        </div>
        <p className="muted">
          Les applications supprimées ne consomment pas de place. Aucun paiement n'est encaissé : changer de
          formule enregistre un choix, et rien d'autre.
        </p>
      </Card>

      {permissions.manage && <SettingsCard organization={organization} onSaved={reload} />}

      <MembersCard
        members={actifs}
        retires={retires}
        editable={permissions.members}
        onChanged={reload}
      />
    </>
  );
}

// --- Réglages ----------------------------------------------------------------

function SettingsCard({ organization, onSaved }: { organization: OrganizationDto; onSaved: (message: string) => void }) {
  const [name, setName] = useState(organization.name);
  const [plan, setPlan] = useState<Plan>(organization.plan);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  /**
   * Une formule trop petite pour ce que contient déjà l'organisation est
   * désactivée, avec la raison : refuser après coup, sans expliquer, obligerait
   * à deviner ce qui dépasse.
   */
  const disabledReason: Partial<Record<Plan, string>> = {};
  for (const definition of Object.values(PLAN_DEFINITIONS)) {
    const trop: string[] = [];
    if (definition.maxApplications !== null && organization.usage.applications > definition.maxApplications) {
      trop.push(`${organization.usage.applications} applications`);
    }
    if (definition.maxMembers !== null && organization.usage.members > definition.maxMembers) {
      trop.push(`${organization.usage.members} personnes`);
    }
    if (trop.length > 0) {
      disabledReason[definition.code] = `Impossible : l'organisation compte déjà ${trop.join(' et ')}.`;
    }
  }

  const modifie = name.trim() !== organization.name || plan !== organization.plan;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.put('/api/organizations/current', { name: name.trim(), plan });
      onSaved(
        plan === organization.plan
          ? 'Le nom de l’organisation a été modifié.'
          : `Formule ${PLAN_DEFINITIONS[plan].label} enregistrée.`,
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "L'enregistrement a échoué.");
      setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Réglages" titleId="reglages-titre">
      <form onSubmit={handleSubmit} noValidate>
        {error && (
          <Alert tone="error" ref={errorRef}>
            {error}
          </Alert>
        )}

        <TextField
          id="org-name"
          label="Nom de l'organisation"
          required
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />

        <PlanChoice
          id="org-plan"
          legend="Changer de formule"
          value={plan}
          current={organization.plan}
          disabledReason={disabledReason}
          onChange={setPlan}
        />

        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={saving || !modifie}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// --- Membres -----------------------------------------------------------------

interface MembersCardProps {
  members: MemberDto[];
  retires: MemberDto[];
  editable: boolean;
  onChanged: (message: string) => void;
}

function MembersCard({ members, retires, editable, onChanged }: MembersCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function modifier(member: MemberDto, changes: { role?: Role; status?: 'active' | 'disabled' }, message: string) {
    setBusy(member.id);
    setError(null);
    try {
      await api.put(`/api/organizations/current/members/${member.id}`, {
        role: changes.role ?? member.role,
        status: changes.status ?? member.status,
      });
      onChanged(message);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'La modification a échoué.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title={`Personnes (${members.length})`}
      titleId="membres-titre"
      actions={
        editable ? (
          <ButtonLink to="/organisation/import" variant="secondary" small>
            Importer des comptes
          </ButtonLink>
        ) : undefined
      }
    >
      {error && <Alert tone="error">{error}</Alert>}

      <div className="table-wrap" tabIndex={0} role="group" aria-labelledby="membres-titre">
        <table className="table members-table" aria-labelledby="membres-titre">
          <thead>
            <tr>
              <th scope="col">Personne</th>
              <th scope="col">Rôle dans cette organisation</th>
              <th scope="col">Depuis</th>
              {editable && <th scope="col">Action</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <th scope="row">
                  <strong>{member.displayName}</strong>
                  <span className="mono table__meta">{member.email}</span>
                  {member.neverConnected && <span className="tag tag--waiting">Invitation en attente</span>}
                </th>
                <td>
                  {editable ? (
                    <>
                      <label htmlFor={`role-${member.id}`} className="visually-hidden">
                        Rôle de {member.displayName}
                      </label>
                      <select
                        id={`role-${member.id}`}
                        className="input input--select input--inline"
                        value={member.role}
                        disabled={busy === member.id}
                        onChange={(event) =>
                          modifier(
                            member,
                            { role: event.target.value as Role },
                            `${member.displayName} est désormais ${ROLE_LABELS[event.target.value as Role]}.`,
                          )
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <span className="table__meta">{ROLE_HINTS[member.role]}</span>
                    </>
                  ) : (
                    <>
                      {ROLE_LABELS[member.role]}
                      <span className="table__meta">{ROLE_HINTS[member.role]}</span>
                    </>
                  )}
                </td>
                <td className="mono">{formatDate(member.joinedAt)}</td>
                {editable && (
                  <td>
                    <Button
                      variant="ghost"
                      small
                      disabled={busy === member.id}
                      onClick={() =>
                        modifier(
                          member,
                          { status: 'disabled' },
                          `${member.displayName} n'a plus accès à cette organisation.`,
                        )
                      }
                    >
                      Retirer
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {retires.length > 0 && (
        <details className="retires">
          <summary>
            {retires.length} personne{retires.length > 1 ? 's' : ''} retirée{retires.length > 1 ? 's' : ''} de
            l'organisation
          </summary>
          <p className="muted">
            Leur passage est conservé : ce qu'elles ont déclaré ou évalué reste attribué à leur nom. Les
            réintégrer consomme à nouveau une place.
          </p>
          <ul className="retires__list">
            {retires.map((member) => (
              <li key={member.id}>
                <span>
                  {member.displayName} <span className="mono">{member.email}</span>
                </span>
                {editable && (
                  <Button
                    variant="ghost"
                    small
                    disabled={busy === member.id}
                    onClick={() =>
                      modifier(member, { status: 'active' }, `${member.displayName} a de nouveau accès.`)
                    }
                  >
                    Réintégrer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
