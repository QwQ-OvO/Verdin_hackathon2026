import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createTaskApiServer } from '../src/task-api-server.ts';
import { applyDatabaseMigrations, openSqliteDatabase } from '../src/db/sqlite-database.ts';
import { seedOnboardingDemo } from '../src/db/seed-demo-data.ts';
import { TaskAllocationService } from '../src/services/task-allocation-service.ts';

const directories: string[] = [];
after(async () => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))));

const taskId = 'TASK-ONB-001';
const learnerHeaders = { authorization: 'Bearer learner-token', 'content-type': 'application/json' };
const managerHeaders = { authorization: 'Bearer manager-token', 'content-type': 'application/json' };
const firstJudgment = {
  expected_version: 3, patterns: 'Some comments describe separate onboarding stages.', evidence_ids: ['FB-014'],
  priorities: [
    { focus: 'Investigate upload feedback', reason: 'The receipt may be unclear.', evidence_ids: ['FB-014'], contrary_evidence_ids: ['FB-018'], next_check: 'Check upload logs.' },
    { focus: 'Investigate review feedback', reason: 'The next action may be unclear.', evidence_ids: ['FB-021'], contrary_evidence_ids: [], next_check: 'Check review status records.' },
  ],
  journey_stage_distinctions: 'Upload and review are different stages.', uncertainties: 'The sample is small.',
};

async function fixture(hintModel: { generate: (input: unknown) => Promise<unknown> } = {
  generate: async () => ({ text: 'Compare this source with your cited evidence.', source_ids: ['FB-018'], model_version: 'test-model-v1' }),
}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'apprentice-hints-'));
  directories.push(directory);
  const db = openSqliteDatabase(path.join(directory, 'demo.sqlite'));
  applyDatabaseMigrations(db);
  seedOnboardingDemo(db);
  const allocation = new TaskAllocationService(db);
  allocation.generateProposal({ taskId, actorId: 'USER-MANAGER-001', expectedVersion: 0 });
  const steps = db.prepare('SELECT step_id, system_suggestion FROM allocations WHERE task_id = ?').all(taskId) as
    { step_id: string; system_suggestion: 'ai' | 'learner' | 'manager' }[];
  allocation.confirmAssignment({ taskId, actorId: 'USER-MANAGER-001', expectedVersion: 1,
    decisions: steps.map((step) => ({ stepId: step.step_id, owner: step.system_suggestion })) });
  const server = createTaskApiServer({ db, tokens: new Map([
    ['manager-token', 'USER-MANAGER-001'], ['learner-token', 'USER-LEARNER-001'],
  ]), hintModel });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/tasks/${taskId}`;
  return { db, url, close: async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  } };
}

function post(url: string, body: unknown, manager = false) {
  return fetch(url, { method: 'POST', headers: manager ? managerHeaders : learnerHeaders, body: JSON.stringify(body) });
}

async function startAndSubmit(api: { url: string }) {
  assert.equal((await post(`${api.url}/start`, { expected_version: 2 })).status, 200);
  assert.equal((await post(`${api.url}/first-judgment`, firstJudgment)).status, 201);
}

test('only an assigned learner in progress receives a source-free reflection question', async () => {
  const api = await fixture({ generate: async () => { throw new Error('Level one must not call the model'); } });
  try {
    assert.equal((await post(`${api.url}/hints`, { level: 1, expected_version: 2, request_id: 'early' })).status, 409);
    assert.equal((await post(`${api.url}/start`, { expected_version: 2 })).status, 200);
    assert.equal((await post(`${api.url}/hints`, { level: 1, expected_version: 3, request_id: 'manager' }, true)).status, 403);
    const response = await post(`${api.url}/hints`, { level: 1, expected_version: 3, request_id: 'reflection-1' });
    assert.equal(response.status, 201);
    const hint = (await response.json() as { data: { level: number; kind: string; text: string; source_ids: string[]; model_version: string } }).data;
    assert.equal(hint.level, 1);
    assert.equal(hint.kind, 'reflection_question');
    assert.deepEqual(hint.source_ids, []);
    assert.equal(hint.model_version, 'curated-template-v1');
    assert.equal(/FB-\d+|upload|verification|priority/i.test(hint.text), false);
    assert.equal((await post(`${api.url}/hints`, { level: 2, expected_version: 3, request_id: 'too-early' })).status, 409);
    const submitted = await post(`${api.url}/first-judgment`, firstJudgment);
    const result = (await submitted.json() as { data: { judgment: { assisted: boolean } } }).data;
    assert.equal(result.judgment.assisted, true);
    assert.equal((await post(`${api.url}/hints`, { level: 1, expected_version: 4, request_id: 'too-late' })).status, 409);
  } finally { await api.close(); }
});

test('post-submission clues are validated, saved, and readable after refresh', async () => {
  const api = await fixture();
  try {
    await startAndSubmit(api);
    const response = await post(`${api.url}/hints`, { level: 2, expected_version: 4, request_id: 'clue-1' });
    assert.equal(response.status, 201);
    const hint = (await response.json() as { data: { id: string; level: number; source_ids: string[]; model_version: string } }).data;
    assert.equal(hint.level, 2);
    assert.deepEqual(hint.source_ids, ['FB-018']);
    assert.equal(hint.model_version, 'test-model-v1');
    const list = await fetch(`${api.url}/hints`, { headers: learnerHeaders });
    assert.equal(list.status, 200);
    const body = await list.json() as { data: { id: string; level: number }[] };
    assert.deepEqual(body.data.map((item) => ({ id: item.id, level: item.level })), [{ id: hint.id, level: 2 }]);
    assert.throws(() => api.db.prepare('UPDATE hint_events SET content = ? WHERE id = ?').run('changed', hint.id));
  } finally { await api.close(); }
});

test('malformed model output and invented source IDs are rejected without hint events', async () => {
  const api = await fixture({ generate: async () => ({ text: 'Look at this item.', source_ids: ['FB-FAKE'], model_version: 'broken-v1' }) });
  try {
    await startAndSubmit(api);
    const response = await post(`${api.url}/hints`, { level: 3, expected_version: 4, request_id: 'bad-source' });
    assert.equal(response.status, 502);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM hint_events').get() as { count: number }).count, 0);
  } finally { await api.close(); }
});

test('unverified IDs in hint prose are rejected even when the source list is valid', async () => {
  const api = await fixture({ generate: async () => ({ text: 'Also inspect FB-FAKE.',
    source_ids: ['FB-018'], model_version: 'broken-v2' }) });
  try {
    await startAndSubmit(api);
    assert.equal((await post(`${api.url}/hints`, { level: 2, expected_version: 4, request_id: 'bad-prose' })).status, 502);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM hint_events').get() as { count: number }).count, 0);
  } finally { await api.close(); }
});

test('model failure returns a stable gateway error without saving raw output', async () => {
  const api = await fixture({ generate: async () => { throw new Error('private provider details'); } });
  try {
    await startAndSubmit(api);
    const response = await post(`${api.url}/hints`, { level: 3, expected_version: 4, request_id: 'provider-error' });
    assert.equal(response.status, 502);
    assert.equal(JSON.stringify(await response.json()).includes('private provider details'), false);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM hint_events').get() as { count: number }).count, 0);
  } finally { await api.close(); }
});

test('duplicate request ID returns the saved hint and does not append another event', async () => {
  const api = await fixture();
  try {
    await startAndSubmit(api);
    const payload = { level: 2, expected_version: 4, request_id: 'double-click' };
    const first = await post(`${api.url}/hints`, payload);
    const second = await post(`${api.url}/hints`, payload);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.deepEqual((await first.json() as { data: unknown }).data, (await second.json() as { data: unknown }).data);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM hint_events').get() as { count: number }).count, 1);
  } finally { await api.close(); }
});

test('a concurrent request ID reused for another level returns conflict', async () => {
  let saveOtherLevel: () => void = () => undefined;
  const api = await fixture({ generate: async () => {
    saveOtherLevel();
    return { text: 'Compare this source.', source_ids: ['FB-018'], model_version: 'test-model-v1' };
  } });
  saveOtherLevel = () => { api.db.prepare(`INSERT INTO hint_events
    (id, task_id, requester_id, level, content, model_version, created_at, request_id)
    VALUES ('RACED-HINT', ?, 'USER-LEARNER-001', 3, ?, 'test-model-v1', ?, 'shared-key')`)
    .run(taskId, JSON.stringify({ kind: 'evidence_check', text: 'Check evidence.', source_ids: ['FB-018'] }), new Date().toISOString()); };
  try {
    await startAndSubmit(api);
    const response = await post(`${api.url}/hints`, { level: 2, expected_version: 4, request_id: 'shared-key' });
    assert.equal(response.status, 409);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM hint_events').get() as { count: number }).count, 1);
  } finally { await api.close(); }
});

test('revoked source access during generation blocks persistence and response', async () => {
  let revoke: () => void = () => undefined;
  const api = await fixture({ generate: async () => {
    revoke();
    return { text: 'Compare this original comment.', source_ids: ['FB-018'], model_version: 'test-model-v1' };
  } });
  revoke = () => { api.db.prepare('UPDATE task_access_scopes SET learner_may_read_original_feedback = 0 WHERE task_id = ?').run(taskId); };
  try {
    await startAndSubmit(api);
    assert.equal((await post(`${api.url}/hints`, { level: 3, expected_version: 4, request_id: 'revoked' })).status, 403);
    assert.equal((api.db.prepare('SELECT COUNT(*) AS count FROM hint_events').get() as { count: number }).count, 0);
  } finally { await api.close(); }
});

test('task view advertises only the hint levels allowed at its current milestone', async () => {
  const api = await fixture();
  try {
    await post(`${api.url}/start`, { expected_version: 2 });
    const before = (await (await fetch(api.url, { headers: learnerHeaders })).json() as
      { data: { allowed_actions: string[] } }).data;
    assert.deepEqual(before.allowed_actions, ['submit_first_judgment', 'request_hint_1']);
    await post(`${api.url}/first-judgment`, firstJudgment);
    const after = (await (await fetch(api.url, { headers: learnerHeaders })).json() as
      { data: { allowed_actions: string[] } }).data;
    assert.deepEqual(after.allowed_actions, ['request_hint_2', 'request_hint_3']);
  } finally { await api.close(); }
});
