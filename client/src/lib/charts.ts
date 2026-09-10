/**
 * Échelle d'un axe vertical, sans bibliothèque de graphiques.
 *
 * Le maximum brut d'une série ne fait pas une échelle lisible : « 18 437 » en
 * haut de l'axe n'aide personne. On arrondit au pas rond supérieur (1, 2, 2,5, 5
 * ou 10 × une puissance de dix) et on gradue régulièrement jusque-là.
 */
export interface Scale {
  /** Valeur du haut de l'axe : les barres se calculent par rapport à elle. */
  top: number;
  /** Graduations, de zéro au sommet. */
  ticks: number[];
}

export function niceScale(max: number, steps = 4): Scale {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: [0, 1] };

  const brut = max / steps;
  const magnitude = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((facteur) => facteur * magnitude).find((valeur) => valeur >= brut)
    ?? 10 * magnitude;

  const top = Math.ceil(max / pas) * pas;
  const ticks: number[] = [];
  // La tolérance évite qu'une addition de flottants perde la dernière graduation.
  for (let valeur = 0; valeur <= top + pas / 1000; valeur += pas) {
    ticks.push(Math.round(valeur * 1000) / 1000);
  }
  return { top, ticks };
}

/** Hauteur d'une barre en pourcentage, avec un minimum visible pour un zéro. */
export function barHeight(value: number, top: number): string {
  if (value <= 0) return '2px';
  return `${Math.max((value / top) * 100, 1)}%`;
}
