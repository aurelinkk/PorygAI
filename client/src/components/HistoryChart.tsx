/**
 * Historique mensuel des décisions de conformité, en colonnes empilées.
 *
 * Même parti pris que `MonthlyBars` et `BreakdownBars` : le graphique est
 * décoratif (`aria-hidden`), la donnée est un vrai tableau HTML juste en dessous.
 * Ici le tableau est visible et non masqué — c'est lui qui porte l'information
 * (six colonnes ne se lisent pas dans des barres), le graphique donne la forme.
 *
 * Aucune bibliothèque : trois <span> par mois et un peu de flexbox.
 */
import type { BiHistoryRow } from '@poryg/shared';
import { formatMonth } from '../lib/format';

interface HistoryChartProps {
  history: BiHistoryRow[];
  /** id du titre qui nomme le graphique (aria-labelledby du tableau). */
  labelledBy: string;
}

/** Les trois verdicts empilés, du meilleur au moins bon. */
const PARTS = [
  { key: 'compliant', label: 'Conformes' },
  { key: 'partiallyCompliant', label: 'Partiellement conformes' },
  { key: 'nonCompliant', label: 'Non conformes' },
] as const;

export function HistoryChart({ history, labelledBy }: HistoryChartProps) {
  const max = Math.max(...history.map((row) => row.submitted), 1);
  const totals = {
    declared: history.reduce((sum, row) => sum + row.declared, 0),
    submitted: history.reduce((sum, row) => sum + row.submitted, 0),
  };

  if (totals.declared === 0 && totals.submitted === 0) {
    return <p className="muted">Aucune déclaration ni évaluation sur la période analysée.</p>;
  }

  return (
    <>
      <div className="sparkline" aria-hidden="true">
        {history.map((row) => (
          <div key={row.month} className="sparkline__col">
            <span className="stack" style={{ height: `${Math.max((row.submitted / max) * 100, 2)}%` }}>
              {PARTS.map((part) => (
                <span
                  key={part.key}
                  className={`stack__part stack__part--${part.key}`}
                  style={{ flexGrow: row[part.key] }}
                />
              ))}
            </span>
            <span className="sparkline__label mono">{row.month.slice(5)}</span>
          </div>
        ))}
      </div>

      <ul className="legend">
        {PARTS.map((part) => (
          <li key={part.key} className="legend__item">
            <span className={`legend__dot stack__part--${part.key}`} aria-hidden="true" />
            {part.label}
          </li>
        ))}
      </ul>

      <div className="table-wrap" tabIndex={0} role="group" aria-labelledby={labelledBy}>
        <table className="table" aria-labelledby={labelledBy}>
          <thead>
            <tr>
              <th scope="col">Mois</th>
              <th scope="col">Déclarées</th>
              <th scope="col">Évaluations</th>
              {PARTS.map((part) => (
                <th key={part.key} scope="col">
                  {part.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.month}>
                <th scope="row">{formatMonth(row.month)}</th>
                <td className="mono">{row.declared}</td>
                <td className="mono">{row.submitted}</td>
                {PARTS.map((part) => (
                  <td key={part.key} className="mono">
                    {row[part.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="mono">{totals.declared}</td>
              <td className="mono">{totals.submitted}</td>
              {PARTS.map((part) => (
                <td key={part.key} className="mono">
                  {history.reduce((sum, row) => sum + row[part.key], 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
