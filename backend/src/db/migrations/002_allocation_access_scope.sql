-- Persist the source boundary used by the allocation rules. Missing access
-- records fail closed; the backfill covers databases created before Step 2.
CREATE TABLE task_access_scopes (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  allowed_feedback_source_id TEXT NOT NULL,
  contains_personal_data INTEGER NOT NULL CHECK (contains_personal_data IN (0, 1)),
  learner_may_read_original_feedback INTEGER NOT NULL CHECK (learner_may_read_original_feedback IN (0, 1)),
  learner_may_change_verification_rules INTEGER NOT NULL CHECK (learner_may_change_verification_rules IN (0, 1)),
  learner_may_approve_business_use INTEGER NOT NULL CHECK (learner_may_approve_business_use IN (0, 1))
);

ALTER TABLE allocations ADD COLUMN hard_blockers_json TEXT NOT NULL DEFAULT '[]';

INSERT INTO task_access_scopes
  (task_id, allowed_feedback_source_id, contains_personal_data,
   learner_may_read_original_feedback, learner_may_change_verification_rules,
   learner_may_approve_business_use)
SELECT id, source_record_id, 0, 1, 0, 0
FROM tasks
WHERE id = 'TASK-ONB-001' AND source_type = 'simulated_product_feedback';

-- Refresh only the untouched original demo deadline. Later starts never
-- change a task that has entered the workflow or already used a new deadline.
UPDATE tasks
SET deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+72 hours')
WHERE id = 'TASK-ONB-001' AND status = 'draft'
  AND deadline_at = '2026-10-02T17:00:00+10:00';
