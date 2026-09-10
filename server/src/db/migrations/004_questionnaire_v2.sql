-- migrate: no-transaction
-- ============================================================================
-- 004 : Questionnaire v2 : score sur 100, verdict à trois niveaux, nouveau
-- statut « partiellement conforme ».
--
-- SQLite ne sait pas modifier une contrainte CHECK : on reconstruit les tables
-- concernées selon la procédure documentée (créer, copier, supprimer, renommer,
-- recréer index et triggers). Les clés étrangères sont désactivées le temps de
-- l'opération, ce qui impose d'être hors transaction pour le PRAGMA ; la
-- reconstruction elle-même est atomique (BEGIN … COMMIT).
--
-- Les évaluations v1 déjà soumises sont conservées telles quelles : leur
-- `decision` devient `verdict`, leurs critères éliminatoires `capped_by_json`.
-- ============================================================================

PRAGMA foreign_keys = OFF;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. applications : ajout du statut partially_compliant
-- ---------------------------------------------------------------------------
CREATE TABLE applications_v2 (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  code                   TEXT NOT NULL UNIQUE,
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
  deleted_at             TEXT
);

INSERT INTO applications_v2
  (id, code, name, description, business_domain, data_sensitivity, ai_type, process_owner_id,
   status, compliance_valid_until, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at)
SELECT
   id, code, name, description, business_domain, data_sensitivity, ai_type, process_owner_id,
   status, compliance_valid_until, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at
FROM applications;

DROP TABLE applications;
ALTER TABLE applications_v2 RENAME TO applications;

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_owner ON applications(process_owner_id);

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
-- 2. evaluations : verdict à quatre valeurs, plafonds, blocage, sous-scores
-- ---------------------------------------------------------------------------
CREATE TABLE evaluations_v2 (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id        INTEGER NOT NULL REFERENCES applications(id),
  questionnaire_version TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),

  tool_vendor           TEXT NOT NULL DEFAULT '',
  purpose               TEXT NOT NULL DEFAULT '',
  business_criticality  TEXT CHECK (business_criticality IN ('low', 'medium', 'high')),

  -- Résultat, calculé par le serveur à la soumission.
  -- v1 : score sur 18 · v2 : score sur 100 (max_score le précise).
  score                 INTEGER,
  max_score             INTEGER NOT NULL,
  verdict               TEXT CHECK (verdict IN ('compliant', 'partially_compliant', 'non_compliant', 'blocked')),
  capped_by_json        TEXT NOT NULL DEFAULT '[]',   -- critiques manquées (v2) / éliminatoires à 0 (v1)
  blocked_by            TEXT,                          -- question ayant refusé l'évaluation (v2)
  sections_json         TEXT NOT NULL DEFAULT '[]',   -- sous-scores par section (v2)

  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  submitted_by          INTEGER REFERENCES users(id),
  submitted_at          TEXT
);

INSERT INTO evaluations_v2
  (id, application_id, questionnaire_version, status, tool_vendor, purpose, business_criticality,
   score, max_score, verdict, capped_by_json, blocked_by, sections_json,
   created_by, created_at, updated_at, submitted_by, submitted_at)
SELECT
   id, application_id, questionnaire_version, status, tool_vendor, purpose, business_criticality,
   score, max_score, decision, red_flags_json, NULL, '[]',
   created_by, created_at, updated_at, submitted_by, submitted_at
FROM evaluations;

DROP TABLE evaluations;
ALTER TABLE evaluations_v2 RENAME TO evaluations;

CREATE INDEX idx_evaluations_application ON evaluations(application_id);
CREATE UNIQUE INDEX idx_evaluations_one_draft ON evaluations(application_id) WHERE status = 'draft';

CREATE TRIGGER trg_evaluations_no_delete BEFORE DELETE ON evaluations
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (evaluations)');
END;

CREATE TRIGGER trg_evaluations_submitted_frozen BEFORE UPDATE ON evaluations
WHEN OLD.status = 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'Une évaluation soumise ne peut plus être modifiée');
END;

-- ---------------------------------------------------------------------------
-- 3. evaluation_answers : une réponse peut être un nombre, un choix ou une
--    liste de choix → stockée en JSON dans un TEXT. Les valeurs v1 (0/1/2)
--    deviennent '0' / '1' / '2', que JSON.parse relit en nombres.
-- ---------------------------------------------------------------------------
CREATE TABLE evaluation_answers_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
  question_code TEXT NOT NULL,
  value_json    TEXT NOT NULL,
  comment       TEXT NOT NULL DEFAULT '',
  UNIQUE (evaluation_id, question_code)
);

INSERT INTO evaluation_answers_v2 (id, evaluation_id, question_code, value_json, comment)
SELECT id, evaluation_id, question_code, CAST(value AS TEXT), comment
FROM evaluation_answers;

DROP TABLE evaluation_answers;
ALTER TABLE evaluation_answers_v2 RENAME TO evaluation_answers;

COMMIT;

PRAGMA foreign_keys = ON;
