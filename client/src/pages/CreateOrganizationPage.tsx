/**
 * « Ajouter mon organisation » : un nom, une formule, et l'on y est.
 *
 * La personne qui crée en devient l'AI Officer (c'est le seul rôle qui peut y
 * inviter les autres) et sa session bascule aussitôt dessus : on ne crée pas une
 * organisation pour rester dans une autre.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createOrganizationSchema, type OrganizationDto, type Plan, type UserDto } from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PlanChoice } from '../components/Plans';
import { Alert, FormErrorSummary } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/Fields';
import { focusField, zodFieldErrors, type FieldErrors } from '../lib/forms';

const FIELD_LABELS: Record<string, string> = {
  name: "Nom de l'organisation",
  plan: 'Formule',
};

export function CreateOrganizationPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [plan, setPlan] = useState<Plan>('free');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Ajouter mon organisation · Poryg'AI";
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalError(null);

    const parsed = createOrganizationSchema.safeParse({ name, plan });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const { organization } = await api.post<{ organization: OrganizationDto; user: UserDto }>(
        '/api/organizations',
        parsed.data,
      );
      // Le serveur a déjà basculé la session : on relit le profil pour que
      // l'en-tête et les permissions du client suivent.
      await refresh();
      navigate('/organisation', {
        state: {
          flash:
            `« ${organization.name} » est créée et active. Vous en êtes l'AI Officer : ` +
            'ajoutez maintenant les personnes qui y travaillent.',
        },
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields) {
        setErrors(cause.fields);
        setTimeout(() => summaryRef.current?.focus(), 0);
      } else {
        setGlobalError(cause instanceof ApiError ? cause.message : "La création de l'organisation a échoué.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">Nouvelle organisation · vous en serez l'AI Officer</p>
          <h1 className="page-title">Ajouter mon organisation</h1>
        </div>
      </div>

      <Card className="form-card">
        <form onSubmit={handleSubmit} noValidate>
          <FormErrorSummary errors={errors} labels={FIELD_LABELS} onFocusField={focusField} ref={summaryRef} />
          {globalError && <Alert tone="error">{globalError}</Alert>}

          <TextField
            id="name"
            label={FIELD_LABELS.name!}
            hint="Le nom de l'entreprise, de la filiale ou de l'équipe qui tient ce registre."
            required
            value={name}
            error={errors.name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />

          <PlanChoice id="plan" value={plan} onChange={setPlan} />

          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Création…' : "Ajouter l'organisation"}
            </Button>
            <ButtonLink to="/organisations" variant="ghost">
              Annuler
            </ButtonLink>
          </div>
        </form>
      </Card>
    </>
  );
}
