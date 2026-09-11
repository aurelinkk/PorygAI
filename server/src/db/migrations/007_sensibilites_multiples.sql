-- ============================================================================
-- 007 : une application croise plusieurs natures de données.
--
-- Jusqu'ici la déclaration retenait « le niveau le plus élevé parmi les données
-- traitées » : une seule valeur. C'est faux dans la plupart des cas réels : un
-- assistant de recrutement traite à la fois des données internes (les offres) et
-- des données personnelles (les candidatures), et la fiche ne montrait que la
-- seconde. On saisit désormais tout ce qui est traité.
--
-- Deux colonnes, et une seule source de vérité :
--   * `data_sensitivities_json` : ce qui est SAISI, la liste complète ;
--   * `data_sensitivity`        : le niveau le plus élevé, **dérivé** de la liste
--     à chaque écriture (`highestSensitivity`, dans shared/src/referentiels.ts).
--
-- Garder la valeur dérivée n'est pas une duplication de confort : c'est elle que
-- lisent les répartitions des tableaux de bord et du rapport FinOps, le filtre
-- d'inventaire et la règle « avis DPO attendu ». Sans elle, un comptage par
-- sensibilité compterait deux fois une application qui coche deux cases, et la
-- somme des parts dépasserait 100 %. La règle à tenir : la liste est saisie, le
-- niveau est calculé, jamais l'inverse.
--
-- Pas de reconstruction de table : `ALTER TABLE ADD COLUMN` suffit (aucune
-- contrainte existante n'est touchée), donc pas besoin du mode « no-transaction ».
-- ============================================================================

ALTER TABLE applications
  ADD COLUMN data_sensitivities_json TEXT NOT NULL DEFAULT '[]';

-- Reprise de l'existant : la valeur unique devient une liste d'un élément, dont
-- elle reste évidemment le maximum. Rien à recalculer.
UPDATE applications
   SET data_sensitivities_json = json_array(data_sensitivity);
