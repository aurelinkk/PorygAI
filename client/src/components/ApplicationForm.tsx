/**
 * Formulaire d'application, partagé entre la déclaration et la modification.
 *
 * Il porte toute la mécanique accessible : validation Zod (même schéma que
 * l'API), résumé d'erreurs en tête avec focus, erreurs reliées à chaque champ.
 * L'appelant ne fournit que les valeurs initiales et ce qu'il faut faire à la
 * soumission.
 */
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AI_TYPES, BUSINESS_DOMAINS, DATA_SENSITIVITIES, ROLE_LABELS,
  createApplicationSchema, type CreateApplicationInput, type Role,
} from '@poryg/shared';
import { ApiError } from '../api/client';
import { useApi } from '../api/useApi';
import { Alert, FormErrorSummary } from './ui/Alert';
import { Button, ButtonLink } from './ui/Button';
import { CheckboxGroupField, SelectField, TextField, TextareaField } from './ui/Fields';
import { focusField, zodFieldErrors, type FieldErrors } from '../lib/forms';

export const FIELD_LABELS: Record<string, string> = {
  name: "Nom de l'application",
  description: 'Description',
  businessDomain: 'Domaine métier',
  aiType: "Type d'IA",
  dataSensitivity: 'Sensibilité des données',
  dataSensitivities: 'Nature des données traitées',
  processOwnerId: 'Process Owner',
  processOwner: 'Process Owner',
  status: 'Statut',
  complianceValidUntil: 'Échéance de conformité',
};

export interface ApplicationFormValues {
  name: string;
  description: string;
  businessDomain: string;
  aiType: string;
  dataSensitivities: string[];
  processOwnerId: string;
}

interface DirectoryUser {
  id: number;
  displayName: string;
  role: Role;
}

interface ApplicationFormProps {
  initialValues: ApplicationFormValues;
  submitLabel: string;
  submittingLabel: string;
  cancelTo: string;
  /** Message affiché au-dessus des actions (ex. avertissement de réévaluation). */
  notice?: ReactNode;
  onSubmit: (values: CreateApplicationInput) => Promise<void>;
}

export function ApplicationForm({
  initialValues, submitLabel, submittingLabel, cancelTo, notice, onSubmit,
}: ApplicationFormProps) {
  const directory = useApi<{ users: DirectoryUser[] }>('/api/users');

  const [values, setValues] = useState<ApplicationFormValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const set = (field: keyof ApplicationFormValues) => (value: string) =>
    setValues((previous) => ({ ...previous, [field]: value }));

  function showErrors(fieldErrors: FieldErrors) {
    setErrors(fieldErrors);
    // Laisse React rendre le résumé avant d'y déplacer le focus.
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
      await onSubmit(parsed.data);
    } catch (error) {
      if (error instanceof ApiError && error.fields) showErrors(error.fields);
      else setGlobalError(error instanceof ApiError ? error.message : "L'enregistrement a échoué.");
    } finally {
      setSubmitting(false);
    }
  }

  const needsDpo = values.dataSensitivities.some((code) => code === 'personal' || code === 'sensitive');
  const ownerOptions = (directory.data?.users ?? []).map((user) => ({
    value: String(user.id),
    label: `${user.displayName} : ${ROLE_LABELS[user.role]}`,
  }));

  return (
    <>
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
            options={BUSINESS_DOMAINS.map((domain) => ({ value: domain.code, label: domain.label }))}
            value={values.businessDomain}
            onChange={(event) => set('businessDomain')(event.target.value)}
            error={errors.businessDomain}
          />

          <SelectField
            id="aiType"
            label={FIELD_LABELS.aiType!}
            required
            options={AI_TYPES.map((type) => ({ value: type.code, label: type.label }))}
            value={values.aiType}
            onChange={(event) => set('aiType')(event.target.value)}
            error={errors.aiType}
          />

          <div className="form-grid__full">
            <CheckboxGroupField
              id="dataSensitivities"
              label={FIELD_LABELS.dataSensitivities!}
              required
              hint="Cochez tout ce que l'application traite : une même application croise souvent plusieurs natures de données. Les obligations retenues seront celles de la plus contraignante."
              options={DATA_SENSITIVITIES.map((item) => ({ value: item.code, label: item.label, hint: item.hint }))}
              values={values.dataSensitivities}
              onChange={(next) => setValues((previous) => ({ ...previous, dataSensitivities: next }))}
              error={errors.dataSensitivities}
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
              placeholder={directory.loading ? 'Chargement…' : ': Choisir :'}
              value={values.processOwnerId}
              onChange={(event) => set('processOwnerId')(event.target.value)}
              error={errors.processOwnerId}
            />
          </div>
        </div>

        {notice}

        <div className="form-actions">
          <Button type="submit" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </Button>
          <ButtonLink to={cancelTo} variant="ghost">
            Annuler
          </ButtonLink>
        </div>
      </form>
    </>
  );
}
