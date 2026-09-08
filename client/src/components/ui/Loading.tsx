/**
 * Écrans de chargement, utilisés partout où l'on attend des données.
 *
 * Accessibilité : `role="status"` + `aria-live="polite"` annoncent l'attente
 * sans interrompre l'utilisateur, et le texte reste lisible (pas seulement une
 * animation). L'animation respecte `prefers-reduced-motion` (voir base.css).
 *
 * La barre de progression reprend le dégradé de la charte, qui lui est
 * justement réservé (titres de page, barres de progression, courbes BI).
 */

interface LoadingProps {
  /** Ce que l'on attend, formulé pour l'utilisateur. */
  message?: string;
}

/** Chargement d'un bloc à l'intérieur d'une page déjà affichée. */
export function Loading({ message = 'Chargement…' }: LoadingProps) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="loading-bar" aria-hidden="true" />
      <span className="loading-text">{message}</span>
    </div>
  );
}

/** Chargement d'une page entière : carte centrée avec le logo. */
export function LoadingScreen({ message = 'Chargement…' }: LoadingProps) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen__card">
        <img src="/logo-96.png" alt="" width={64} height={64} className="loading-screen__logo" />
        <p className="loading-screen__text">{message}</p>
        <span className="loading-bar" aria-hidden="true" />
      </div>
    </div>
  );
}
