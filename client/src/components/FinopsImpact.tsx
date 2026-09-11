/**
 * Impact FinOps de l'application, annoncé à la fin du questionnaire.
 *
 * Deux lectures, dans cet ordre :
 *
 *  1. **L'estimation** : calculée depuis les réponses de gouvernance (type d'IA,
 *     fréquence d'entraînement, volume d'inférence, hébergement). Ce sont des
 *     ordres de grandeur ; les hypothèses sont affichées, sinon l'estimation ne
 *     se discute pas.
 *  2. **Le relevé** : la projection des mois réellement déclarés au module
 *     FinOps. Dès qu'il existe, c'est lui qui fait foi, et l'écart avec
 *     l'estimation est dit en toutes lettres.
 *
 * Sans réponse ni relevé, on n'affiche pas un chiffre plausible : on dit ce qui
 * manque. Un chiffre inventé serait pire que pas de chiffre du tout.
 */
import { Link } from 'react-router-dom';
import {
  AI_TYPES, carKmEquivalent, estimateCarbonFootprint, labelOf,
  type Answers, type FinopsAdjustment, type FinopsImpactDto,
} from '@poryg/shared';
import { formatCo2, formatEur, formatKwh } from '../lib/format';
import { Card } from './ui/Card';

interface FinopsImpactProps {
  /** Relevé réel, `null` sans `finops:read`. */
  impact: FinopsImpactDto | null;
  answers: Answers;
  /** Type d'IA de l'application : première entrée du modèle d'estimation. */
  aiType: string;
  applicationId: number;
  /** Ajustement de score produit par la gouvernance FinOps. */
  adjustment: FinopsAdjustment;
}

export function FinopsImpact({ impact, answers, aiType, applicationId, adjustment }: FinopsImpactProps) {
  const texte = (code: string) => (typeof answers[code] === 'string' ? (answers[code] as string) : undefined);
  const parametres = Number(texte('GF9'));
  const estimate = estimateCarbonFootprint({
    aiType,
    training: texte('GF5'),
    inference: texte('GF6'),
    hosting: texte('GF7'),
    modelSize: texte('GF8'),
    modelParamsM: Number.isFinite(parametres) && parametres > 0 ? parametres : undefined,
    requestSize: texte('GF10'),
    trainingData: texte('GF11'),
  });
  const releve = impact && impact.monthsObserved > 0 ? impact : null;

  return (
    <Card title="Impact FinOps de la solution" titleId="impact-title" className="impact">
      {!estimate.complete && !releve && (
        <p>
          Ni estimation ni relevé : répondez aux questions de{' '}
          <strong>gouvernance FinOps</strong> (fréquence d'entraînement, volume, hébergement) pour obtenir un
          ordre de grandeur, ou <Link to={`/applications/${applicationId}`}>saisissez un premier mois</Link>{' '}
          de coût réel.
        </p>
      )}

      {estimate.complete && (
        <section className="impact__block">
          <h3 className="subsection-title">Estimation, avant toute mesure</h3>
          <p className="muted">
            Calculée pour une IA de type « {labelOf(AI_TYPES, aiType)} » à partir du calcul qu'elle demande :
            environ 2 × N opérations par token en inférence, 6 × N par token vu en entraînement, converties en
            énergie puis en carbone selon la région d'hébergement déclarée.
          </p>

          <ul className="impact__figures">
            <li className="impact__figure">
              <span className="impact__value">{formatKwh(estimate.energyKwh)}</span>
              <span className="impact__label">
                consommés par an, entre {formatKwh(estimate.energyKwhLow)} et {formatKwh(estimate.energyKwhHigh)}
              </span>
            </li>
            <li className="impact__figure impact__figure--accent">
              <span className="impact__value">{formatCo2(estimate.co2Kg)}</span>
              <span className="impact__label">
                émis par an, entre {formatCo2(estimate.co2KgLow)} et {formatCo2(estimate.co2KgHigh)}
              </span>
            </li>
            <li className="impact__figure">
              <span className="impact__value">{Math.round(estimate.trainingShare * 100)} %</span>
              <span className="impact__label">dus à l'entraînement</span>
            </li>
          </ul>

          {estimate.co2Kg > 0 && (
            <p>
              Soit l'ordre de grandeur de{' '}
              <strong>{carKmEquivalent(estimate.co2Kg).toLocaleString('fr-FR')} km</strong> en voiture
              thermique.
            </p>
          )}

          <details className="impact__assumptions">
            <summary>Hypothèses du calcul</summary>
            <dl className="impact__hypotheses">
              {estimate.assumptions.map((assumption) => (
                <div key={assumption.label}>
                  <dt>{assumption.label}</dt>
                  <dd className="mono">{assumption.value}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              Le calcul suit deux formules de référence du domaine : <span className="mono">2 × N</span>{' '}
              opérations par token en inférence, <span className="mono">6 × N × D</span> pour un entraînement
              sur D tokens. La seule constante ajustée est le rendement énergétique, calé sur des mesures
              publiées (Llama 3.1 405B et Mixtral 8x22B en inférence, Llama 2 7B en entraînement) ; le
              questionnaire fournit tout le reste. La fourchette reflète la dispersion réelle de ces mesures,
              d'environ un facteur deux de part et d'autre : c'est un ordre de grandeur, pas un relevé. Dès
              qu'une mesure existe sur cette application, c'est elle qui fait foi.
            </p>
            <p className="muted">
              Trois postes ne sont <strong>pas</strong> comptés, faute de données pour les estimer sans les
              inventer : le serveur qui tourne en permanence autour du modèle (sur une application peu
              sollicitée, c'est lui qui domine, et le chiffre ci-dessus paraîtra très bas), le carbone de
              fabrication du matériel, et le stockage des données d'entraînement.
            </p>
          </details>
        </section>
      )}

      {releve && (
        <section className="impact__block">
          <h3 className="subsection-title">Relevé réel</h3>
          <p className="muted">
            Projection sur douze mois, d'après {releve.monthsObserved} mois réellement déclaré
            {releve.monthsObserved > 1 ? 's' : ''} au module FinOps. C'est ce relevé qui fait foi.
          </p>

          <ul className="impact__figures">
            <li className="impact__figure">
              <span className="impact__value">{formatEur(releve.yearly.amountEur)}</span>
              <span className="impact__label">de coût sur un an</span>
            </li>
            <li className="impact__figure">
              <span className="impact__value">
                {releve.yearly.energyKwh > 0 ? formatKwh(releve.yearly.energyKwh) : ':'}
              </span>
              <span className="impact__label">
                {releve.yearly.energyKwh > 0 ? 'consommés' : 'consommation non déclarée'}
              </span>
            </li>
            <li className="impact__figure impact__figure--accent">
              <span className="impact__value">
                {releve.yearly.co2Kg > 0 ? formatCo2(releve.yearly.co2Kg) : ':'}
              </span>
              <span className="impact__label">
                {releve.yearly.co2Kg > 0 ? 'émis' : 'empreinte non calculable'}
              </span>
            </li>
          </ul>

          {estimate.complete && releve.yearly.co2Kg > 0 && (
            <p className={ecart(estimate.co2Kg, releve.yearly.co2Kg) ? 'notice notice--info' : 'muted'}>
              {comparaison(estimate.co2Kg, releve.yearly.co2Kg)}
            </p>
          )}

          {releve.co2Derived && (
            <p className="notice notice--info">
              L'empreinte relevée n'a pas été déclarée : elle est <strong>calculée</strong> depuis la
              consommation, avec l'intensité de la région d'hébergement renseignée au questionnaire
              ({releve.co2Intensity} kg CO₂/kWh). Sans réponse sur l'hébergement, c'est l'hypothèse
              défavorable qui s'applique : déclarez l'empreinte, ou répondez à la question GF7.
            </p>
          )}
        </section>
      )}

      {adjustment.details.length > 0 && (
        <section className="impact__block">
          <h3 className="subsection-title">Effet sur le score</h3>
          <p>
            La gouvernance FinOps déclarée{' '}
            {adjustment.points === 0 ? (
              <>ne change pas le score</>
            ) : (
              <>
                {adjustment.points > 0 ? 'ajoute' : 'retire'}{' '}
                <strong>
                  {Math.abs(adjustment.points)} point{Math.abs(adjustment.points) > 1 ? 's' : ''}
                </strong>{' '}
                {adjustment.points > 0 ? 'au' : 'du'} score de base ({adjustment.baseScore}/100)
              </>
            )}
            .
          </p>
          <ul className="impact__adjustment">
            {adjustment.details.map((detail) => (
              <li key={detail.code}>
                <span className="mono table__meta">{detail.code}</span> {detail.label}
                <span className={`impact__delta impact__delta--${signe(detail.delta)}`}>
                  {detail.delta > 0 ? `+${detail.delta}` : detail.delta}
                </span>
              </li>
            ))}
          </ul>
          {adjustment.floored && (
            <p className="notice notice--info">
              Le malus a été limité : l'approche FinOps retire des points, mais ne rend jamais une
              application non conforme à elle seule.
            </p>
          )}
        </section>
      )}
    </Card>
  );
}

const signe = (delta: number) => (delta > 0 ? 'plus' : delta < 0 ? 'moins' : 'neutre');

/** Écart significatif entre estimation et relevé : au-delà du double, ou en dessous de la moitié. */
const ecart = (estime: number, releve: number) => estime > releve * 2 || estime < releve / 2;

function comparaison(estime: number, releve: number): string {
  const facteur = estime > releve ? estime / releve : releve / estime;
  if (facteur < 1.5) return "L'estimation et le relevé concordent : le modèle de calcul tient pour cette application.";
  const sens = estime > releve ? 'surestime' : 'sous-estime';
  return `L'estimation ${sens} le relevé d'un facteur ${facteur.toFixed(1)}. C'est le relevé qui fait foi ;`
    + " l'écart peut venir d'un volume réel différent de la tranche déclarée, ou d'un hébergement mal renseigné.";
}
