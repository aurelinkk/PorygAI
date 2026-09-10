-- ============================================================================
-- 001 : Schéma initial : utilisateurs, sessions, applications, coûts, audit.
-- Dates : texte ISO 8601 UTC (ex. 2026-09-08T14:03:12.345Z), triable en SQL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Utilisateurs. Un seul rôle par utilisateur (voir docs/roles-et-permissions.md).
-- `password_hash` est NULL pour un compte issu du SSO ; `external_id` est
-- l'identifiant fourni par l'IdP (claim `sub` OIDC), NULL pour un compte local.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('ai_officer', 'app_manager', 'dpo', 'auditor', 'standard')),
  password_hash TEXT,
  external_id   TEXT UNIQUE,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- Sessions serveur. Le cookie ne contient que l'`id` (aléatoire, 256 bits).
-- Seule table "technique" : ses lignes peuvent être purgées physiquement.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Applications IA déclarées. Jamais de DELETE : statut 'deleted' + deleted_by/at.
-- ---------------------------------------------------------------------------
CREATE TABLE applications (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  code                   TEXT NOT NULL UNIQUE,            -- APP-0001, attribué à la création
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  business_domain        TEXT NOT NULL,                   -- code référentiel (shared/referentiels.ts)
  data_sensitivity       TEXT NOT NULL,
  ai_type                TEXT NOT NULL,
  process_owner_id       INTEGER NOT NULL REFERENCES users(id),
  status                 TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'in_progress', 'compliant', 'non_compliant', 'deleted')),
  compliance_valid_until TEXT,                            -- renseigné quand status = compliant
  created_by             INTEGER REFERENCES users(id),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by             INTEGER REFERENCES users(id),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_by             INTEGER REFERENCES users(id),
  deleted_at             TEXT
);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_owner ON applications(process_owner_id);

-- ---------------------------------------------------------------------------
-- Coûts FinOps mensuels par application (alimentés manuellement ou par import).
-- ---------------------------------------------------------------------------
CREATE TABLE finops_costs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  period_month   TEXT NOT NULL CHECK (period_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'), -- 'YYYY-MM'
  amount_eur     REAL NOT NULL CHECK (amount_eur >= 0),
  source         TEXT NOT NULL DEFAULT 'manuel',
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (application_id, period_month, source)
);

-- ---------------------------------------------------------------------------
-- Journal d'audit : QUI a fait QUOI, QUAND, sur QUEL enregistrement.
-- `actor_id` NULL = action automatique du système (ex. expiration de conformité).
-- Table en ajout seul : UPDATE et DELETE sont bloqués par trigger.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_id    INTEGER REFERENCES users(id),
  entity      TEXT NOT NULL,       -- 'application', 'user', ...
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,       -- 'create', 'update', 'delete', 'login', ...
  before_json TEXT,
  after_json  TEXT,
  ip          TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_at ON audit_log(at);

-- ---------------------------------------------------------------------------
-- Garde-fous au niveau base : même un accès SQL direct ne peut pas contourner
-- les règles "pas de suppression physique" et "audit immuable".
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_users_no_delete BEFORE DELETE ON users
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (users) : désactiver le compte');
END;

CREATE TRIGGER trg_applications_no_delete BEFORE DELETE ON applications
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (applications) : utiliser le statut deleted');
END;

CREATE TRIGGER trg_finops_no_delete BEFORE DELETE ON finops_costs
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (finops_costs)');
END;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log est immuable (UPDATE interdit)');
END;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log est immuable (DELETE interdit)');
END;

-- Met à jour automatiquement updated_at sur applications.
CREATE TRIGGER trg_applications_touch AFTER UPDATE ON applications
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE applications SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
