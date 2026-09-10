/**
 * Évolution mensuelle d'une mesure, en barres verticales.
 *
 * Partagé par le rapport FinOps global, celui d'une application, et l'activité
 * des tableaux de bord BI : d'où la valeur générique plutôt que des euros.
 *
 * Le graphique porte un **axe vertical gradué** (échelle arrondie, voir
 * `lib/charts.ts`) et affiche le **détail au survol** d'une colonne. L'infobulle
 * se loge dans la marge haute réservée du graphique : elle ne recouvre jamais
 * autre chose, ce qui la dispense d'un mécanisme de fermeture (WCAG 2.2, 1.4.13).
 *
 * Accessibilité : le graphique reste purement décoratif (`aria-hidden`) : survol
 * compris, qui n'apporte rien de plus. Les valeurs sont fournies par un tableau
 * visuellement masqué mais lu par les lecteurs d'écran, et accessible au clavier.
 * Aucune bibliothèque de graphiques.
 */
import { formatEur, formatMonth } from '../lib/format';
import { barHeight, niceScale } from '../lib/charts';

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
  const { top, ticks } = niceScale(Math.max(...months.map((entry) => entry.value), 0));

  return (
    <>
      <div className="chart" aria-hidden="true">
        <div className="chart__axis">
          {[...ticks].reverse().map((tick) => (
            <span key={tick} className="chart__tick mono">
              {formatValue(tick)}
            </span>
          ))}
        </div>

        <div className="chart__plot">
          {ticks.map((tick) => (
            <span key={tick} className="chart__line" style={{ bottom: `${(tick / top) * 100}%` }} />
          ))}

          <div className="sparkline">
            {months.map((entry) => (
              <div key={entry.month} className="sparkline__col">
                <span className="sparkline__bar" style={{ height: barHeight(entry.value, top) }} />
                <span className="chart__tip">
                  {formatMonth(entry.month)}
                  <strong>{formatValue(entry.value)}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Deuxième rangée de la grille : la case sous l'axe, puis les mois,
            alignés sur les colonnes du graphique. */}
        <span className="chart__corner" />
        <div className="chart__labels">
          {months.map((entry) => (
            <span key={entry.month} className="sparkline__label mono">
              {entry.month.slice(5)}
            </span>
          ))}
        </div>
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
