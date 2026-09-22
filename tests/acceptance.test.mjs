import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInputs } from '../src/files.mjs';
import { evaluateGate } from '../src/acceptance.mjs';
import { makeBinding, sealEvidence, verifyEvidenceIntegrity } from '../src/provenance.mjs';
import { createDemoApproval } from '../src/scope.mjs';
import { makeTestEvidence } from './helpers.mjs';

test('missing evidence blocks every requirement and release', async () => {
  const gate = evaluateGate(await loadInputs(), null);
  assert.equal(gate.status, 'blocked');
  assert.equal(gate.passed, 0);
  assert.equal(gate.rows.find(row => row.id === 'R-05').state, 'missing');
  assert.equal(gate.externalReleaseAllowed, false);
});

test('initial 4/4 evidence becomes 0/5 under a changed scope, with identical questions and corpus', async () => {
  const { inputs, evidence } = await makeTestEvidence();
  const current = await loadInputs('v2');
  assert.deepEqual(inputs.corpus, current.corpus);
  assert.deepEqual(inputs.cases, current.cases);
  assert.equal(evaluateGate(inputs, evidence).passed, 4);
  const gate = evaluateGate(current, evidence);
  assert.equal(gate.status, 'blocked');
  assert.equal(gate.passed, 0);
  assert.deepEqual(gate.rows.map(row => row.state), ['stale', 'stale', 'stale', 'stale', 'missing']);
});

test('fresh fixture meets 5/5 but never authorizes external release', async () => {
  const { gate, evidence } = await makeTestEvidence('v2');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.passed, 5);
  assert.equal(gate.total, 5);
  assert.equal(gate.externalReleaseAllowed, false);
  assert.deepEqual(gate.approval, { state: 'pending', actorType: 'none', reason: 'Human review required' });
  assert.ok(verifyEvidenceIntegrity(evidence));
});

test('a current-scope report without the required escalation remains blocked', async () => {
  const { inputs, evidence } = await makeTestEvidence('v2');
  for (const result of evidence.responses) if (result.answer.disposition === 'abstain') result.answer.escalation = null;
  const gate = evaluateGate(inputs, sealEvidence(evidence));
  assert.equal(gate.status, 'blocked');
  assert.equal(gate.passed, 4);
  assert.equal(gate.rows.find(row => row.id === 'R-05').state, 'failed');
});

test('criterion, corpus and case changes invalidate evidence without a version bump', async () => {
  for (const change of [
    input => { input.requirements.requirements[0].criterion += ' A new obligation.'; },
    input => { input.corpus.documents[0].facts[0].text += ' A changed fact.'; },
    input => { input.cases.cases[0].question += ' Please explain.'; },
  ]) {
    const { inputs, evidence } = await makeTestEvidence();
    change(inputs);
    assert.equal(evaluateGate(inputs, evidence).rows[0].state, 'stale');
  }
});

test('tampering fails integrity; resealing pass flags cannot bless fabricated content', async () => {
  const { inputs, evidence } = await makeTestEvidence();
  evidence.responses[0].answer.text += ' Guaranteed service availability.';
  assert.equal(evaluateGate(inputs, evidence).rows[0].state, 'invalid');
  evidence.responses[0].passed = true;
  evidence.acceptance.status = 'passed';
  assert.equal(evaluateGate(inputs, sealEvidence(evidence)).rows[0].status, 'fail');
});

test('literal citations and recorded retrieval are rechecked, not trusted as assertions', async () => {
  for (const change of [
    result => { result.answer.citations[0].quote = 'A paraphrase is not the approved text.'; },
    result => { result.answer.citations[0].documentVersion = '2.0'; },
    result => { result.retrievedFacts[0].text = 'Different retrieved context'; },
    result => { result.selection.factIds = ['FACT-TOKEN']; },
  ]) {
    const { inputs, evidence } = await makeTestEvidence();
    change(evidence.responses[0]);
    assert.equal(evaluateGate(inputs, sealEvidence(evidence)).rows[0].status, 'fail');
  }
});

test('duplicate, missing and unknown cases cannot satisfy traceability', async () => {
  for (const change of [
    evidence => evidence.responses.push(structuredClone(evidence.responses[0])),
    evidence => evidence.responses.pop(),
    evidence => { evidence.responses[0].caseId = 'CASE-UNKNOWN'; },
  ]) {
    const { inputs, evidence } = await makeTestEvidence();
    change(evidence);
    assert.equal(evaluateGate(inputs, sealEvidence(evidence)).rows.find(row => row.id === 'R-04').status, 'fail');
  }
});

test('fixture mode and source cannot satisfy a requested live or different-source gate', async () => {
  const { inputs, evidence } = await makeTestEvidence();
  for (const expected of [
    { expectedMode: 'live-azure' }, { expectedSourceHash: 'b'.repeat(64) }, { expectedSourceCommit: 'b'.repeat(40) },
  ]) assert.equal(evaluateGate(inputs, evidence, expected).status, 'blocked');
});

test('fake live mode, missing source manifests and altered approvals fail traceability', async () => {
  for (const change of [
    evidence => { evidence.executionMode = 'live-azure'; },
    evidence => { evidence.source.files = []; },
    evidence => { evidence.source.contentHash = 'b'.repeat(64); },
    evidence => { evidence.scopeApproval.actorType = 'human'; },
    evidence => { evidence.scopeApproval.externalRelease = 'approved'; },
    evidence => { evidence.responses[0].provider.usage.inputTokens = 1; },
    evidence => { evidence.execution.providerAttempts = 1; },
    evidence => { evidence.requirementVersions = []; },
  ]) {
    const { inputs, evidence } = await makeTestEvidence();
    change(evidence);
    assert.equal(evaluateGate(inputs, sealEvidence(evidence)).rows.find(row => row.id === 'R-04').status, 'fail');
  }
});

test('unknown checks and versions cannot pass on unrelated evidence even after rebinding', async () => {
  for (const change of [
    inputs => { inputs.requirements.requirements[0].checkId = 'unimplemented-latency-slo'; },
    inputs => { inputs.requirements.requirements[0].version = 2; inputs.scope.requirements[0].version = 2; },
    inputs => { inputs.requirements.requirements[0].id = 'R-99'; inputs.scope.requirements[0].id = 'R-99'; },
    inputs => { inputs.requirements.requirements[0].caseIds = []; },
  ]) {
    const { inputs, evidence } = await makeTestEvidence();
    change(inputs);
    evidence.binding = makeBinding(inputs);
    const gate = evaluateGate(inputs, sealEvidence(evidence));
    assert.equal(gate.status, 'blocked');
    assert.match(gate.inputError, /UNIMPLEMENTED_ACCEPTANCE_CHECK/);
    assert.equal(gate.passed, 0);
  }
});

test('empty or duplicate scope never produces vacuous acceptance', async () => {
  const { inputs, evidence } = await makeTestEvidence();
  inputs.scope.requirements = [];
  const empty = evaluateGate(inputs, evidence);
  assert.equal(empty.status, 'blocked');
  assert.equal(empty.total, 0);
  assert.match(empty.inputError, /EMPTY_OR_DUPLICATE_SCOPE/);
  assert.equal(empty.externalReleaseAllowed, false);
});

test('changing a criterion requires a new scope approval as well as a new report', async () => {
  const { inputs, evidence } = await makeTestEvidence();
  inputs.requirements.requirements[0].criterion += ' Additional review.';
  evidence.binding = makeBinding(inputs);
  assert.equal(evaluateGate(inputs, sealEvidence(evidence)).rows.find(row => row.id === 'R-04').status, 'fail');
  evidence.scopeApproval = createDemoApproval(inputs);
  assert.equal(evaluateGate(inputs, sealEvidence(evidence)).status, 'passed');
});
