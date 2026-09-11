/**
 * « Mes organisations » : la liste de celles dont je suis membre, celle qui est
 * active, et le bouton pour ajouter la mienne.
 *
 * C'est surtout **le premier écran d'un compte neuf**. Une personne qui se
 * connecte pour la première fois par Google arrive ici, sans organisation :
 * cette page doit donc se suffire à elle-même, dire pourquoi elle ne voit rien,
 * et n'offrir qu'un seul chemin évident. C'est aussi l'écran de quelqu'un qui a
 * été retiré de toutes ses organisations : le message vaut pour les deux.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PLAN_DEFINITIONS, PLAN_LABELS, ROLE_LABELS } from '@poryg/shared';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { QuotaGauge } from '../components/Plans';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { formatDate } from '../lib/format';

export function OrganizationsPage() {
  const { user, organizations, organization, switchOrganization } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [flash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Mes organisations · Poryg'AI";
  }, []);

  async function basculer(id: number) {
    setBusy(id);
    setError(null);
    try {
      await switchOrganization(id);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Le changement d'organisation a échoué.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">{user?.email}</p>
          <h1 className="page-title">Mes organisations</h1>
        </div>
        <div className="detail-actions">
          <ButtonLink to="/organisations/nouvelle" variant="primary" small>
            Ajouter mon organisation
          </ButtonLink>
        </div>
      </div>

      {flash && <Alert tone="success">{flash}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {organizations.length === 0 ? (
        <Card
          title="Ce compte n'est affilié à aucune organisation"
          titleId="aucune-org"
          className="org-empty"
        >
          <p className="org-empty__lead">
            Un registre d'applications IA appartient toujours à une organisation : c'est elle qui délimite
            ce que vous voyez, qui en fait partie et qui décide. Tant que ce compte n'en a aucune, il n'y a
            rien à afficher : ni inventaire, ni évaluation, ni tableau de bord.
          </p>

          <div className="detail-actions">
            <ButtonLink to="/organisations/nouvelle" variant="primary">
              Ajouter mon organisation
            </ButtonLink>
          </div>

          <p>Deux façons d'entrer, donc :</p>
          <ul className="bullets">
            <li>
              <strong>Ajouter la vôtre</strong> : vous en devenez l'AI Officer, vous choisissez sa formule
              (la formule Découverte est gratuite) et vous y invitez qui vous voulez.
            </li>
            <li>
              <strong>Être invité</strong> : demandez à l'AI Officer de l'organisation d'ajouter votre
              adresse <span className="mono">{user?.email}</span>. Elle apparaîtra ici dès votre prochaine
              connexion, sans que vous ayez rien à faire.
            </li>
          </ul>
        </Card>
      ) : (
        <div className="org-grid">
          {organizations.map((item) => {
            const active = item.id === organization?.id;
            const definition = PLAN_DEFINITIONS[item.plan];
            return (
              <Card
                key={item.id}
                title={item.name}
                titleId={`org-${item.id}`}
                className={active ? 'org-card org-card--active' : 'org-card'}
              >
                <p className="org-card__meta">
                  <span className={`plan-badge plan-badge--${item.plan}`}>{PLAN_LABELS[item.plan]}</span>
                  <span className="muted">
                    {definition.priceEurPerMonth === 0 ? 'Gratuit' : `${definition.priceEurPerMonth} € / mois`}
                  </span>
                  <span className="mono">{item.slug}</span>
                </p>

                <p>
                  Votre rôle ici : <strong>{ROLE_LABELS[item.role]}</strong>
                  <br />
                  <span className="muted">Créée le {formatDate(item.createdAt)}</span>
                </p>

                <div className="quotas">
                  <QuotaGauge label="Applications" used={item.usage.applications} max={item.usage.maxApplications} />
                  <QuotaGauge label="Personnes" used={item.usage.members} max={item.usage.maxMembers} />
                </div>

                <div className="detail-actions">
                  {active ? (
                    <>
                      <span className="org-card__badge">Organisation active</span>
                      <ButtonLink to="/organisation" variant="secondary" small>
                        Gérer
                      </ButtonLink>
                    </>
                  ) : (
                    <Button variant="secondary" small disabled={busy !== null} onClick={() => basculer(item.id)}>
                      {busy === item.id ? 'Basculement…' : `Basculer sur ${item.name}`}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
