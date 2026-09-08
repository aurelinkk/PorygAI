/**
 * Boutons de la charte : primaire (rose), secondaire (bleu pastel), fantôme (pointillé).
 * `ButtonLink` a le même rendu mais est un vrai lien (navigation).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
}

export function Button({ variant = 'primary', small, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cx('btn', `btn--${variant}`, small && 'btn--small', className)} {...props} />;
}

interface ButtonLinkProps {
  to: string;
  variant?: Variant;
  small?: boolean;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({ to, variant = 'primary', small, className, children }: ButtonLinkProps) {
  return (
    <Link to={to} className={cx('btn', `btn--${variant}`, small && 'btn--small', className)}>
      {children}
    </Link>
  );
}
