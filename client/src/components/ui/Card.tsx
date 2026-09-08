import type { ReactNode } from 'react';
import { cx } from '../../lib/format';

interface CardProps {
  /** Titre de la carte (h2). Avec `titleId`, la carte devient une région nommée. */
  title?: string;
  titleId?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Card({ title, titleId, actions, className, children }: CardProps) {
  return (
    <section className={cx('card', className)} aria-labelledby={title && titleId ? titleId : undefined}>
      {(title || actions) && (
        <header className="card__header">
          {title && (
            <h2 id={titleId} className="card__title">
              {title}
            </h2>
          )}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
