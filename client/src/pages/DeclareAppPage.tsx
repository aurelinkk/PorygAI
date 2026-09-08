/**
 * Formulaire "Déclarer une application". Validation Zod côté client (même schéma
 * que l'API), puis POST /api/applications → statut Draft → retour à l'accueil.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AI_TYPES, BUSINESS_DOMAINS, DATA_SENSITIVITIES, ROLE_LABELS, createApplicationSchema,
  type ApplicationDto, type Role,
} from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/useApi';
import { useUser } from '../auth/AuthContext';
import { Alert, FormErrorSummary } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { RadioGroupField, SelectField, TextField, TextareaField } from '../components/ui/Fields';
import { focusField, zodFieldErrors, type FieldErrors } from '../lib/forms';

const FIELD_LABELS: Record<string, string> = {
  name: "Nom de l'application",
  description: 'Description',
  businessDomain: 'Domaine métier',
  aiType: "Type d'IA",
  dataSensitivity: 'Sensibilité des données',
  processOwnerId: 'Process Owner',
};

interface DirectoryUser {
  id: number;
  displayName: string;
  role: Role;
}

export function DeclareAppPage() {
  const user = useUser();
  const navigate = useNavigate();
  const directory = useApi<{ users: DirectoryUser[] }>('/api/users');

  const [values, setValues] = useState({
    name: '',
    description: '',
    businessDomain: '',
    aiType: '',
    dataSensitivity: '',
    processOwnerId: String(user.id),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Déclarer une application · Poryg'AI";
  }, []);

  const set = (field: keyof typeof values) => (value: string) => setValues((previous) => ({ ...previous, [field]: value }));

  function showErrors(fieldErrors: FieldErrors) {
    setErrors(fieldErrors);
    setTimeout(() => summaryRef.current?.focus(), 0);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalError(null);

    const parsed = createApplicationSchema.safeParse(values);
    if (!parsed.success) {
      showErrors(zodFieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const { application } = await api.post<{ application: ApplicationDto }>('/api/applications', parsed.data);
      navigate('/', { state: { flash: `${application.code} · « ${application.name} » a été déclarée en brouillon (Draft).` } });
    } catch (error) {
      if (error instanceof ApiError && error.fields) showErrors(error.fields);
      else setGlobalError(error instanceof ApiError ? error.message : "L'enregistrement a échoué.");
    } finally {
      setSubmitting(false);
    }
  }

  const needsDpo = values.dataSensitivity === 'personal' || values.dataSensitivity === 'sensitive';
  const ownerOptions = (directory.data?.users ?? []).map((u) => ({
    value: String(u.id),
    label: `${u.displayName} — ${ROLE_LABELS[u.role]}`,
  }));

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">Nouvelle déclaration · statut initial : Draft</p>
          <h1 className="page-title">Déclarer une application</h1>
        </div>
      </div>

      <Card className="form-card">
        {globalError && <Alert tone="error">{globalError}</Alert>}
        <FormErrorSummary ref={summaryRef} errors={errors} labels={FIELD_LABELS} onFocusField={focusField} />

        <form onSubmit={handleSubmit} noValidate>
          <p className="field__hint">Les champs marqués d'une étoile (*) sont obligatoires.</p>

          <div className="form-grid">
            <div className="form-grid__full">
              <TextField
                id="name"
                label={FIELD_LABELS.name!}
                required
                maxLength={120}
                autoComplete="off"
                value={values.name}
                onChange={(event) => set('name')(event.target.value)}
                error={errors.name}
                hint="Nom usuel, tel qu'il apparaîtra dans l'inventaire."
              />
            </div>

            <div className="form-grid__full">
              <TextareaField
                id="description"
                label={FIELD_LABELS.description!}
                rows={4}
                maxLength={2000}
                value={values.description}
                onChange={(event) => set('description')(event.target.value)}
                error={errors.description}
                hint="À quoi sert l'application, pour qui, avec quelles données ?"
              />
            </div>

            <SelectField
              id="businessDomain"
              label={FIELD_LABELS.businessDomain!}
              required
              options={BUSINESS_DOMAINS.map((d) => ({ value: d.code, label: d.label }))}
              value={values.businessDomain}
              onChange={(event) => set('businessDomain')(event.target.value)}
              error={errors.businessDomain}
            />

            <SelectField
              id="aiType"
              label={FIELD_LABELS.aiType!}
              required
              options={AI_TYPES.map((t) => ({ value: t.code, label: t.label }))}
              value={values.aiType}
              onChange={(event) => set('aiType')(event.target.value)}
              error={errors.aiType}
            />

            <div className="form-grid__full">
              <RadioGroupField
                id="dataSensitivity"
                label={FIELD_LABELS.dataSensitivity!}
                required
                hint="Niveau le plus élevé parmi les données traitées."
                options={DATA_SENSITIVITIES.map((s) => ({ value: s.code, label: s.label, hint: s.hint }))}
                value={values.dataSensitivity}
                onChange={set('dataSensitivity')}
                error={errors.dataSensitivity}
              />
              {needsDpo && (
                <p className="notice notice--warning" role="status">
                  Données personnelles : l'avis du DPO sera requis lors de l'évaluation.
                </p>
              )}
            </div>

            <div className="form-grid__full">
              <SelectField
                id="processOwnerId"
                label={FIELD_LABELS.processOwnerId!}
                required
                hint="Personne responsable de l'application au quotidien."
                options={ownerOptions}
                placeholder={directory.loading ? 'Chargement…' : '— Choisir —'}
                value={values.processOwnerId}
                onChange={(event) => set('processOwnerId')(event.target.value)}
                error={errors.processOwnerId}
              />
            </div>
          </div>

          <div className="form-actions">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Enregistrement…' : "Déclarer l'application"}
            </Button>
            <ButtonLink to="/" variant="ghost">
              Annuler
            </ButtonLink>
          </div>
        </form>
      </Card>
    </>
  );
}
