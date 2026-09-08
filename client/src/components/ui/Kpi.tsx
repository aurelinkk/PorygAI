/**
 * Indicateur clé (page d'accueil). À utiliser dans un <dl className="kpi-grid">.
 */
import type { ReactNode } from 'react';
import { cx } from '../../lib/format';

interface KpiProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'success' | 'accent';
}

export function Kpi({ label, value, hint, tone = 'default' }: KpiProps) {
  return (
    <div className={cx('kpi', tone !== 'default' && `kpi--${tone}`)}>
      <dt className="kpi__label">{label}</dt>
      <dd className="kpi__body">
        <span className="kpi__value">{value}</span>
        {hint && <span className="kpi__hint mono">{hint}</span>}
      </dd>
    </div>
  );
}
