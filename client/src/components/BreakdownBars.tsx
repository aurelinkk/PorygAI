/**
 * Répartition en barres horizontales.
 *
 * C'est un vrai tableau HTML : les chiffres restent lisibles pour tout le monde,
 * la barre n'est qu'un renfort visuel (`aria-hidden`). Aucune bibliothèque de
 * graphiques — quelques lignes de CSS suffisent, et le rendu reste accessible.
 */
import type { ReactNode } from 'react';
import { formatEur } from '../lib/format';

export interface BreakdownItem {
  key: string;
  label: ReactNode;
  amountEur: number;
  share: number;
  hint?: ReactNode;
  /** Modificateur CSS optionnel, pour colorer une ligne (statut de conformité). */
  tone?: string;
}

interface BreakdownBarsProps {
  items: BreakdownItem[];
  labelledBy: string;
  /** En-tête de la première colonne. */
  header: string;
  emptyMessage?: string;
}

export function BreakdownBars({ items, labelledBy, header, emptyMessage }: BreakdownBarsProps) {
  if (items.length === 0) {
    return <p className="muted">{emptyMessage ?? 'Aucune donnée pour ce mois.'}</p>;
  }

  // Les barres sont proportionnelles à la plus grande valeur, pas au total :
  // sinon, avec dix lignes, elles seraient toutes illisiblement courtes.
  const max = Math.max(...items.map((item) => item.amountEur), 1);

  return (
    <div
      className="table-wrap"
      // Rend le défilement horizontal atteignable au clavier (WCAG 2.1.1).
      // `group` et non `region` : la carte parente est déjà un landmark portant
      // ce même titre, deux landmarks homonymes seraient une erreur.
      tabIndex={0}
      role="group"
      aria-labelledby={labelledBy}
    >
      <table className="table breakdown" aria-labelledby={labelledBy}>
        <thead>
          <tr>
            <th scope="col">{header}</th>
            <th scope="col">Coût</th>
            <th scope="col">Part</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <th scope="row">
                <span className="breakdown__label">{item.label}</span>
                {item.hint && <span className="table__meta mono">{item.hint}</span>}
              </th>
              <td>
                <span className="mono breakdown__amount">{formatEur(item.amountEur)}</span>
                <span className="breakdown__track" aria-hidden="true">
                  <span
                    className={`breakdown__bar${item.tone ? ` breakdown__bar--${item.tone}` : ''}`}
                    style={{ width: `${(item.amountEur / max) * 100}%` }}
                  />
                </span>
              </td>
              <td className="mono">{(item.share * 100).toFixed(1)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
