/**
 * Indicateur clé. À utiliser dans un <dl className="kpi-grid">.
 *
 * Avec `to`, la tuile devient cliquable. Le lien n'entoure que la valeur : un
 * <a> ne peut pas envelopper les <dt>/<dd> d'une liste de définitions : mais un
 * pseudo-élément le fait couvrir toute la tuile : une seule cible pour la souris
 * comme pour le clavier, sans casser la structure HTML.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/format';

interface KpiProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'success' | 'accent';
  /** Destination si la tuile est cliquable. */
  to?: string;
  /**
   * Ce que le lien annonce en plus de la valeur (lue seule, « 62 k€ » ne dit
   * pas où l'on va). Affiché aux seuls lecteurs d'écran.
   */
  linkLabel?: string;
}

export function Kpi({ label, value, hint, tone = 'default', to, linkLabel }: KpiProps) {
  return (
    <div className={cx('kpi', tone !== 'default' && `kpi--${tone}`, to && 'kpi--link')}>
      <dt className="kpi__label">{label}</dt>
      <dd className="kpi__body">
        <span className="kpi__value">
          {to ? (
            <Link to={to} className="kpi__link">
              {value}
              {linkLabel && <span className="visually-hidden"> : {linkLabel}</span>}
            </Link>
          ) : (
            value
          )}
        </span>
        {hint && <span className="kpi__hint mono">{hint}</span>}
      </dd>
    </div>
  );
}
