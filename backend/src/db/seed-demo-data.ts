import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const seedDirectory = new URL('../../seed/onboarding-demo/', import.meta.url);

/** Read checked-in synthetic fixtures without treating them as live customer records. */
function readSeed(name: string): any {
  return JSON.parse(readFileSync(new URL(name, seedDirectory), 'utf8'));
}

/** Import the fixed demo once; restarting the API must not reset task progress. */
export function seedOnboardingDemo(db: DatabaseSync): void {
  const task = readSeed('task.json');
  if (db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(task.id)) return;

  const users = readSeed('users.json').users;
  const feedback = readSeed('feedback.json');
  const organization = readSeed('organization.json');
  if (feedback.source_record_id !== task.source_record_id || organization.source_record_id !== task.source_record_id) {
    throw new Error('Seed source records do not match');
  }

  // The task, source comments, and traceability links must appear together.
  db.exec('BEGIN IMMEDIATE');
  try {
    const insertUser = db.prepare(`INSERT INTO users
      (id, display_name, role, team, job_title, starting_point, starting_point_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const user of users) {
      insertUser.run(user.id, user.display_name, user.role, user.team, user.job_title, user.starting_point ?? null, user.starting_point_source ?? null);
    }

    db.prepare('INSERT INTO capabilities (id, name, observable_behavior) VALUES (?, ?, ?)')
      .run(task.capability.id, task.capability.name, task.capability.observable_behavior);
    const learner = users.find((user: any) => user.id === task.learner_id);
    db.prepare('INSERT INTO learner_capabilities (learner_id, capability_id, evidence_source) VALUES (?, ?, ?)')
      .run(task.learner_id, task.capability.id, learner.starting_point_source);

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO tasks
      (id, title, source_record_id, source_type, is_simulated, simulation_notice,
       business_context, objective, capability_id, learner_id, reviewer_id, deadline_at,
       risk_level, is_reversible, business_use_scope, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(task.id, task.title, task.source_record_id, task.source_type, Number(task.is_simulated),
        task.simulation_notice, task.business_context, task.objective, task.capability.id,
        task.learner_id, task.reviewer_id, task.deadline_at, task.risk_level,
        Number(task.is_reversible), task.business_use_scope, task.status, now, now);

    const insertFeedback = db.prepare(`INSERT INTO feedback_items
      (id, task_id, journey_stage, text, source_type, is_simulated) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const item of feedback.items) {
      if (item.source_type !== task.source_type || item.is_simulated !== true) throw new Error(`Invalid feedback provenance: ${item.id}`);
      insertFeedback.run(item.id, task.id, item.journey_stage, item.text, item.source_type, 1);
    }

    const insertGroup = db.prepare(`INSERT INTO organization_groups
      (id, task_id, label, relationship, method) VALUES (?, ?, ?, ?, ?)`);
    const insertGroupSource = db.prepare('INSERT INTO organization_group_sources (group_id, feedback_id) VALUES (?, ?)');
    for (const group of organization.groups) {
      insertGroup.run(group.id, task.id, group.label, group.relationship, organization.method);
      for (const id of group.source_ids) insertGroupSource.run(group.id, id);
    }

    const insertStep = db.prepare(`INSERT INTO task_steps
      (id, task_id, step_key, label, suggested_owner, requires_manager_approval)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const step of task.task_steps) {
      insertStep.run(step.id, task.id, step.key, step.label, step.suggested_owner, Number(step.requires_manager_approval));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
