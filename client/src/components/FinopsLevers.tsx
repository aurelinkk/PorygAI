/**
 * Leviers d'optimisation d'un FinOps responsable.
 *
 * Le serveur ne renvoie que les leviers que les données justifient, avec les
 * applications concernées et la raison : un conseil générique (« utilisez des
 * modèles frugaux ») ne se met pas en œuvre, un conseil nominatif si.
 *
 * Les libellés viennent de `FINOPS_LEVERS` (@poryg/shared) : le serveur envoie
 * un code, le front l'affiche : une seule formulation pour les deux côtés.
 */
import { Link } from 'react-router-dom';
import { FINOPS_LEVERS, FINOPS_PRINCIPLES, type FinopsLeverDto } from '@poryg/shared';
import { formatEur } from '../lib/format';

const PRINCIPLE_LABELS = Object.fromEntries(
  FINOPS_PRINCIPLES.map((principle) => [principle.code, principle.label]),
);

export function FinopsLevers({ levers }: { levers: FinopsLeverDto[] }) {
  if (levers.length === 0) {
    return (
      <p className="muted">
        Aucun levier à proposer : les coûts sont saisis, les empreintes déclarées, et le questionnaire ne
        signale pas de gaspillage.
      </p>
    );
  }

  return (
    <ol className="levers">
      {levers.map((lever) => {
        const definition = FINOPS_LEVERS[lever.code];
        if (!definition) return null;
        return (
          <li key={lever.code} className="lever">
            <div className="lever__head">
              <h3 className="lever__title">{definition.label}</h3>
              <span className="lever__principle mono">{PRINCIPLE_LABELS[definition.principle]}</span>
            </div>
            <p className="lever__description">{definition.description}</p>
            <p className="lever__weight mono">
              {lever.applications.length} application{lever.applications.length > 1 ? 's' : ''}
              {lever.amountEur > 0 && ` · ${formatEur(lever.amountEur)} / mois concernés`}
            </p>
            <ul className="lever__apps">
              {lever.applications.map((app) => (
                <li key={app.id}>
                  <Link to={`/applications/${app.id}`}>{app.name}</Link>{' '}
                  <span className="mono table__meta">{app.code}</span>
                  <span className="lever__reason">{app.reason}</span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
