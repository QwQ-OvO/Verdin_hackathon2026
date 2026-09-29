-- Step 1 stores the synthetic task and its source material. Tables for later
-- workflow steps are created now so subsequent migrations can add behavior.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('learner', 'manager')),
  team TEXT NOT NULL,
  job_title TEXT NOT NULL,
  starting_point TEXT,
  starting_point_source TEXT
);

CREATE TABLE capabilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  observable_behavior TEXT NOT NULL
);

CREATE TABLE learner_capabilities (
  learner_id TEXT NOT NULL REFERENCES users(id),
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  evidence_source TEXT NOT NULL,
  PRIMARY KEY (learner_id, capability_id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  is_simulated INTEGER NOT NULL CHECK (is_simulated IN (0, 1)),
  simulation_notice TEXT NOT NULL,
  business_context TEXT NOT NULL,
  objective TEXT NOT NULL,
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  learner_id TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  deadline_at TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  is_reversible INTEGER NOT NULL CHECK (is_reversible IN (0, 1)),
  business_use_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'proposed', 'assigned', 'in_progress', 'first_submitted', 'revision_in_progress', 'pending_review', 'approved', 'changes_requested')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  first_submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE feedback_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  journey_stage TEXT NOT NULL CHECK (journey_stage IN ('application', 'document_upload', 'verification_review', 'account_activation')),
  text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  is_simulated INTEGER NOT NULL CHECK (is_simulated IN (0, 1))
);
CREATE INDEX feedback_items_task_idx ON feedback_items(task_id);

CREATE TABLE organization_groups (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  label TEXT NOT NULL,
  relationship TEXT NOT NULL,
  method TEXT NOT NULL
);
CREATE TABLE organization_group_sources (
  group_id TEXT NOT NULL REFERENCES organization_groups(id),
  feedback_id TEXT NOT NULL REFERENCES feedback_items(id),
  PRIMARY KEY (group_id, feedback_id)
);

CREATE TABLE task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  suggested_owner TEXT NOT NULL CHECK (suggested_owner IN ('ai', 'learner', 'manager')),
  requires_manager_approval INTEGER NOT NULL CHECK (requires_manager_approval IN (0, 1)),
  UNIQUE (task_id, step_key)
);

CREATE TABLE allocations (
  id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  step_id TEXT NOT NULL REFERENCES task_steps(id),
  system_suggestion TEXT NOT NULL,
  rule_ids_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  confirmed_owner TEXT,
  override_reason TEXT,
  confirmed_by TEXT REFERENCES users(id),
  confirmed_at TEXT,
  UNIQUE (task_id, step_id)
);

-- Version 1 is the first judgment. The unique task/version pair prevents a
-- second version 1, and the triggers below prevent rewriting saved evidence.
CREATE TABLE judgment_versions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  parent_version_id TEXT REFERENCES judgment_versions(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  content_json TEXT NOT NULL,
  change_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (task_id, version_number)
);
CREATE TABLE judgment_citations (
  judgment_version_id TEXT NOT NULL REFERENCES judgment_versions(id),
  feedback_id TEXT NOT NULL REFERENCES feedback_items(id),
  PRIMARY KEY (judgment_version_id, feedback_id)
);

CREATE TABLE hint_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  content TEXT NOT NULL,
  model_version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  judgment_version_id TEXT NOT NULL REFERENCES judgment_versions(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  feedback TEXT NOT NULL,
  business_use_scope TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);

CREATE TABLE capability_evidence (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  learner_id TEXT NOT NULL REFERENCES users(id),
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  observations_json TEXT NOT NULL,
  support_recommendation TEXT NOT NULL CHECK (support_recommendation IN ('reduce', 'maintain', 'increase')),
  recommendation_reason TEXT NOT NULL,
  confirmed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- Every state change records the actor and timestamp in the same transaction.
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  occurred_at TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX audit_events_task_time_idx ON audit_events(task_id, occurred_at, id);

-- Preserve original judgments, help, and audit history even after revisions.
CREATE TRIGGER judgment_versions_no_update BEFORE UPDATE ON judgment_versions BEGIN SELECT RAISE(ABORT, 'judgment versions are append-only'); END;
CREATE TRIGGER judgment_versions_no_delete BEFORE DELETE ON judgment_versions BEGIN SELECT RAISE(ABORT, 'judgment versions are append-only'); END;
CREATE TRIGGER hint_events_no_update BEFORE UPDATE ON hint_events BEGIN SELECT RAISE(ABORT, 'hint events are append-only'); END;
CREATE TRIGGER hint_events_no_delete BEFORE DELETE ON hint_events BEGIN SELECT RAISE(ABORT, 'hint events are append-only'); END;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
