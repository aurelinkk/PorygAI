-- ============================================================================
-- 003 : Fiche d'évaluation de conformité IA et plans d'action.
--
-- Une application a au plus UNE évaluation en cours (statut 'draft') ; les
-- évaluations soumises sont conservées, ce qui donne l'historique des audits
-- successifs (réévaluation annuelle, réévaluation après modification).
-- ============================================================================

CREATE TABLE evaluations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id        INTEGER NOT NULL REFERENCES applications(id),
  questionnaire_version TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),

  -- Informations préliminaires (non notées, requises à la soumission)
  tool_vendor           TEXT NOT NULL DEFAULT '',
  purpose               TEXT NOT NULL DEFAULT '',
  business_criticality  TEXT CHECK (business_criticality IN ('low', 'medium', 'high')),

  -- Résultat, calculé par le serveur à la soumission
  score                 INTEGER,
  max_score             INTEGER NOT NULL,
  red_flags_json        TEXT NOT NULL DEFAULT '[]',
  decision              TEXT CHECK (decision IN ('compliant', 'non_compliant')),

  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  submitted_by          INTEGER REFERENCES users(id),
  submitted_at          TEXT
);
CREATE INDEX idx_evaluations_application ON evaluations(application_id);

-- Une seule évaluation en cours de saisie par application.
CREATE UNIQUE INDEX idx_evaluations_one_draft
  ON evaluations(application_id) WHERE status = 'draft';

-- ---------------------------------------------------------------------------
-- Réponses. `value` : 2 = Oui, 1 = Partiellement, 0 = Non.
-- `question_code` référence QUESTIONS de shared/src/questionnaire.ts (versionné
-- avec le code, d'où l'absence de table de questions).
-- ---------------------------------------------------------------------------
CREATE TABLE evaluation_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
  question_code TEXT NOT NULL,
  value         INTEGER NOT NULL CHECK (value IN (0, 1, 2)),
  comment       TEXT NOT NULL DEFAULT '',
  UNIQUE (evaluation_id, question_code)
);

-- ---------------------------------------------------------------------------
-- Plans d'action, générés automatiquement pour chaque réponse à 0 ou 1 point.
-- ---------------------------------------------------------------------------
CREATE TABLE action_plans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  evaluation_id  INTEGER REFERENCES evaluations(id),
  question_code  TEXT,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  owner_id       INTEGER REFERENCES users(id),
  due_date       TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_by        INTEGER REFERENCES users(id),
  done_at        TEXT
);
CREATE INDEX idx_action_plans_application ON action_plans(application_id, status);

-- Règle du projet : pas de suppression physique des enregistrements métier.
CREATE TRIGGER trg_evaluations_no_delete BEFORE DELETE ON evaluations
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (evaluations)');
END;

CREATE TRIGGER trg_action_plans_no_delete BEFORE DELETE ON action_plans
BEGIN
  SELECT RAISE(ABORT, 'Suppression physique interdite (action_plans)');
END;

-- Une évaluation soumise est figée : elle est la preuve de l'audit.
CREATE TRIGGER trg_evaluations_submitted_frozen BEFORE UPDATE ON evaluations
WHEN OLD.status = 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'Une évaluation soumise ne peut plus être modifiée');
END;
