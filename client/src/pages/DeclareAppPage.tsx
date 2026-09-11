/**
 * Formulaire « Déclarer une application » → POST /api/applications → statut Draft.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApplicationDto, CreateApplicationInput } from '@poryg/shared';
import { api } from '../api/client';
import { useUser } from '../auth/AuthContext';
import { ApplicationForm } from '../components/ApplicationForm';
import { Card } from '../components/ui/Card';

export function DeclareAppPage() {
  const user = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Déclarer une application · Poryg'AI";
  }, []);

  async function handleSubmit(values: CreateApplicationInput) {
    const { application } = await api.post<{ application: ApplicationDto }>('/api/applications', values);
    navigate(`/applications/${application.id}`, {
      state: { flash: `${application.code} · « ${application.name} » a été déclarée en brouillon (Draft).` },
    });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">Nouvelle déclaration · statut initial : Draft</p>
          <h1 className="page-title">Déclarer une application</h1>
        </div>
      </div>

      <Card className="form-card">
        <ApplicationForm
          initialValues={{
            name: '',
            description: '',
            businessDomain: '',
            aiType: '',
            dataSensitivities: [],
            // Par défaut, la personne qui déclare est aussi Process Owner.
            processOwnerId: String(user.id),
          }}
          submitLabel="Déclarer l'application"
          submittingLabel="Enregistrement…"
          cancelTo="/applications"
          onSubmit={handleSubmit}
        />
      </Card>
    </>
  );
}
