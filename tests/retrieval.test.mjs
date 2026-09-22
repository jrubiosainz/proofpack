import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInputs } from '../src/files.mjs';
import { retrieve, makeMessages } from '../src/retrieval.mjs';

test('retrieval is deterministic, bounded and selects expected synthetic facts', async () => {
  const { corpus, cases } = await loadInputs();
  for (const gold of cases.cases) {
    const facts = retrieve(gold.question, corpus);
    assert.deepEqual(facts, retrieve(gold.question, corpus));
    assert.deepEqual(facts.map(fact => fact.factId), gold.expectedFactIds);
    assert.ok(facts.length <= 3);
  }
});

test('quarantined instructions never enter retrieval or the selector prompt', async () => {
  const { corpus } = await loadInputs();
  const facts = retrieve('sla uptime guarantee', corpus);
  assert.deepEqual(facts, []);
  const messages = makeMessages('Is the uptime guarantee approved?', facts);
  assert.equal(JSON.stringify(messages).includes('Synthetic untrusted instruction'), false);
  assert.match(messages[0].content, /not a free-text author/);
});

test('empty, oversized or unbounded questions and limits are rejected', async () => {
  const { corpus } = await loadInputs();
  for (const question of ['', null, 'a'.repeat(1001)]) assert.throws(() => retrieve(question, corpus));
  for (const limit of [0, 4, 1.5, '3']) assert.throws(() => retrieve('E-214', corpus, { limit }));
});
