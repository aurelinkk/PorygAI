/**
 * Formules d'abonnement : le choix (cartes radio) et les jauges de consommation.
 *
 * Les plafonds affichés viennent de `shared/src/plans.ts`, la même source que
 * celle appliquée par le serveur : la jauge ne peut pas annoncer autre chose que
 * ce qui sera réellement refusé.
 */
import { PLAN_LIST, formatLimit, type Plan } from '@poryg/shared';
import { cx } from '../lib/format';

interface PlanChoiceProps {
  id: string;
  value: Plan;
  onChange: (plan: Plan) => void;
  /** Formule en cours, marquée « actuelle » sur la page de réglages. */
  current?: Plan;
  /** Formules impossibles à choisir, avec la raison (contenu trop volumineux). */
  disabledReason?: Partial<Record<Plan, string>>;
  legend?: string;
}

export function PlanChoice({ id, value, onChange, current, disabledReason = {}, legend = 'Formule' }: PlanChoiceProps) {
  return (
    <fieldset id={id} className="field field--group">
      <legend className="field__label">{legend}</legend>
      <p id={`${id}-hint`} className="field__hint">
        Une formule ne limite que le nombre d'applications et de personnes : toutes les fonctionnalités du
        registre restent disponibles. Aucun paiement n'est encaissé par cette maquette.
      </p>
      <div className="plans">
        {PLAN_LIST.map((plan) => {
          const optionId = `${id}-${plan.code}`;
          const empeche = disabledReason[plan.code];
          return (
            <label
              key={plan.code}
              htmlFor={optionId}
              className={cx('plan', value === plan.code && 'plan--selected', empeche && 'plan--disabled')}
            >
              <span className="plan__head">
                {/*
                  Le <label> englobe toute la carte : son texte ferait un nom
                  accessible interminable (« Découverte Gratuit Pour essayer… »).
                  On nomme donc le bouton radio par le seul couple nom + prix, et
                  l'on renvoie le reste en description.
                */}
                <input
                  id={optionId}
                  type="radio"
                  name={id}
                  value={plan.code}
                  checked={value === plan.code}
                  disabled={Boolean(empeche)}
                  onChange={() => onChange(plan.code)}
                  aria-labelledby={`${optionId}-name ${optionId}-price`}
                  aria-describedby={`${optionId}-detail`}
                />
                <span id={`${optionId}-name`} className="plan__name">
                  {plan.label}
                </span>
                {current === plan.code && <span className="plan__current">Formule actuelle</span>}
              </span>

              <span id={`${optionId}-price`} className="plan__price">
                {plan.priceEurPerMonth === 0 ? (
                  'Gratuit'
                ) : (
                  <>
                    {plan.priceEurPerMonth} € <span className="plan__period">/ mois</span>
                  </>
                )}
              </span>

              <span id={`${optionId}-detail`} className="plan__detail">
                <span className="plan__tagline">{plan.tagline}</span>
                <span className="plan__features">
                  {plan.features.map((feature) => (
                    <span key={feature} className="plan__feature">
                      {feature}
                    </span>
                  ))}
                </span>
                {empeche && <span className="plan__blocked">{empeche}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface QuotaGaugeProps {
  label: string;
  used: number;
  /** `null` : formule sans plafond. */
  max: number | null;
}

/**
 * Jauge de consommation. Le chiffre porte l'information ; la barre n'est qu'un
 * repère visuel (`aria-hidden`), pour ne rien confier à la seule couleur.
 */
export function QuotaGauge({ label, used, max }: QuotaGaugeProps) {
  const ratio = max === null ? 0 : Math.min(1, used / max);
  const plein = max !== null && used >= max;

  return (
    <div className={cx('quota', plein && 'quota--full')}>
      <p className="quota__head">
        <span className="quota__label">{label}</span>
        <span className="quota__value mono">
          {used} / {formatLimit(max)}
        </span>
      </p>
      <div className="quota__track" aria-hidden="true">
        <div className="quota__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      {plein && <p className="quota__warning">Plafond atteint : changez de formule pour en ajouter.</p>}
    </div>
  );
}
