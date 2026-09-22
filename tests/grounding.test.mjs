import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInputs } from '../src/files.mjs';
import { retrieve } from '../src/retrieval.mjs';
import { materializeAnswer } from '../src/answer.mjs';
import { verifyAnswer, verifySelection, ABSTENTION } from '../src/grounding.mjs';

test('supported answers are exact approved text with versioned literal citations', async () => {
  const { corpus, cases } = await loadInputs();
  for (const gold of cases.cases.filter(item => item.expectedDisposition === 'answer')) {
    const facts = retrieve(gold.question, corpus);
    const answer = materializeAnswer({ disposition: 'answer', factIds: gold.expectedFactIds }, facts, corpus);
    assert.equal(verifyAnswer(answer, facts, corpus), true);
    assert.equal(answer.text, facts.map(fact => fact.text).join('\n\n'));
    assert.equal(answer.citations[0].quote, facts[0].text);
    assert.equal(answer.citations[0].documentVersion, '1.0');
    assert.equal(answer.escalation, null);
  }
});

test('unretrieved facts, extra claims, duplicates and contradictory abstentions are rejected', async () => {
  const { corpus } = await loadInputs();
  const facts = retrieve('E-214', corpus);
  for (const selection of [
    { disposition: 'answer', factIds: ['FACT-INJECTION'] },
    { disposition: 'answer', factIds: ['FACT-TOKEN'] },
    { disposition: 'answer', factIds: ['FACT-E214'], extraClaim: 'guaranteed' },
    { disposition: 'answer', factIds: ['FACT-E214', 'FACT-E214'] },
    { disposition: 'abstain', factIds: ['FACT-E214'] },
    { disposition: 'answer', factIds: [] }, null, [],
  ]) {
    assert.equal(verifySelection(selection, facts), false);
    assert.throws(() => materializeAnswer(selection, facts, corpus), /UNSUPPORTED_CLAIM/);
  }
});

test('paraphrases and translation-like presentation changes cannot replace literal evidence', async () => {
  const { corpus } = await loadInputs();
  const facts = retrieve('E-214', corpus);
  const answer = materializeAnswer({ disposition: 'answer', factIds: ['FACT-E214'] }, facts, corpus);
  for (const patch of [
    { text: 'Check connectivity and try again later.' },
    { text: 'A translated reading is not the original approved fact.' },
    { citations: [{ ...answer.citations[0], quote: 'Same meaning, different wording.' }] },
    { citations: [{ ...answer.citations[0], documentVersion: '2.0' }] },
    { ticketCreated: true }, { escalation: { ...corpus.supportRoute, ticketCreated: false } },
  ]) assert.equal(verifyAnswer({ ...answer, ...patch }, facts, corpus), false);
});

test('abstention contains no invented facts or citations even when facts were retrieved', async () => {
  const { corpus } = await loadInputs();
  const facts = retrieve('E-214', corpus);
  const answer = materializeAnswer({ disposition: 'abstain', factIds: [] }, facts, corpus);
  assert.equal(answer.text, ABSTENTION);
  assert.deepEqual(answer.factIds, []);
  assert.deepEqual(answer.citations, []);
  assert.equal(verifyAnswer(answer, facts, corpus), true);
  for (const patch of [{ text: `${ABSTENTION} A ticket was sent.` }, { factIds: ['FACT-E214'] }, { citations: [{}] }]) {
    assert.equal(verifyAnswer({ ...answer, ...patch }, facts, corpus), false);
  }
});

test('multi-fact rendering preserves selected order and owns its output objects', async () => {
  const { corpus } = await loadInputs();
  const facts = retrieve('E-214 buffer 500 token tokens', corpus);
  assert.equal(facts.length, 3);
  const selection = { disposition: 'answer', factIds: [...facts].reverse().map(fact => fact.factId) };
  const first = materializeAnswer(selection, facts, corpus);
  const second = materializeAnswer(selection, facts, corpus);
  assert.equal(first.text, [...facts].reverse().map(fact => fact.text).join('\n\n'));
  first.factIds.push('FACT-INJECTION');
  first.citations[0].quote = 'Changed output';
  assert.equal(verifyAnswer(first, facts, corpus), false);
  assert.equal(verifyAnswer(second, facts, corpus), true);
  assert.equal(selection.factIds.length, 3);
});
