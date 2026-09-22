import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInputs } from '../src/files.mjs';
import { callFoundry, classifyProviderFailure, validateEndpoint, callFixture } from '../src/provider.mjs';
import { evaluate } from '../src/evaluation.mjs';
import { createDemoApproval } from '../src/scope.mjs';
import { createDemoView } from '../src/view-model.mjs';
import { verifyEvidenceIntegrity } from '../src/provenance.mjs';
import { readAzureConfig } from '../scripts/azure.mjs';
import { testSource } from './helpers.mjs';

test('offline viewer assembles real fixture reports with no provider requests', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('The offline workflow cannot call a network provider.'));
  const view = await createDemoView();
  assert.deepEqual(Object.values(view.stages).map(stage => [stage.gate.passed, stage.gate.total]), [[4, 4], [0, 5], [5, 5]]);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(view.latest.execution.providerAttempts, 0);
  assert.equal(view.latest.execution.fixtureCases, 4);
  assert.equal(view.latest.source.kind, 'source-snapshot');
  assert.equal(view.latest.source.commit, undefined);
  assert.match(view.latest.notice, /Synthetic deterministic fixture/);
  assert.ok(verifyEvidenceIntegrity(view.latest));
});

test('provider uses operator auth, strict JSON selection and bounded tokens', async () => {
  const { scope } = await loadInputs();
  let captured;
  const result = await callFoundry({
    question: 'E-214', facts: [], endpoint: 'https://example.openai.azure.com', deployment: 'selector',
    token: 'fixture-only-value', budget: scope.budget,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({
        id: 'test-response', model: 'test-only', choices: [{ finish_reason: 'stop', message: { content: '{"disposition":"abstain","factIds":[]}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }), { headers: { 'apim-request-id': 'test-request' } });
    },
  });
  assert.equal(captured.options.headers.authorization, `Bearer ${'fixture-only-value'}`);
  assert.equal(captured.options.redirect, 'error');
  assert.equal(JSON.parse(captured.options.body).max_tokens, 180);
  assert.equal(JSON.parse(captured.options.body).response_format.json_schema.strict, true);
  assert.equal(result.receipt.usage.inputTokens, 100);
  assert.equal(JSON.stringify(result).includes('fixture-only-value'), false);
});

test('provider errors never retry or fall back to a fixture', async () => {
  const inputs = await loadInputs();
  const failures = [];
  let calls = 0;
  const { evidence, gate } = await evaluate(inputs, {
    approval: createDemoApproval(inputs), allowDemoApproval: true, mode: 'live-azure', source: testSource('live-azure'),
    onError: message => failures.push(message),
    invoke: params => callFoundry({
      ...params, endpoint: 'https://example.openai.azure.com', deployment: 'selector', token: 'fixture-only-value',
      fetchImpl: async () => { calls++; return new Response('{}', { status: 429 }); },
    }),
  });
  assert.equal(calls, 4);
  assert.equal(failures.length, 4);
  assert.equal(gate.status, 'blocked');
  assert.equal(evidence.execution.completions, 0);
  assert.ok(evidence.responses.every(result => !result.answer && result.error));
});

test('provider policy refusals are failures, not model completions', async () => {
  const body = { error: { code: 'content_filter', innererror: { code: 'ResponsibleAIPolicyViolation' } } };
  assert.equal(classifyProviderFailure(400, body), 'provider-refused');
  for (const [status, payload] of [[403, body], [400, {}], [400, { error: { code: 'content_filter' } }]]) {
    assert.equal(classifyProviderFailure(status, payload), 'provider-error');
  }
  const { scope } = await loadInputs();
  await assert.rejects(callFoundry({
    question: 'synthetic', facts: [], endpoint: 'https://example.openai.azure.com',
    deployment: 'selector', token: 'fixture-only-value', budget: scope.budget,
    fetchImpl: async () => new Response(JSON.stringify(body), { status: 400 }),
  }), error => {
    assert.equal(error.providerFailure.completionReceived, false);
    assert.equal(error.providerFailure.usage, null);
    assert.equal(error.providerFailure.state, 'provider-refused');
    return true;
  });
});

test('invalid endpoint, missing receipts and malformed budgets fail closed', async () => {
  for (const endpoint of [
    'http://example.openai.azure.com', 'https://example.invalid',
    'https://user@example.openai.azure.com', 'https://example.openai.azure.com/path',
    'https://example.openai.azure.com?key=x', 'https://example.openai.azure.com:8443',
  ]) assert.throws(() => validateEndpoint(endpoint));
  const { scope } = await loadInputs();
  let calls = 0;
  for (const budget of [
    { ...scope.budget, maxOutputTokensPerCall: 181 }, { ...scope.budget, maxOutputTokensPerCall: '180' },
    { ...scope.budget, maxInputCharactersPerCall: 7001 }, { ...scope.budget, maxInputCharactersPerCall: '7000' },
  ]) {
    await assert.rejects(callFoundry({
      question: 'synthetic', facts: [], endpoint: 'https://example.openai.azure.com',
      deployment: 'selector', token: 'fixture-only-value', budget,
      fetchImpl: async () => { calls++; },
    }), /BUDGET_EXCEEDED/);
  }
  assert.equal(calls, 0);
  await assert.rejects(callFoundry({
    question: 'synthetic', facts: [], endpoint: 'https://example.openai.azure.com',
    deployment: 'selector', token: 'fixture-only-value', budget: scope.budget,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] })),
  }), /MISSING_RECEIPT/);
});

test('a live-shaped test run needs mode-appropriate receipts and an explicit invoker', async () => {
  const inputs = await loadInputs();
  const options = { approval: createDemoApproval(inputs), allowDemoApproval: true, mode: 'live-azure', source: testSource('live-azure') };
  await assert.rejects(evaluate(inputs, options), /LIVE_PROVIDER_REQUIRED/);
  const { gate } = await evaluate(inputs, { ...options, invoke: callFixture });
  assert.equal(gate.status, 'blocked');
  assert.equal(gate.rows.find(row => row.id === 'R-04').status, 'fail');
});

test('Azure configuration is never implicitly enabled by existing credentials', () => {
  const previous = process.env.PROOFPACK_ALLOW_AZURE;
  try {
    process.env.PROOFPACK_ALLOW_AZURE = '0';
    assert.throws(readAzureConfig, /AZURE_OPT_IN_REQUIRED/);
  } finally {
    if (previous === undefined) delete process.env.PROOFPACK_ALLOW_AZURE;
    else process.env.PROOFPACK_ALLOW_AZURE = previous;
  }
});
