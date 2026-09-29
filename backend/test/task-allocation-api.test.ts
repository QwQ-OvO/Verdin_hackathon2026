import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createTaskApiServer } from '../src/task-api-server.ts';
import { openSqliteDatabase, applyDatabaseMigrations } from '../src/db/sqlite-database.ts';
import { seedOnboardingDemo } from '../src/db/seed-demo-data.ts';

const directories: string[] = [];
after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function apiFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'apprentice-api-allocation-'));
  directories.push(directory);
  const db = openSqliteDatabase(path.join(directory, 'demo.sqlite'));
  applyDatabaseMigrations(db);
  seedOnboardingDemo(db);
  const server = createTaskApiServer({ db, tokens: new Map([
    ['manager-token', 'USER-MANAGER-001'], ['learner-token', 'USER-LEARNER-001'],
  ]) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    db,
    baseUrl: `http://127.0.0.1:${address.port}/tasks/TASK-ONB-001`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      db.close();
    },
  };
}

const managerHeaders = { authorization: 'Bearer manager-token', 'content-type': 'application/json' };
const learnerHeaders = { authorization: 'Bearer learner-token', 'content-type': 'application/json' };

test('manager can propose and confirm allocation, then learner sees assigned source material', async () => {
  const api = await apiFixture();
  try {
    const proposal = await fetch(`${api.baseUrl}/proposal`, {
      method: 'POST', headers: managerHeaders, body: JSON.stringify({ expected_version: 0 }),
    });
    assert.equal(proposal.status, 201);
    const proposed = await proposal.json() as { data: { status: string; steps: { step_id: string; suggested_owner: string; rule_ids: string[]; reason: string }[] } };
    assert.equal(proposed.data.status, 'proposed');
    assert.deepEqual(proposed.data.steps.map((step) => step.suggested_owner), ['ai', 'learner', 'learner', 'manager']);
    assert.ok(proposed.data.steps[1].rule_ids.includes('capability_match'));

    const learnerBefore = await fetch(api.baseUrl, { headers: learnerHeaders });
    assert.equal(learnerBefore.status, 403);
    const managerView = await fetch(api.baseUrl, { headers: managerHeaders });
    const managerBody = await managerView.json() as { data: { allocation_proposal: unknown[] } };
    assert.equal(managerBody.data.allocation_proposal.length, 4);

    const assignment = await fetch(`${api.baseUrl}/assignment`, {
      method: 'POST', headers: managerHeaders, body: JSON.stringify({
        expected_version: 1,
        decisions: proposed.data.steps.map((step) => ({ step_id: step.step_id, owner: step.suggested_owner })),
      }),
    });
    assert.equal(assignment.status, 200);
    const assigned = await assignment.json() as { data: { status: string; version: number } };
    assert.deepEqual(assigned.data, { task_id: 'TASK-ONB-001', status: 'assigned', version: 2 });

    const learnerAfter = await fetch(api.baseUrl, { headers: learnerHeaders });
    assert.equal(learnerAfter.status, 200);
    const learnerBody = await learnerAfter.json() as { data: { feedback: unknown[]; allocation: unknown[] } };
    assert.equal(learnerBody.data.feedback.length, 12);
    assert.equal(learnerBody.data.allocation.length, 4);
    assert.equal(JSON.stringify(learnerBody).includes('review-rubric'), false);
  } finally {
    await api.close();
  }
});

test('revoked source access blocks learner reads even after assignment', async () => {
  const api = await apiFixture();
  try {
    const proposal = await fetch(`${api.baseUrl}/proposal`, {
      method: 'POST', headers: managerHeaders, body: JSON.stringify({ expected_version: 0 }),
    });
    const proposed = await proposal.json() as { data: { steps: { step_id: string; suggested_owner: string }[] } };
    const assignment = await fetch(`${api.baseUrl}/assignment`, {
      method: 'POST', headers: managerHeaders, body: JSON.stringify({
        expected_version: 1,
        decisions: proposed.data.steps.map((step) => ({ step_id: step.step_id, owner: step.suggested_owner })),
      }),
    });
    assert.equal(assignment.status, 200);
    api.db.prepare('UPDATE task_access_scopes SET learner_may_read_original_feedback = 0 WHERE task_id = ?').run('TASK-ONB-001');
    const learner = await fetch(api.baseUrl, { headers: learnerHeaders });
    assert.equal(learner.status, 403);
  } finally {
    await api.close();
  }
});

test('a feedback item moved outside the task source scope is not returned to the learner', async () => {
  const api = await apiFixture();
  try {
    const proposal = await fetch(`${api.baseUrl}/proposal`, {
      method: 'POST', headers: managerHeaders, body: JSON.stringify({ expected_version: 0 }),
    });
    const proposed = await proposal.json() as { data: { steps: { step_id: string; suggested_owner: string }[] } };
    const assignment = await fetch(`${api.baseUrl}/assignment`, {
      method: 'POST', headers: managerHeaders, body: JSON.stringify({
        expected_version: 1,
        decisions: proposed.data.steps.map((step) => ({ step_id: step.step_id, owner: step.suggested_owner })),
      }),
    });
    assert.equal(assignment.status, 200);
    api.db.prepare('UPDATE feedback_items SET source_type = ? WHERE id = ?').run('outside_scope', 'FB-014');
    const learner = await fetch(api.baseUrl, { headers: learnerHeaders });
    assert.equal(learner.status, 403);
  } finally {
    await api.close();
  }
});

test('learner cannot propose allocation even when a client claims the manager role', async () => {
  const api = await apiFixture();
  try {
    const response = await fetch(`${api.baseUrl}/proposal`, {
      method: 'POST', headers: { ...learnerHeaders, 'x-role': 'manager' },
      body: JSON.stringify({ expected_version: 0 }),
    });
    assert.equal(response.status, 403);
  } finally {
    await api.close();
  }
});

test('malformed proposal body returns a client error instead of mutating the task', async () => {
  const api = await apiFixture();
  try {
    const response = await fetch(`${api.baseUrl}/proposal`, {
      method: 'POST', headers: managerHeaders, body: '{',
    });
    assert.equal(response.status, 400);
    const task = await fetch(api.baseUrl, { headers: managerHeaders });
    const body = await task.json() as { data: { status: string } };
    assert.equal(body.data.status, 'draft');
  } finally {
    await api.close();
  }
});
