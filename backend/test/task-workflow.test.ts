import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createTaskApiServer } from '../src/task-api-server.ts';
import { openSqliteDatabase, applyDatabaseMigrations } from '../src/db/sqlite-database.ts';
import { seedOnboardingDemo } from '../src/db/seed-demo-data.ts';
import { TaskWorkflowService } from '../src/services/task-workflow-service.ts';

const tempDirs: string[] = [];
after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

// Each test uses a real SQLite file so transaction and reopen behavior are exercised.
async function createFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'apprentice-step1-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'demo.sqlite');
  const db = openSqliteDatabase(file);
  applyDatabaseMigrations(db);
  seedOnboardingDemo(db);
  return { db, file };
}

test('seeded task, original feedback, and source links survive reopening SQLite', async () => {
  const { db, file } = await createFixture();
  db.close();

  const reopened = openSqliteDatabase(file);
  try {
    const task = reopened.prepare('SELECT status, source_type, is_simulated FROM tasks WHERE id = ?').get('TASK-ONB-001') as Record<string, unknown>;
    const feedback = reopened.prepare('SELECT COUNT(*) AS count FROM feedback_items WHERE task_id = ?').get('TASK-ONB-001') as { count: number };
    const group = reopened.prepare('SELECT feedback_id FROM organization_group_sources WHERE group_id = ? ORDER BY feedback_id').all('GROUP-A') as { feedback_id: string }[];

    assert.deepEqual({ ...task }, { status: 'draft', source_type: 'simulated_product_feedback', is_simulated: 1 });
    assert.equal(feedback.count, 12);
    assert.deepEqual(group.map((item) => item.feedback_id), ['FB-014', 'FB-027']);
  } finally {
    reopened.close();
  }
});

test('an authorized transition persists its actor, time, state, and version together', async () => {
  const { db } = await createFixture();
  try {
    const service = new TaskWorkflowService(db);
    const result = service.transition({ taskId: 'TASK-ONB-001', event: 'proposal_generated', actorId: 'USER-MANAGER-001', expectedVersion: 0 });
    const audit = db.prepare('SELECT actor_id, event_type, from_status, to_status, occurred_at FROM audit_events WHERE task_id = ?').get('TASK-ONB-001') as Record<string, unknown>;

    assert.deepEqual(result, { id: 'TASK-ONB-001', status: 'proposed', version: 1 });
    assert.equal(audit.actor_id, 'USER-MANAGER-001');
    assert.equal(audit.event_type, 'proposal_generated');
    assert.equal(audit.from_status, 'draft');
    assert.equal(audit.to_status, 'proposed');
    assert.match(audit.occurred_at as string, /^\d{4}-\d\d-\d\dT/);
  } finally {
    db.close();
  }
});

test('illegal transition leaves both task and audit trail unchanged', async () => {
  const { db } = await createFixture();
  try {
    const service = new TaskWorkflowService(db);
    assert.throws(
      () => service.transition({ taskId: 'TASK-ONB-001', event: 'review_approved', actorId: 'USER-MANAGER-001', expectedVersion: 0 }),
      { statusCode: 409, code: 'invalid_transition' },
    );
    const task = db.prepare('SELECT status, version FROM tasks WHERE id = ?').get('TASK-ONB-001') as Record<string, unknown>;
    const audit = db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE task_id = ?').get('TASK-ONB-001') as { count: number };
    assert.deepEqual({ ...task }, { status: 'draft', version: 0 });
    assert.equal(audit.count, 0);
  } finally {
    db.close();
  }
});

test('learner cannot generate a manager proposal', async () => {
  const { db } = await createFixture();
  try {
    const service = new TaskWorkflowService(db);
    assert.throws(
      () => service.transition({ taskId: 'TASK-ONB-001', event: 'proposal_generated', actorId: 'USER-LEARNER-001', expectedVersion: 0 }),
      { statusCode: 403, code: 'forbidden' },
    );
  } finally {
    db.close();
  }
});

test('stale expected version cannot overwrite a newer state', async () => {
  const { db } = await createFixture();
  try {
    const service = new TaskWorkflowService(db);
    service.transition({ taskId: 'TASK-ONB-001', event: 'proposal_generated', actorId: 'USER-MANAGER-001', expectedVersion: 0 });
    assert.throws(
      () => service.transition({ taskId: 'TASK-ONB-001', event: 'assignment_confirmed', actorId: 'USER-MANAGER-001', expectedVersion: 0 }),
      { statusCode: 409, code: 'version_conflict' },
    );
    const task = db.prepare('SELECT status, version FROM tasks WHERE id = ?').get('TASK-ONB-001') as Record<string, unknown>;
    assert.deepEqual({ ...task }, { status: 'proposed', version: 1 });
  } finally {
    db.close();
  }
});

test('a committed audit event cannot be updated', async () => {
  const { db } = await createFixture();
  try {
    new TaskWorkflowService(db).transition({ taskId: 'TASK-ONB-001', event: 'proposal_generated', actorId: 'USER-MANAGER-001', expectedVersion: 0 });
    assert.throws(() => db.exec("UPDATE audit_events SET event_type = 'forged' WHERE task_id = 'TASK-ONB-001'"));
  } finally {
    db.close();
  }
});

test('a committed audit event cannot be deleted', async () => {
  const { db } = await createFixture();
  try {
    new TaskWorkflowService(db).transition({ taskId: 'TASK-ONB-001', event: 'proposal_generated', actorId: 'USER-MANAGER-001', expectedVersion: 0 });
    assert.throws(() => db.exec("DELETE FROM audit_events WHERE task_id = 'TASK-ONB-001'"));
  } finally {
    db.close();
  }
});

test('task API authenticates the actor and hides an unassigned task from the learner', async () => {
  const { db } = await createFixture();
  const server = createTaskApiServer({ db, tokens: new Map([['manager-token', 'USER-MANAGER-001'], ['learner-token', 'USER-LEARNER-001']]) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/tasks/TASK-ONB-001`;
  try {
    const unauthenticated = await fetch(url);
    assert.equal(unauthenticated.status, 401);

    const learner = await fetch(url, { headers: { authorization: 'Bearer learner-token' } });
    assert.equal(learner.status, 403);

    const manager = await fetch(url, { headers: { authorization: 'Bearer manager-token' } });
    assert.equal(manager.status, 200);
    const body = await manager.json() as { data: Record<string, unknown> };
    assert.equal(body.data.id, 'TASK-ONB-001');
    assert.equal(body.data.status, 'draft');
    assert.equal(body.data.is_simulated, true);
    assert.equal(JSON.stringify(body).includes('FB-018'), false);
    assert.equal(JSON.stringify(body).includes('review-rubric'), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});
