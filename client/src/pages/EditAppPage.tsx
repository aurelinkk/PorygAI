/**
 * Formulaire de modification → PUT /api/applications/:id.
 *
 * Particularité métier : modifier le domaine, la sensibilité ou le type d'IA
 * d'une application déjà décidée (Conforme / Non conforme) la replace en cours
 * d'audit. L'utilisateur est prévenu avant d'enregistrer.
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { canEditApplication, type ApplicationDto, type CreateApplicationInput } from '@poryg/shared';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { useUser } from '../auth/AuthContext';
import { ApplicationForm } from '../components/ApplicationForm';
import { Alert } from '../components/ui/Alert';
import { ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LoadingScreen } from '../components/ui/Loading';
import { ForbiddenPage } from './ForbiddenPage';

interface UpdateResponse {
  application: ApplicationDto;
  reevaluationTriggered: boolean;
}

export function EditAppPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const navigate = useNavigate();
  const { data, error, loading } = useApi<{ application: ApplicationDto }>(`/api/applications/${id}`);

  useEffect(() => {
    document.title = "Modifier une application · Poryg'AI";
  }, []);

  if (loading && !data) {
    return (
      <LoadingScreen message="Chargement du formulaire…" />
    );
  }
  if (error || !data) {
    return (
      <div className="card message-card">
        <h1 className="page-title">Application introuvable</h1>
        <p>{error?.message ?? 'Cette application n’existe pas ou ne vous est pas accessible.'}</p>
        <ButtonLink to="/applications" variant="secondary">
          Retour à l'inventaire
        </ButtonLink>
      </div>
    );
  }

  const application = data.application;
  if (!canEditApplication(user, application)) return <ForbiddenPage />;

  const isDecided = application.status === 'compliant' || application.status === 'non_compliant';

  async function handleSubmit(values: CreateApplicationInput) {
    const response = await api.put<UpdateResponse>(`/api/applications/${id}`, values);
    navigate(`/applications/${id}`, {
      state: {
        flash: response.reevaluationTriggered
          ? `Modifications enregistrées. Un champ évalué a changé : ${response.application.code} repasse en cours d'audit.`
          : 'Modifications enregistrées.',
      },
    });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">{application.code}</p>
          <h1 className="page-title">Modifier « {application.name} »</h1>
        </div>
      </div>

      <Card className="form-card">
        {isDecided && (
          <Alert tone="warning">
            Cette application est <strong>{application.status === 'compliant' ? 'conforme' : 'non conforme'}</strong>.
            Modifier son domaine métier, la sensibilité des données ou le type d'IA la replacera en cours d'audit,
            car ce qui a été évalué ne correspondrait plus à ce qui est déclaré.
          </Alert>
        )}

        <ApplicationForm
          initialValues={{
            name: application.name,
            description: application.description,
            businessDomain: application.businessDomain,
            aiType: application.aiType,
            dataSensitivity: application.dataSensitivity,
            processOwnerId: String(application.processOwner.id),
          }}
          submitLabel="Enregistrer les modifications"
          submittingLabel="Enregistrement…"
          cancelTo={`/applications/${id}`}
          onSubmit={handleSubmit}
        />
      </Card>
    </>
  );
}
