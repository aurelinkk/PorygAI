/**
 * Évolution mensuelle d'un coût, en barres verticales.
 *
 * Partagé par le rapport FinOps global et par celui d'une application.
 *
 * Accessibilité : les barres sont purement décoratives (`aria-hidden`) et les
 * valeurs sont fournies par un tableau visuellement masqué mais lu par les
 * lecteurs d'écran. Aucune bibliothèque de graphiques.
 */
import { formatEur, formatMonth } from '../lib/format';

interface MonthlyBarsProps {
  months: { month: string; amountEur: number }[];
  /** id du titre qui nomme le graphique (aria-labelledby du tableau). */
  labelledBy: string;
}

export function MonthlyBars({ months, labelledBy }: MonthlyBarsProps) {
  const max = Math.max(...months.map((entry) => entry.amountEur), 1);

  return (
    <>
      <div className="sparkline" aria-hidden="true">
        {months.map((entry) => (
          <div key={entry.month} className="sparkline__col">
            <span
              className="sparkline__bar"
              // 2 % au minimum : un mois à zéro doit rester visible comme un trait.
              style={{ height: `${Math.max((entry.amountEur / max) * 100, 2)}%` }}
            />
            <span className="sparkline__label mono">{entry.month.slice(5)}</span>
          </div>
        ))}
      </div>

      <table className="table visually-hidden" aria-labelledby={labelledBy}>
        <caption>Coût mensuel</caption>
        <thead>
          <tr>
            <th scope="col">Mois</th>
            <th scope="col">Coût</th>
          </tr>
        </thead>
        <tbody>
          {months.map((entry) => (
            <tr key={entry.month}>
              <th scope="row">{formatMonth(entry.month)}</th>
              <td>{formatEur(entry.amountEur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
