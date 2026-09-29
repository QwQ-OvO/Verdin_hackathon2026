import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { openSqliteDatabase, applyDatabaseMigrations } from '../src/db/sqlite-database.ts';
import { seedOnboardingDemo } from '../src/db/seed-demo-data.ts';
import { TaskAllocationService } from '../src/services/task-allocation-service.ts';
import { TaskWorkflowService } from '../src/services/task-workflow-service.ts';

const tempDirs: string[] = [];
after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'apprentice-allocation-'));
  tempDirs.push(directory);
  const db = openSqliteDatabase(path.join(directory, 'demo.sqlite'));
  applyDatabaseMigrations(db);
  seedOnboardingDemo(db);
  const service = new TaskAllocationService(db, () => new Date('2026-09-29T00:00:00.000Z'));
  return { db, service };
}

const managerId = 'USER-MANAGER-001';
const taskId = 'TASK-ONB-001';

test('proposal persists each explained suggestion with status and audit event', async () => {
  const { db, service } = await fixture();
  try {
    const result = service.generateProposal({ taskId, actorId: managerId, expectedVersion: 0 });
    assert.equal(result.status, 'proposed');
    assert.equal(result.version, 1);
    assert.deepEqual(result.steps.map((step) => step.suggestedOwner), ['ai', 'learner', 'learner', 'manager']);
    const saved = db.prepare('SELECT COUNT(*) AS count FROM allocations WHERE task_id = ?').get(taskId) as { count: number };
    const event = db.prepare('SELECT event_type FROM audit_events WHERE task_id = ?').get(taskId) as { event_type: string };
    assert.equal(saved.count, 4);
    assert.equal(event.event_type, 'proposal_generated');
  } finally {
    db.close();
  }
});

test('internal state transition cannot mark a proposal complete without saved allocations', async () => {
  const { db } = await fixture();
  try {
    assert.throws(() => new TaskWorkflowService(db).transition({
      taskId, actorId: managerId, expectedVersion: 0, event: 'proposal_generated',
    }), { statusCode: 409, code: 'missing_allocation_records' });
    const task = db.prepare('SELECT status, version FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
    assert.deepEqual({ ...task }, { status: 'draft', version: 0 });
  } finally {
    db.close();
  }
});

test('internal state transition cannot confirm unsaved owner decisions', async () => {
  const { db, service } = await fixture();
  try {
    service.generateProposal({ taskId, actorId: managerId, expectedVersion: 0 });
    assert.throws(() => new TaskWorkflowService(db).transition({
      taskId, actorId: managerId, expectedVersion: 1, event: 'assignment_confirmed',
    }), { statusCode: 409, code: 'missing_allocation_records' });
    const task = db.prepare('SELECT status, version FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
    assert.deepEqual({ ...task }, { status: 'proposed', version: 1 });
  } finally {
    db.close();
  }
});

test('manager can confirm all steps and record a reasoned soft override', async () => {
  const { db, service } = await fixture();
  try {
    service.generateProposal({ taskId, actorId: managerId, expectedVersion: 0 });
    const result = service.confirmAssignment({
      taskId, actorId: managerId, expectedVersion: 1,
      decisions: [
        { stepId: 'STEP-ORGANIZE', owner: 'ai' },
        { stepId: 'STEP-PATTERNS', owner: 'manager', overrideReason: 'The manager will model the first pattern review.' },
        { stepId: 'STEP-PRIORITIES', owner: 'learner' },
        { stepId: 'STEP-APPROVE', owner: 'manager' },
      ],
    });
    assert.deepEqual(result, { taskId, status: 'assigned', version: 2 });
    const changed = db.prepare('SELECT confirmed_owner, override_reason, confirmed_by FROM allocations WHERE step_id = ?').get('STEP-PATTERNS') as Record<string, unknown>;
    assert.equal(changed.confirmed_owner, 'manager');
    assert.equal(changed.override_reason, 'The manager will model the first pattern review.');
    assert.equal(changed.confirmed_by, managerId);
    const event = db.prepare('SELECT event_type FROM audit_events WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(taskId) as { event_type: string };
    assert.equal(event.event_type, 'assignment_confirmed');
  } finally {
    db.close();
  }
});

test('changed access scope blocks a previously recommended learner assignment atomically', async () => {
  const { db, service } = await fixture();
  try {
    service.generateProposal({ taskId, actorId: managerId, expectedVersion: 0 });
    db.prepare('UPDATE task_access_scopes SET learner_may_read_original_feedback = 0 WHERE task_id = ?').run(taskId);
    assert.throws(() => service.confirmAssignment({
      taskId, actorId: managerId, expectedVersion: 1,
      decisions: [
        { stepId: 'STEP-ORGANIZE', owner: 'ai' },
        { stepId: 'STEP-PATTERNS', owner: 'learner' },
        { stepId: 'STEP-PRIORITIES', owner: 'learner' },
        { stepId: 'STEP-APPROVE', owner: 'manager' },
      ],
    }), { statusCode: 422, code: 'hard_constraint_violation' });
    const task = db.prepare('SELECT status, version FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
    const confirmed = db.prepare('SELECT COUNT(*) AS count FROM allocations WHERE task_id = ? AND confirmed_owner IS NOT NULL').get(taskId) as { count: number };
    const events = db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE task_id = ?').get(taskId) as { count: number };
    assert.deepEqual({ ...task }, { status: 'proposed', version: 1 });
    assert.equal(confirmed.count, 0);
    assert.equal(events.count, 1);
  } finally {
    db.close();
  }
});

test('override without a reason and stale confirmation both fail without assignment', async () => {
  const { db, service } = await fixture();
  try {
    service.generateProposal({ taskId, actorId: managerId, expectedVersion: 0 });
    const decisions = [
      { stepId: 'STEP-ORGANIZE', owner: 'ai' as const },
      { stepId: 'STEP-PATTERNS', owner: 'manager' as const },
      { stepId: 'STEP-PRIORITIES', owner: 'learner' as const },
      { stepId: 'STEP-APPROVE', owner: 'manager' as const },
    ];
    assert.throws(() => service.confirmAssignment({ taskId, actorId: managerId, expectedVersion: 1, decisions }),
      { statusCode: 422, code: 'override_reason_required' });
    assert.throws(() => service.confirmAssignment({ taskId, actorId: managerId, expectedVersion: 0, decisions }),
      { statusCode: 409, code: 'version_conflict' });
    const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string };
    assert.equal(task.status, 'proposed');
  } finally {
    db.close();
  }
});
