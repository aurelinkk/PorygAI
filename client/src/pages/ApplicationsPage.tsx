/**
 * Inventaire : liste filtrable des applications IA.
 *
 * Les filtres vivent dans l'URL (`?q=&status=&domain=&sensitivity=`) : la
 * recherche est partageable, et le bouton « Précédent » du navigateur fonctionne.
 * Le filtrage lui-même est fait par l'API, pas dans le navigateur.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  APP_STATUSES, BUSINESS_DOMAINS, DATA_SENSITIVITIES, STATUS_LABELS, can,
  type ApplicationDto,
} from '@poryg/shared';
import { useApi } from '../api/useApi';
import { useUser } from '../auth/AuthContext';
import { ApplicationsTable } from '../components/ApplicationsTable';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Fields';
import { Loading } from '../components/ui/Loading';

const FILTER_KEYS = ['q', 'status', 'domain', 'sensitivity'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type FilterValues = Record<FilterKey, string>;

const EMPTY: FilterValues = { q: '', status: '', domain: '', sensitivity: '' };

export function ApplicationsPage() {
  const user = useUser();
  const [searchParams, setSearchParams] = useSearchParams();

  // Valeurs saisies dans le formulaire ; elles ne partent à l'API qu'à la validation.
  const [draft, setDraft] = useState<FilterValues>(() => readFilters(searchParams));

  useEffect(() => {
    document.title = "Inventaire · Poryg'AI";
  }, []);

  // L'URL reste la source de vérité (retour arrière, lien partagé).
  useEffect(() => {
    setDraft(readFilters(searchParams));
  }, [searchParams]);

  const query = searchParams.toString();
  const { data, error, loading } = useApi<{ applications: ApplicationDto[] }>(
    `/api/applications${query ? `?${query}` : ''}`,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) if (draft[key]) next.set(key, draft[key]);
    setSearchParams(next);
  }

  const set = (key: FilterKey) => (value: string) => setDraft((previous) => ({ ...previous, [key]: value }));
  const activeCount = FILTER_KEYS.filter((key) => searchParams.get(key)).length;
  const applications = data?.applications ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">Registre des applications IA</p>
          <h1 className="page-title">Inventaire</h1>
        </div>
        {can(user.role, 'application:create') && <ButtonLink to="/applications/nouvelle">Déclarer une app</ButtonLink>}
      </div>

      <search>
        <form className="filters" onSubmit={handleSubmit} role="search" aria-label="Filtrer l'inventaire">
          <div className="filters__grid">
            <TextField
              id="q"
              label="Rechercher"
              type="search"
              placeholder="Nom, code, description…"
              value={draft.q}
              onChange={(event) => set('q')(event.target.value)}
            />
            <SelectField
              id="status"
              label="Statut"
              placeholder="Tous"
              options={APP_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
              value={draft.status}
              onChange={(event) => set('status')(event.target.value)}
            />
            <SelectField
              id="domain"
              label="Domaine métier"
              placeholder="Tous"
              options={BUSINESS_DOMAINS.map((domain) => ({ value: domain.code, label: domain.label }))}
              value={draft.domain}
              onChange={(event) => set('domain')(event.target.value)}
            />
            <SelectField
              id="sensitivity"
              label="Sensibilité"
              placeholder="Toutes"
              options={DATA_SENSITIVITIES.map((item) => ({ value: item.code, label: item.label }))}
              value={draft.sensitivity}
              onChange={(event) => set('sensitivity')(event.target.value)}
            />
          </div>
          <div className="filters__actions">
            <Button type="submit" variant="secondary" small>
              Filtrer
            </Button>
            {activeCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                small
                onClick={() => {
                  setDraft(EMPTY);
                  setSearchParams(new URLSearchParams());
                }}
              >
                Réinitialiser ({activeCount})
              </Button>
            )}
          </div>
        </form>
      </search>

      {loading && (
        <Loading message="Chargement de l'inventaire…" />
      )}
      {error && <Alert tone="error">{error.message}</Alert>}

      {data && (
        <>
          {/* Annonce du nombre de résultats après un filtrage (lecteurs d'écran). */}
          <p className="results-count" role="status">
            {applications.length === 0
              ? 'Aucune application ne correspond à ces critères.'
              : `${applications.length} application${applications.length > 1 ? 's' : ''}${
                  activeCount > 0 ? ' correspondant aux filtres' : ''
                }.`}
          </p>
          <div className="card">
            <h2 id="inventory-title" className="visually-hidden">
              Résultats de l'inventaire
            </h2>
            <ApplicationsTable applications={applications} labelledBy="inventory-title" />
          </div>
        </>
      )}
    </>
  );
}

function readFilters(params: URLSearchParams): FilterValues {
  return {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    domain: params.get('domain') ?? '',
    sensitivity: params.get('sensitivity') ?? '',
  };
}
