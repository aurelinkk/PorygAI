/**
 * Import des comptes d'une organisation : on colle une liste, on regarde
 * l'aperçu, on confirme.
 *
 * L'aperçu et l'import sont **le même traitement côté serveur** (`dryRun`) :
 * ce que l'aperçu annonce est exactement ce que l'import fera. Une analyse
 * écrite une seconde fois dans le navigateur finirait par ne plus dire la même
 * chose que celle qui décide vraiment.
 *
 * Les comptes créés n'ont pas de mot de passe : ils se connectent par Google,
 * comme les comptes de l'équipe. Le registre ne fabrique pas d'identifiants.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IMPORT_OUTCOME_LABELS, ROLES, ROLE_LABELS, type ImportReportDto } from '@poryg/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { QuotaGauge } from '../components/Plans';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextareaField } from '../components/ui/Fields';

const EXEMPLE = [
  '# une personne par ligne : adresse ; nom ; rôle',
  'jean.dupont@exemple.fr ; Jean Dupont ; app_manager',
  'sophie.blanc@exemple.fr ; Sophie Blanc ; Auditeur',
  'marc.leroy@exemple.fr',
].join('\n');

export function ImportMembersPage() {
  const { organization, refresh } = useAuth();
  const [text, setText] = useState('');
  const [report, setReport] = useState<ImportReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Importer des comptes · Poryg'AI";
  }, []);

  async function envoyer(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'import');
    setError(null);
    try {
      const response = await api.post<{ report: ImportReportDto }>(
        '/api/organizations/current/members/import',
        { text, dryRun },
      );
      setReport(response.report);
      if (!dryRun) await refresh(); // la jauge de personnes a bougé
      setTimeout(() => resultRef.current?.focus(), 0);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "L'import a échoué.");
    } finally {
      setBusy(null);
    }
  }

  const previewDone = report !== null && report.dryRun;
  const importDone = report !== null && !report.dryRun;
  const toWrite = report ? report.created + report.added : 0;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow mono">{organization?.name}</p>
          <h1 className="page-title">Importer des comptes</h1>
        </div>
        <div className="detail-actions">
          <ButtonLink to="/organisation" variant="ghost" small>
            ← Mon organisation
          </ButtonLink>
        </div>
      </div>

      <div className="import-layout">
        <Card title="Liste à importer" titleId="import-titre">
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              envoyer(true);
            }}
            noValidate
          >
            {error && <Alert tone="error">{error}</Alert>}

            <TextareaField
              id="import-text"
              label="Une personne par ligne"
              hint="Format : adresse ; nom ; rôle. Le nom et le rôle sont facultatifs (rôle par défaut : Utilisateur standard). Séparateurs acceptés : point-virgule, virgule ou tabulation, ce qui permet de coller directement une colonne de tableur."
              rows={10}
              required
              value={text}
              placeholder={EXEMPLE}
              onChange={(event) => {
                setText(event.target.value);
                setReport(null); // le texte a changé : l'aperçu ne vaut plus
              }}
            />

            <div className="form-actions">
              <Button type="submit" variant="secondary" disabled={busy !== null || text.trim() === ''}>
                {busy === 'preview' ? 'Analyse…' : "Voir l'aperçu"}
              </Button>
              <Button
                variant="primary"
                disabled={busy !== null || !previewDone || toWrite === 0}
                onClick={() => envoyer(false)}
              >
                {busy === 'import' ? 'Import…' : `Confirmer l'import${toWrite > 0 ? ` (${toWrite})` : ''}`}
              </Button>
            </div>
            {!previewDone && !importDone && (
              <p className="muted">L'aperçu n'écrit rien : il montre ligne par ligne ce que l'import ferait.</p>
            )}
          </form>
        </Card>

        <Card title="Ce qu'il faut savoir" titleId="import-aide">
          {organization && (
            <QuotaGauge label="Personnes" used={organization.usage.members} max={organization.usage.maxMembers} />
          )}
          <ul className="bullets">
            <li>
              <strong>Les comptes créés se connectent avec Google.</strong> Aucun mot de passe n'est fabriqué
              ni envoyé : la personne clique sur « Continuer avec Google » et entre avec l'adresse importée.
            </li>
            <li>
              <strong>Une adresse déjà connue n'est pas recréée</strong> : le compte existant est simplement
              rattaché à cette organisation, avec le rôle indiqué ici.
            </li>
            <li>
              <strong>Les rôles acceptés</strong> : {ROLES.map((role) => ROLE_LABELS[role]).join(', ')} : ou leur
              code technique ({ROLES.join(', ')}).
            </li>
            <li>
              <strong>Les lignes en trop sont refusées, pas les autres.</strong> Si la formule est pleine, les
              premières lignes passent et les suivantes sont rejetées avec la raison.
            </li>
          </ul>
        </Card>
      </div>

      {report && (
        <Card title={report.dryRun ? "Aperçu de l'import" : 'Import effectué'} titleId="import-resultat">
          <div ref={resultRef} tabIndex={-1}>
            <Alert tone={report.rejected > 0 ? 'warning' : 'success'}>
              {report.dryRun
                ? `${report.created} compte(s) à créer, ${report.added} à rattacher, ${report.already} déjà membre(s), ${report.rejected} ligne(s) rejetée(s). Rien n'a encore été écrit.`
                : `${report.created} compte(s) créé(s), ${report.added} rattaché(s), ${report.already} déjà membre(s), ${report.rejected} ligne(s) rejetée(s).`}
            </Alert>
          </div>

          <div className="table-wrap" tabIndex={0} role="group" aria-labelledby="import-resultat">
            <table className="table table--import" aria-labelledby="import-resultat">
              <thead>
                <tr>
                  <th scope="col">Ligne</th>
                  <th scope="col">Adresse</th>
                  <th scope="col">Rôle</th>
                  <th scope="col">Résultat</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => (
                  <tr key={line.line} className={line.outcome === 'rejected' ? 'is-rejected' : undefined}>
                    <td className="mono">{line.line}</td>
                    <th scope="row">
                      <span className="mono">{line.email || '(vide)'}</span>
                      {line.displayName && <span className="table__meta">{line.displayName}</span>}
                    </th>
                    <td>{line.role ? ROLE_LABELS[line.role] : '—'}</td>
                    <td>
                      <span className={`outcome outcome--${line.outcome}`}>
                        {IMPORT_OUTCOME_LABELS[line.outcome]}
                      </span>
                      <span className="table__meta">{line.message}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {importDone && (
            <div className="detail-actions">
              <ButtonLink to="/organisation" variant="primary" small>
                Voir les personnes de l'organisation
              </ButtonLink>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
