-- ============================================================================
-- 005 : FinOps responsable : l'énergie et le carbone à côté de l'euro.
--
-- Le FinOps classique optimise une seule grandeur : la facture. Le FinOps
-- appliqué à l'IA responsable en suit trois : coût, énergie consommée (kWh) et
-- empreinte carbone (kg CO₂ équivalent) : parce qu'un arbitrage entre un gros
-- modèle et un modèle frugal ne se juge pas sur le seul montant.
--
-- Deux colonnes ajoutées, pas de reconstruction de table : `ALTER TABLE ADD
-- COLUMN` suffit ici (la contrainte UNIQUE existante n'est pas touchée), donc
-- pas besoin du mode « no-transaction ».
--
-- Valeur par défaut 0 et non NULL : une saisie sans empreinte déclarée vaut
-- « zéro connu », pas « inconnu ». La distinction utile : qui a déclaré son
-- empreinte et qui ne l'a pas fait : est portée par l'indicateur de couverture
-- du rapport, calculé sur les lignes dont l'énergie est strictement positive.
-- ============================================================================

ALTER TABLE finops_costs
  ADD COLUMN energy_kwh REAL NOT NULL DEFAULT 0 CHECK (energy_kwh >= 0);

ALTER TABLE finops_costs
  ADD COLUMN co2_kg REAL NOT NULL DEFAULT 0 CHECK (co2_kg >= 0);
