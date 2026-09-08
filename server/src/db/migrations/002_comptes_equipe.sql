-- ============================================================================
-- 002 — Comptes de l'équipe, connectés via le SSO Google.
--
-- `password_hash` est NULL : ces comptes ne peuvent PAS se connecter par mot de
-- passe (le provider local refuse tout compte sans empreinte). Ils passent
-- uniquement par Google.
--
-- `external_id` (l'identifiant Google, claim `sub`) est renseigné
-- automatiquement à la première connexion réussie.
--
-- Le rôle est attribué ici, pas par Google : c'est la règle du projet.
-- Pour changer un rôle plus tard :
--   UPDATE users SET role = 'auditor' WHERE email = 'chatet.maelle@gmail.com';
-- Rôles possibles : ai_officer, app_manager, dpo, auditor, standard
-- ============================================================================

INSERT OR IGNORE INTO users (email, display_name, role, password_hash) VALUES
  ('cleomarinmarie@gmail.com',    'Cléo Marin',       'ai_officer',  NULL),
  ('aurelien.chiquet44@gmail.com', 'Aurélien Chiquet', 'app_manager', NULL),
  ('chatet.maelle@gmail.com',      'Maëlle Chatet',    'dpo',         NULL);
