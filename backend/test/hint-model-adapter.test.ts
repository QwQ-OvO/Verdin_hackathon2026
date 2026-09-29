import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DemoHintModelAdapter, OpenAiHintModelAdapter } from '../src/services/hint-model-adapter.ts';

test('offline level-three check identifies uncited evidence without asserting a verdict', async () => {
  const output = await new DemoHintModelAdapter().generate({ level: 3,
    feedback: [
      { id: 'FB-014', text: 'Upload receipt was unclear.', journey_stage: 'document_upload' },
      { id: 'FB-021', text: 'Review progress was unclear.', journey_stage: 'verification_review' },
    ], firstJudgment: { evidence_ids: ['FB-014'] } });
  assert.deepEqual(output.source_ids, ['FB-021']);
  assert.match(output.text, /not cited/i);
  assert.match(output.text, /verify/i);
  assert.equal(/approved|root cause/i.test(output.text), false);
});

test('live adapter sends a stateless structured request without approval tools', async () => {
  let request: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (_url, init) => {
    request = init;
    return new Response(JSON.stringify({ status: 'completed', model: 'test-model-snapshot',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        text: 'Compare this comment with your evidence.', source_ids: ['FB-018'],
      }) }] }] }), { status: 200 });
  };
  const model = new OpenAiHintModelAdapter('private-key', 'test-model', fakeFetch);
  const output = await model.generate({ level: 2,
    feedback: [{ id: 'FB-018', text: 'The upload was confirmed.', journey_stage: 'document_upload' }],
    firstJudgment: { patterns: 'Check the upload stage.', evidence_ids: ['FB-014'] } });
  assert.deepEqual(output, { text: 'Compare this comment with your evidence.',
    source_ids: ['FB-018'], model_version: 'test-model-snapshot' });
  assert.equal(request?.method, 'POST');
  assert.equal((request?.headers as Record<string, string>).authorization, 'Bearer private-key');
  const body = JSON.parse(request?.body as string) as Record<string, any>;
  assert.equal(body.store, false);
  assert.equal(body.tool_choice, 'none');
  assert.equal(body.tools, undefined);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(JSON.stringify(body).includes('review-rubric'), false);
});

test('live adapter rejects an incomplete response without exposing its content', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ status: 'incomplete',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'partial secret' }] }] }), { status: 200 });
  const model = new OpenAiHintModelAdapter('private-key', 'test-model', fakeFetch);
  await assert.rejects(() => model.generate({ level: 3, feedback: [], firstJudgment: {} }),
    { statusCode: 502, code: 'model_unavailable' });
});
