import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInputs } from '../src/files.mjs';
import { materializeAnswer } from '../src/answer.mjs';
import { verifyAnswer, verifyEscalation } from '../src/grounding.mjs';
import { evaluateGate } from '../src/acceptance.mjs';
import { sealEvidence } from '../src/provenance.mjs';
import { makeTestEvidence } from './helpers.mjs';

const abstention = Object.freeze({ disposition: 'abstain', factIds: Object.freeze([]) });

test('abstention returns the exact .invalid route without any network request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Escalation cannot send requests.'));
  const { corpus } = await loadInputs();
  const answer = materializeAnswer(abstention, [], corpus);
  assert.deepEqual(answer.escalation, { ...corpus.supportRoute, ticketCreated: false });
  assert.equal(verifyEscalation(answer, corpus), true);
  assert.equal(fetch.mock.callCount(), 0);
});

test('missing, extra and malformed route fields fail loudly', async () => {
  const { corpus } = await loadInputs();
  for (const field of ['channel', 'url', 'reasonCode', 'notice']) {
    for (const value of [undefined, null, '', ' ', 42, [], {}]) {
      const changed = { ...corpus, supportRoute: { ...corpus.supportRoute, [field]: value } };
      assert.throws(() => materializeAnswer(abstention, [], changed), /INVALID_SUPPORT_ROUTE/);
    }
  }
  for (const route of [null, [], {}, { ...corpus.supportRoute, ticketCreated: false }, { ...corpus.supportRoute, reasonCode: 'TICKET_CREATED' }]) {
    assert.throws(() => materializeAnswer(abstention, [], { ...corpus, supportRoute: route }), /INVALID_SUPPORT_ROUTE/);
  }
});

test('unsafe support URLs are rejected even if they would otherwise match the corpus', async () => {
  const { corpus } = await loadInputs();
  for (const url of [
    'not a URL', '/tickets', '//support.atlas.invalid/tickets', 'http://support.atlas.invalid/tickets',
    'javascript:alert(1)', 'https://example.com/tickets', 'https://support.atlas.invalid.example.com/tickets',
    'https://invalid/tickets', 'https://127.0.0.1/tickets', 'https://user@support.atlas.invalid/tickets',
    'https://support.atlas.invalid/tickets?submit=true', 'https://support.atlas.invalid/tickets#send',
    ' https://support.atlas.invalid/tickets', 'https://support.atlas.invalid/ti\nckets',
    'https:\\\\support.atlas.invalid\\tickets', 'https:///support.atlas.invalid/tickets',
    'https://support..invalid/tickets', 'https://-support.invalid/tickets',
    'https://support_atlas.invalid/tickets', 'https://support.atlas.invalid./tickets',
    'https://support.atlas.invalid:99999/tickets', `https://${'a'.repeat(64)}.invalid/tickets`,
  ]) {
    assert.throws(() => materializeAnswer(abstention, [], { ...corpus, supportRoute: { ...corpus.supportRoute, url } }), /INVALID_SUPPORT_ROUTE/, url);
  }
});

test('altered escalation fields and side-effect claims cannot hide beside a valid answer', async () => {
  const { corpus } = await loadInputs();
  const answer = materializeAnswer(abstention, [], corpus);
  for (const patch of [
    { channel: 'Different desk' }, { url: 'https://another.invalid/tickets' }, { reasonCode: 'SENT' },
    { notice: 'Ticket sent.' }, { ticketCreated: true }, { ticketCreated: 'false' },
    { ticketCreated: null }, { ticketSent: true }, { action: 'send-ticket' },
  ]) {
    const changed = { ...answer, escalation: { ...answer.escalation, ...patch } };
    assert.equal(verifyEscalation(changed, corpus), false);
    assert.equal(verifyAnswer(changed, [], corpus), false);
  }
  for (const field of Object.keys(answer.escalation)) {
    const changed = structuredClone(answer);
    delete changed.escalation[field];
    assert.equal(verifyAnswer(changed, [], corpus), false);
  }
  assert.equal(verifyAnswer({ ...answer, ticketCreated: true }, [], corpus), false);
});

test('each answer owns its route; mutations do not alter other answers or source data', async () => {
  const { corpus } = await loadInputs();
  const original = structuredClone(corpus);
  Object.freeze(corpus.supportRoute);
  const first = materializeAnswer(abstention, [], corpus);
  const second = materializeAnswer(abstention, [], corpus);
  first.escalation.channel = 'Changed output only';
  first.factIds.push('FACT-INJECTION');
  assert.deepEqual(corpus, original);
  assert.equal(verifyAnswer(second, [], corpus), true);
});

test('a null route can meet initial grounding but never the added R-05 obligation', async () => {
  for (const version of ['v1', 'v2']) {
    const { inputs, evidence } = await makeTestEvidence(version);
    for (const result of evidence.responses.filter(item => item.answer.disposition === 'abstain')) {
      result.answer.escalation = null;
      assert.equal(verifyAnswer(result.answer, result.retrievedFacts, inputs.corpus), true);
      assert.equal(verifyEscalation(result.answer, inputs.corpus), false);
    }
    const gate = evaluateGate(inputs, sealEvidence(evidence));
    assert.equal(gate.passed, 4);
    assert.equal(gate.status, version === 'v1' ? 'passed' : 'blocked');
  }
});
