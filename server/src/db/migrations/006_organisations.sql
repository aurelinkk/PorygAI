-- migrate: no-transaction
-- ============================================================================
-- 006 : Organisations, appartenances et formules d'abonnement.
--
-- Jusqu'ici le registre était mono-entreprise : tout le monde voyait le même
-- inventaire, et le rôle était un attribut du compte. Une même personne pouvant
-- travailler pour plusieurs organisations, deux choses changent :
--
--   1. Chaque application appartient à UNE organisation (`applications.
--      organization_id`). C'est le seul cloisonnement nécessaire : évaluations,
--      coûts et plans d'action pendent d'une application, ils héritent donc de
--      son organisation sans avoir à la recopier (une copie finirait par
--      diverger).
--   2. Le rôle quitte `users` pour `memberships` : il devient un rôle DANS une
--      organisation. Le compte, lui, ne porte plus que l'identité (adresse,
--      nom, mot de passe ou identifiant Google).
--
-- La session mémorise l'organisation active (`sessions.organization_id`) : le
-- choix est donc pris côté serveur, pas dans une préférence du navigateur qu'un
-- client pourrait contourner.
--
-- Reconstruction de `applications` : SQLite ne sait pas ajouter une colonne
-- NOT NULL qui référence une autre table (il exige un défaut NULL). On applique
-- la procédure documentée, hors transaction pour pouvoir couper les clés
-- étrangères (voir db/migrate.ts).
--
-- Données existantes : tout est versé dans une organisation « Organisation
-- principale », en formule Entreprise afin qu'aucun plafond n'apparaisse du
-- jour au lendemain sur une base déjà remplie. L'AI Officer peut la renommer.
-- ============================================================================

PRAGMA foreign_keys = OFF;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Les organisations
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  -- Identifiant lisible, unique, insensible à la casse : sert d'affichage court
  -- et empêche deux organisations d'être confondues dans une liste.
  slug            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  plan            TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'team', 'business')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  plan_changed_at TEXT,
  deleted_by      INTEGER REFERENCES users(id),
  deleted_at      TEXT
);

-- ---------------------------------------------------------------------------
-- 2. Les appartenances : qui est dans quelle organisation, et avec quel rôle.
--
-- Une personne peut appartenir à plusieurs organisations (d'où l'absence de
-- rôle sur `users`), mais une seule fois à chacune (UNIQUE).
-- Retirer quelqu'un ne supprime pas la ligne : `status = 'disabled'` conserve
-- la trace de son passage, sans quoi l'historique d'audit pointerait vers une
-- appartenance disparue.
-- ---------------------------------------------------------------------------
CREATE TABLE memberships (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  role            TEXT NOT NULL CHECK (role IN ('ai_officer', 'app_manager', 'dpo', 'auditor', 'standard')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  invited_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  disabled_by     INTEGER REFERENCES users(id),
  disabled_at     TEXT,
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id, status);

-- ---------------------------------------------------------------------------
-- 3. L'organisation d'accueil des données existantes.
--    Formule « business » : illimitée, pour qu'une base déjà remplie ne se
--    retrouve pas au-dessus d'un plafond qu'elle n'a jamais choisi.
-- ---------------------------------------------------------------------------
INSERT INTO organizations (id, name, slug, plan, created_by)
VALUES (
  1, 'Organisation principale', 'organisation-principale', 'business',
  (SELECT id FROM users WHERE role = 'ai_officer' ORDER BY id LIMIT 1)
);

INSERT INTO memberships (organization_id, user_id, role, created_at)
SELECT 1, id, role, created_at FROM users;

-- ---------------------------------------------------------------------------
-- 4. applications : rattachement à une organisation (reconstruction)
-- ---------------------------------------------------------------------------
CREATE TABLE applications_v3 (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id        INTEGER NOT NULL REFERENCES organizations(id),
  -- Le code redevient une numérotation PROPRE à l'organisation : chaque registre
  -- commence à APP-0001, et deux organisations ne se marchent pas dessus.
  code                   TEXT NOT NULL,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  business_domain        TEXT NOT NULL,
  data_sensitivity       TEXT NOT NULL,
  ai_type                TEXT NOT NULL,
  process_owner_id       INTEGER NOT NULL REFERENCES users(id),
  status                 TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'in_progress', 'compliant', 'partially_compliant', 'non_compliant', 'deleted')),
  compliance_valid_until TEXT,
  created_by             INTEGER REFERENCES users(id),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by             INTEGER REFERENCES users(id),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_by             INTEGER REFERENCES users(id),
  deleted_at             TEXT,
  UNIQUE (organization_id, code)
);

INSERT INTO applications_v3
  (id, organization_id, code, name, description, business_domain, data_sensitivity, ai_type,
   process_owner_id, status, compliance_valid_until, created_by, created_at, updated_by, updated_at,
   deleted_by, deleted_at)
SELECT
   id, 1, code, name, description, business_domain, data_sensitivity, ai_type,
   process_owner_id, status, compliance_valid_until, created_by, created_at, updated_by, updated_at,
   deleted_by, deleted_at
FROM applications;

DROP TABLE applications;
ALTER TABLE applications_v3 RENAME TO applications;

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_owner ON applications(process_owner_id);
CREATE INDEX idx_applications_organization ON applications(organization_id, status);

CREATE TRIGGER trg_applications_no_delete BEFORE DELETE ON applications
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (applications) : utiliser le statut deleted');
END;

CREATE TRIGGER trg_applications_touch AFTER UPDATE ON applications
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE applications SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- 5. Le rôle quitte le compte. `users` ne porte plus que l'identité.
--    DROP COLUMN suffit ici : `role` n'est ni indexée ni citée par un trigger.
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP COLUMN role;

-- ---------------------------------------------------------------------------
-- 6. La session mémorise l'organisation active.
--    NULL = pas encore choisie : le serveur y place alors la première
--    appartenance de la personne (voir auth/session.ts).
-- ---------------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
UPDATE sessions SET organization_id = 1;

-- ---------------------------------------------------------------------------
-- 7. Garde-fous : ni une organisation ni une appartenance ne se suppriment.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_organizations_no_delete BEFORE DELETE ON organizations
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (organizations) : utiliser le statut deleted');
END;

CREATE TRIGGER trg_memberships_no_delete BEFORE DELETE ON memberships
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (memberships) : utiliser le statut disabled');
END;

COMMIT;

PRAGMA foreign_keys = ON;
