import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createTaskApiServer } from '../src/task-api-server.ts';
import { applyDatabaseMigrations, openSqliteDatabase } from '../src/db/sqlite-database.ts';
import { seedOnboardingDemo } from '../src/db/seed-demo-data.ts';
import { TaskAllocationService } from '../src/services/task-allocation-service.ts';
import { TaskWorkflowService } from '../src/services/task-workflow-service.ts';

const directories: string[] = [];
after(async () => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))));

const taskId = 'TASK-ONB-001';
const managerId = 'USER-MANAGER-001';
const learnerId = 'USER-LEARNER-001';
const learnerHeaders = { authorization: 'Bearer learner-token', 'content-type': 'application/json' };
const managerHeaders = { authorization: 'Bearer manager-token', 'content-type': 'application/json' };

const judgment = {
  expected_version: 3,
  patterns: 'Several comments describe friction at different onboarding stages.',
  evidence_ids: ['FB-014', 'FB-018'],
  priorities: [
    { focus: 'Investigate document upload friction', reason: 'Repeated upload attempts need investigation.', evidence_ids: ['FB-014'], contrary_evidence_ids: ['FB-021'], next_check: 'Compare upload logs.' },
    { focus: 'Investigate review delay', reason: 'Review timing may affect activation.', evidence_ids: ['FB-018'], contrary_evidence_ids: [], next_check: 'Check review timestamps.' },
  ],
  journey_stage_distinctions: 'Upload and verification review are separate stages.',
  uncertainties: 'The sample may not represent every merchant.',
};

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'apprentice-first-judgment-'));
  directories.push(directory);
  const db = openSqliteDatabase(path.join(directory, 'demo.sqlite'));
  applyDatabaseMigrations(db);
  seedOnboardingDemo(db);
  const allocation = new TaskAllocationService(db);
  const proposal = allocation.generateProposal({ taskId, actorId: managerId, expectedVersion: 0 });
  const steps = db.prepare('SELECT step_id, system_suggestion FROM allocations WHERE task_id = ?').all(taskId) as { step_id: string; system_suggestion: 'ai' | 'learner' | 'manager' }[];
  allocation.confirmAssignment({ taskId, actorId: managerId, expectedVersion: proposal.version,
    decisions: steps.map((step) => ({ stepId: step.step_id, owner: step.system_suggestion })) });
  const server = createTaskApiServer({ db, tokens: new Map([['manager-token', managerId], ['learner-token', learnerId]]) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { db, url: `http://127.0.0.1:${address.port}/tasks/${taskId}`,
    close: async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); db.close(); } };
}

async function post(url: string, token: 'learner' | 'manager', body: unknown) {
  return fetch(url, { method: 'POST', headers: token === 'learner' ? learnerHeaders : managerHeaders, body: JSON.stringify(body) });
}

test('learner starts an assigned task before submitting; manager cannot start it', async () => {
  const api = await fixture();
  try {
    assert.equal((await post(`${api.url}/start`, 'manager', { expected_version: 2 })).status, 403);
    const started = await post(`${api.url}/start`, 'learner', { expected_version: 2 });
    assert.equal(started.status, 200);
    assert.deepEqual((await started.json() as { data: unknown }).data, { task_id: taskId, status: 'in_progress', version: 3 });
    assert.equal((await post(`${api.url}/start`, 'learner', { expected_version: 2 })).status, 409);
  } finally { await api.close(); }
});

test('learner can submit one evidence-backed first judgment and read its immutable version', async () => {
  const api = await fixture();
  try {
    await post(`${api.url}/start`, 'learner', { expected_version: 2 });
    const response = await post(`${api.url}/first-judgment`, 'learner', judgment);
    assert.equal(response.status, 201);
    const result = (await response.json() as { data: { status: string; version: number; judgment: { id: string; version_number: number; assisted: boolean } } }).data;
    assert.equal(result.status, 'first_submitted');
    assert.equal(result.version, 4);
    assert.equal(result.judgment.version_number, 1);
    assert.equal(result.judgment.assisted, false);
    const view = (await (await fetch(api.url, { headers: learnerHeaders })).json() as { data: { first_judgment: { id: string; priorities: unknown[] } } }).data;
    assert.equal(view.first_judgment.id, result.judgment.id);
    assert.equal(view.first_judgment.priorities.length, 2);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM judgment_citations').get() as { count: number }).count, 3);
    assert.ok((api.db.prepare('SELECT first_submitted_at FROM tasks WHERE id = ?').get(taskId) as { first_submitted_at: string }).first_submitted_at);
    assert.throws(() => api.db.prepare('UPDATE judgment_versions SET content_json = ? WHERE id = ?').run('{}', result.judgment.id));
    assert.throws(() => api.db.prepare('DELETE FROM judgment_citations WHERE judgment_version_id = ?').run(result.judgment.id));
  } finally { await api.close(); }
});

test('pre-submission learner task view excludes manager guidance and AI conclusions', async () => {
  const api = await fixture();
  try {
    const response = await fetch(api.url, { headers: learnerHeaders });
    assert.equal(response.status, 200);
    const data = (await response.json() as { data: Record<string, unknown> }).data;
    assert.deepEqual(data.allowed_actions, ['start_task']);
    assert.equal(data.first_judgment, undefined);
    assert.equal(data.allocation_proposal, undefined);
    assert.equal(JSON.stringify(data).includes('review-rubric'), false);
    assert.equal(JSON.stringify(data).includes('ai_priority'), false);
  } finally { await api.close(); }
});

test('invalid priority count and foreign feedback ID do not change the task', async () => {
  const api = await fixture();
  try {
    await post(`${api.url}/start`, 'learner', { expected_version: 2 });
    assert.equal((await post(`${api.url}/first-judgment`, 'learner', { ...judgment, priorities: [judgment.priorities[0]] })).status, 422);
    assert.equal((await post(`${api.url}/first-judgment`, 'learner', { ...judgment, evidence_ids: ['FB-NOT-ALLOWED'] })).status, 422);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM judgment_versions').get() as { count: number }).count, 0);
    assert.deepEqual({ ...api.db.prepare('SELECT status, version FROM tasks WHERE id = ?').get(taskId) as object }, { status: 'in_progress', version: 3 });
  } finally { await api.close(); }
});

test('concurrent duplicate submissions create only one first judgment', async () => {
  const api = await fixture();
  try {
    await post(`${api.url}/start`, 'learner', { expected_version: 2 });
    const responses = await Promise.all([post(`${api.url}/first-judgment`, 'learner', judgment), post(`${api.url}/first-judgment`, 'learner', judgment)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM judgment_versions').get() as { count: number }).count, 1);
    assert.equal((api.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'first_judgment_submitted'").get() as { count: number }).count, 1);
  } finally { await api.close(); }
});

test('workflow cannot mark a first judgment submitted without a saved version', async () => {
  const api = await fixture();
  try {
    await post(`${api.url}/start`, 'learner', { expected_version: 2 });
    assert.throws(() => new TaskWorkflowService(api.db).transition({ taskId, actorId: learnerId, event: 'first_judgment_submitted', expectedVersion: 3 }),
      { statusCode: 409, code: 'missing_first_judgment' });
    assert.equal((api.db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string }).status, 'in_progress');
  } finally { await api.close(); }
});

test('a previously inserted judgment cannot be attached to a later state transition', async () => {
  const api = await fixture();
  try {
    await post(`${api.url}/start`, 'learner', { expected_version: 2 });
    api.db.prepare(`INSERT INTO judgment_versions
      (id, task_id, version_number, author_id, content_json, created_at)
      VALUES ('EARLY-VERSION', ?, 1, ?, '{}', ?)`).run(taskId, learnerId, new Date().toISOString());
    api.db.prepare('INSERT INTO judgment_citations (judgment_version_id, feedback_id) VALUES (?, ?)').run('EARLY-VERSION', 'FB-014');
    assert.throws(() => new TaskWorkflowService(api.db).transition({ taskId, actorId: learnerId,
      event: 'first_judgment_submitted', expectedVersion: 3 }),
    { statusCode: 409, code: 'missing_first_judgment' });
    assert.equal((api.db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string }).status, 'in_progress');
  } finally { await api.close(); }
});

test('unassigned judgment steps do not grant a learner start action', async () => {
  const api = await fixture();
  try {
    api.db.prepare(`UPDATE allocations SET confirmed_owner = 'ai', override_reason = 'Manager reassigned work'
      WHERE step_id = (SELECT id FROM task_steps WHERE task_id = ? AND step_key = 'identify_patterns')`).run(taskId);
    const view = (await (await fetch(api.url, { headers: learnerHeaders })).json() as { data: { allowed_actions: string[] } }).data;
    assert.deepEqual(view.allowed_actions, []);
    assert.equal((await post(`${api.url}/start`, 'learner', { expected_version: 2 })).status, 403);
  } finally { await api.close(); }
});

test('revoked source access blocks starting and first judgment submission', async () => {
  const api = await fixture();
  try {
    api.db.prepare('UPDATE task_access_scopes SET learner_may_read_original_feedback = 0 WHERE task_id = ?').run(taskId);
    assert.equal((await post(`${api.url}/start`, 'learner', { expected_version: 2 })).status, 403);
    api.db.prepare('UPDATE task_access_scopes SET learner_may_read_original_feedback = 1 WHERE task_id = ?').run(taskId);
    assert.equal((await post(`${api.url}/start`, 'learner', { expected_version: 2 })).status, 200);
    api.db.prepare('UPDATE task_access_scopes SET learner_may_read_original_feedback = 0 WHERE task_id = ?').run(taskId);
    assert.equal((await post(`${api.url}/first-judgment`, 'learner', judgment)).status, 403);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM judgment_versions').get() as { count: number }).count, 0);
  } finally { await api.close(); }
});

test('first judgment refuses an invalid ID nested inside one priority', async () => {
  const api = await fixture();
  try {
    await post(`${api.url}/start`, 'learner', { expected_version: 2 });
    const response = await post(`${api.url}/first-judgment`, 'learner', { ...judgment,
      priorities: [{ ...judgment.priorities[0], evidence_ids: ['FB-OTHER'] }, judgment.priorities[1]] });
    assert.equal(response.status, 422);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM judgment_versions').get() as { count: number }).count, 0);
  } finally { await api.close(); }
});
