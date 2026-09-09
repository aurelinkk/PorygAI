/**
 * Évolution mensuelle d'une mesure, en barres verticales.
 *
 * Partagé par le rapport FinOps global, celui d'une application, et l'activité
 * des tableaux de bord BI — d'où la valeur générique plutôt que des euros.
 *
 * Accessibilité : les barres sont purement décoratives (`aria-hidden`) et les
 * valeurs sont fournies par un tableau visuellement masqué mais lu par les
 * lecteurs d'écran. Aucune bibliothèque de graphiques.
 */
import { formatEur, formatMonth } from '../lib/format';

interface MonthlyBarsProps {
  months: { month: string; value: number }[];
  /** id du titre qui nomme le graphique (aria-labelledby du tableau). */
  labelledBy: string;
  /** Titre du tableau équivalent, lu par les lecteurs d'écran. */
  caption?: string;
  /** En-tête de la colonne de valeurs. */
  valueHeader?: string;
  /** Mise en forme d'une valeur. Par défaut : des euros. */
  formatValue?: (value: number) => string;
}

export function MonthlyBars({
  months, labelledBy, caption = 'Coût mensuel', valueHeader = 'Coût', formatValue = formatEur,
}: MonthlyBarsProps) {
  const max = Math.max(...months.map((entry) => entry.value), 1);

  return (
    <>
      <div className="sparkline" aria-hidden="true">
        {months.map((entry) => (
          <div key={entry.month} className="sparkline__col">
            <span
              className="sparkline__bar"
              // 2 % au minimum : un mois à zéro doit rester visible comme un trait.
              style={{ height: `${Math.max((entry.value / max) * 100, 2)}%` }}
            />
            <span className="sparkline__label mono">{entry.month.slice(5)}</span>
          </div>
        ))}
      </div>

      {/* Le masquage porte sur un <div> et non sur le <table> : `overflow: hidden`
          ne découpe pas une boîte `display: table`, dont le contenu débordait alors
          la page entière (barre de défilement horizontale parasite). */}
      <div className="visually-hidden">
        <table className="table" aria-labelledby={labelledBy}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Mois</th>
              <th scope="col">{valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((entry) => (
              <tr key={entry.month}>
                <th scope="row">{formatMonth(entry.month)}</th>
                <td>{formatValue(entry.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
