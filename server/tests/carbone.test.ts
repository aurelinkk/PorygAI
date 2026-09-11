/**
 * Calibration du modèle d'empreinte carbone.
 *
 * Le calcul repose sur deux formules du domaine (`2ND` en inférence, `6ND` en
 * entraînement) et sur **une seule constante**, `FLOPS_PER_JOULE`. Ces tests
 * confrontent cette constante à des mesures publiées : si quelqu'un la modifie,
 * il verra immédiatement de combien il s'éloigne des relevés connus.
 *
 * Tolérance retenue : un facteur 1,5. Les mesures publiées elles-mêmes s'étalent
 * sur un intervalle interquartile d'environ 0,5× à 2× leur médiane ; exiger
 * mieux serait exiger une précision que le domaine n'a pas.
 */
import { describe, expect, it } from 'vitest';
import {
  CHINCHILLA_TOKENS_PER_PARAM, ESTIMATE_UNCERTAINTY, estimateCarbonFootprint, inferenceWh, trainingKwh,
} from '@poryg/shared';

/** Longueur d'un échange typique dans les protocoles de mesure cités. */
const REQUETE_TYPE = 800;

/** `attendu` et `obtenu` sont-ils dans un rapport inférieur à `facteur` ? */
function proche(obtenu: number, attendu: number, facteur = 1.5): boolean {
  const rapport = obtenu > attendu ? obtenu / attendu : attendu / obtenu;
  return rapport <= facteur;
}

describe('empreinte : calibration sur les mesures publiées', () => {
  // Sources : arXiv 2509.20241 / Nature Energy 2026 (médiane 0,31 Wh, IQR 0,16–0,60
  // pour les modèles frontière) ; arXiv 2505.09598 pour Llama 3.1 405B et Mixtral.
  const mesures = [
    { nom: 'Llama 3.1 405B (dense)', paramsM: 405_000, publie: 0.39 },
    { nom: 'Mixtral 8x22B (39 Md actifs)', paramsM: 39_000, publie: 0.06 },
    { nom: 'Modèle frontière (~280 Md actifs)', paramsM: 280_000, publie: 0.31 },
  ];

  it.each(mesures)('inférence : $nom ≈ $publie Wh', ({ paramsM, publie }) => {
    const obtenu = inferenceWh(paramsM, REQUETE_TYPE);
    expect(proche(obtenu, publie), `obtenu ${obtenu.toFixed(3)} Wh, publié ${publie} Wh`).toBe(true);
  });

  it('entraînement : Llama 2 7B ≈ 74 000 kWh', () => {
    // 184 320 heures de GPU A100 à 400 W, pour 2 000 milliards de tokens.
    const publie = (184_320 * 400) / 1000; // 73 728 kWh
    const obtenu = trainingKwh(7_000, 2e12);
    expect(proche(obtenu, publie), `obtenu ${Math.round(obtenu)} kWh, publié ${Math.round(publie)} kWh`).toBe(true);
  });

  it("un pré-entraînement croît comme le CARRÉ de la taille, un ajustement linéairement", () => {
    // Ajustement sur un corpus fixe : D ne bouge pas, l'énergie suit N.
    const ajustePetit = trainingKwh(7_000, 1e9);
    const ajusteGrand = trainingKwh(70_000, 1e9);
    expect(ajusteGrand / ajustePetit).toBeCloseTo(10, 5);

    // Pré-entraînement compute-optimal : D = 20 × N, donc l'énergie suit N².
    const preentrainePetit = trainingKwh(7_000, CHINCHILLA_TOKENS_PER_PARAM * 7_000e6);
    const preentraineGrand = trainingKwh(70_000, CHINCHILLA_TOKENS_PER_PARAM * 70_000e6);
    expect(preentraineGrand / preentrainePetit).toBeCloseTo(100, 5);
  });
});

describe('empreinte : cohérence des scénarios', () => {
  const base = { aiType: 'genai', hosting: 'cloud', modelSize: 'medium', requestSize: 'medium' };

  it("l'inférence domine dès que le trafic est important", () => {
    // C'est le constat de la littérature récente : sur un modèle réellement
    // déployé, l'inférence pèse l'essentiel du cycle de vie.
    const gros = estimateCarbonFootprint({
      ...base, inference: 'very_high', training: 'periodic', trainingData: 'standard',
    });
    expect(gros.trainingShare).toBeLessThan(0.2);
  });

  it("l'entraînement domine quand le trafic est faible et le réentraînement fréquent", () => {
    const petit = estimateCarbonFootprint({
      ...base, inference: 'low', training: 'continuous', trainingData: 'heavy',
    });
    expect(petit.trainingShare).toBeGreaterThan(0.9);
  });

  it('sans réponse sur la taille des échanges, un modèle de scoring ne paie pas le prix d’un LLM', () => {
    const scoring = estimateCarbonFootprint({
      aiType: 'ml_predictive', hosting: 'cloud', modelSize: 'small',
      inference: 'high', training: 'periodic', trainingData: 'light',
    });
    const llm = estimateCarbonFootprint({ ...base, inference: 'high', training: 'periodic', trainingData: 'light' });
    expect(scoring.energyKwh).toBeLessThan(llm.energyKwh);
  });

  it('la fourchette encadre la valeur centrale', () => {
    const e = estimateCarbonFootprint({ ...base, inference: 'high', training: 'once', trainingData: 'standard' });
    expect(e.energyKwhLow).toBeLessThanOrEqual(e.energyKwh);
    expect(e.energyKwhHigh).toBeGreaterThanOrEqual(e.energyKwh);
    expect(e.energyKwhHigh / e.energyKwhLow).toBeCloseTo(ESTIMATE_UNCERTAINTY ** 2, 1);
  });

  it("n'invente rien tant qu'une réponse nécessaire manque", () => {
    expect(estimateCarbonFootprint({ aiType: 'genai', inference: 'high' }).complete).toBe(false);
    expect(estimateCarbonFootprint({ aiType: 'genai', inference: 'high', training: 'none' }).complete).toBe(false);
  });

  it('un hébergement bas carbone réduit l’empreinte sans changer la consommation', () => {
    const commun = { ...base, inference: 'high', training: 'none', trainingData: 'light' } as const;
    const sale = estimateCarbonFootprint({ ...commun, hosting: 'cloud_high_carbon' });
    const propre = estimateCarbonFootprint({ ...commun, hosting: 'cloud_low_carbon' });

    expect(propre.co2Kg).toBeLessThan(sale.co2Kg / 10); // 0,03 contre 0,6 kg/kWh
    // Le PUE diffère un peu (1,2 contre 1,3), mais l'énergie reste du même ordre.
    expect(proche(propre.energyKwh, sale.energyKwh, 1.2)).toBe(true);
  });
});
