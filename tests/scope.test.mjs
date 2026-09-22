import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInputs } from '../src/files.mjs';
import { requireApprovedScope, createDemoApproval } from '../src/scope.mjs';
import { evaluate } from '../src/evaluation.mjs';
import { testSource } from './helpers.mjs';

test('execution requires an explicit demo actor, bound approval and separate opt-in', async () => {
  const inputs = await loadInputs();
  const approval = createDemoApproval(inputs);
  assert.throws(() => requireApprovedScope(inputs, null), /SCOPE_REVIEW_REQUIRED/);
  assert.throws(() => requireApprovedScope(inputs, approval), /DEMO_OPT_IN_REQUIRED/);
  assert.doesNotThrow(() => requireApprovedScope(inputs, approval, { allowDemoApproval: true, mode: 'local-fixture' }));
  assert.throws(() => requireApprovedScope(inputs, { ...approval, actorType: 'human' }, { allowDemoApproval: true, mode: 'live-azure' }), /SCOPE_REVIEW_REQUIRED/);
});

test('stale scope and altered inputs fail before a provider can be called', async () => {
  const initial = await loadInputs('v1');
  const current = await loadInputs('v2');
  let calls = 0;
  await assert.rejects(evaluate(current, {
    approval: createDemoApproval(initial), allowDemoApproval: true, mode: 'live-azure',
    source: testSource('live-azure'), invoke: async () => { calls++; },
  }), /SCOPE_CHANGED/);
  assert.equal(calls, 0);
});

test('empty or duplicate scope and cases fail before execution', async () => {
  for (const change of [
    inputs => { inputs.scope.requirements = []; },
    inputs => { inputs.scope.requirements.push(inputs.scope.requirements[0]); },
    inputs => { inputs.cases.cases = []; },
    inputs => { inputs.cases.cases.push(inputs.cases.cases[0]); },
    inputs => { inputs.requirements.requirements = []; },
  ]) {
    const inputs = await loadInputs();
    const approval = createDemoApproval(inputs);
    change(inputs);
    let calls = 0;
    await assert.rejects(evaluate(inputs, {
      approval, allowDemoApproval: true, mode: 'live-azure',
      source: testSource('live-azure'), invoke: async () => { calls++; },
    }), /EMPTY_OR_DUPLICATE_SCOPE/);
    assert.equal(calls, 0);
  }
});

test('unknown checks, absent criteria and invalid case links fail before execution', async () => {
  for (const change of [
    inputs => { inputs.requirements.requirements[0].checkId = 'not-implemented'; },
    inputs => { inputs.requirements.requirements[0].criterion = ''; },
    inputs => { inputs.requirements.requirements[0].caseIds = []; },
    inputs => { inputs.requirements.requirements[0].caseIds = ['CASE-UNKNOWN']; },
    inputs => { inputs.requirements.requirements[0].caseIds = ['CASE-01', 'CASE-01']; },
    inputs => { inputs.scope.requirements[0].version = 99; },
  ]) {
    const inputs = await loadInputs();
    const approval = createDemoApproval(inputs);
    change(inputs);
    let calls = 0;
    await assert.rejects(evaluate(inputs, {
      approval, allowDemoApproval: true, mode: 'live-azure', source: testSource('live-azure'),
      invoke: async () => { calls++; },
    }), /UNIMPLEMENTED_ACCEPTANCE_CHECK/);
    assert.equal(calls, 0);
  }
});

test('numeric coercion, non-integers and oversized budgets are not accepted', async () => {
  for (const budget of [
    { maxCallsPerRun: '4' }, { maxCallsPerRun: 5 }, { maxCallsPerRun: 1 },
    { maxOutputTokensPerCall: '180' }, { maxOutputTokensPerCall: 181 }, { maxOutputTokensPerCall: 1.5 },
    { maxInputCharactersPerCall: '7000' }, { maxInputCharactersPerCall: 7001 }, { maxInputCharactersPerCall: 0 },
  ]) {
    const inputs = await loadInputs();
    inputs.scope.budget = { ...inputs.scope.budget, ...budget };
    assert.throws(() => requireApprovedScope(inputs, null), /INVALID_BUDGET/);
  }
});

test('all case prompts are preflighted before the first call', async () => {
  const inputs = await loadInputs();
  inputs.corpus.documents[1].facts[0].text = 'Long synthetic fact. '.repeat(400);
  let calls = 0;
  await assert.rejects(evaluate(inputs, {
    approval: createDemoApproval(inputs), allowDemoApproval: true, mode: 'live-azure',
    source: testSource('live-azure'), invoke: async () => { calls++; },
  }), /INPUT_BUDGET_EXCEEDED/);
  assert.equal(calls, 0);
});

test('non-synthetic data, mismatched input versions and automatic release approval are prohibited', async () => {
  const inputs = await loadInputs();
  const approval = createDemoApproval(inputs);
  inputs.corpus.classification = 'production';
  assert.throws(() => requireApprovedScope(inputs, approval), /DATA_BOUNDARY/);
  inputs.corpus.classification = 'synthetic';
  inputs.corpus.version = '2.0';
  assert.throws(() => requireApprovedScope(inputs, approval), /INPUT_VERSION_MISMATCH/);
  inputs.corpus.version = '1.0';
  approval.externalRelease = 'approved';
  assert.throws(() => requireApprovedScope(inputs, approval, { allowDemoApproval: true, mode: 'local-fixture' }), /pending human review/);
});

test('malformed corpus and support routes fail before provider invocation', async () => {
  for (const change of [
    inputs => { inputs.corpus.documents[0].facts = []; },
    inputs => { inputs.corpus.documents[1].facts[0].id = 'FACT-E214'; },
    inputs => { inputs.corpus.supportRoute.url = 'https://example.com/tickets'; },
    inputs => { inputs.corpus.supportRoute.ticketCreated = true; },
  ]) {
    const inputs = await loadInputs();
    const approval = createDemoApproval(inputs);
    change(inputs);
    let calls = 0;
    await assert.rejects(evaluate(inputs, {
      approval, allowDemoApproval: true, mode: 'live-azure', source: testSource('live-azure'),
      invoke: async () => { calls++; },
    }), /INVALID_CORPUS|INVALID_SUPPORT_ROUTE/);
    assert.equal(calls, 0);
  }
});
