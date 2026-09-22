import { readFileSync } from 'node:fs';

const selectorPrompt = readFileSync(new URL('../prompts/fact-selector.txt', import.meta.url), 'utf8').trim();

function normalize(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function retrieve(question, corpus, { limit = 3 } = {}) {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000) throw new Error('Question must contain 1-1000 characters.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error('Retrieval limit must be 1-3.');
  const words = new Set(normalize(question).match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []);
  const matches = [];
  for (const document of corpus.documents) {
    if (document.trust !== 'approved-synthetic') continue;
    for (const fact of document.facts) {
      const matched = [...new Set(fact.keywords.map(normalize))].filter(word => words.has(word));
      const score = matched.reduce((sum, keyword) => sum + (/\d/.test(keyword) ? 3 : 1), 0);
      if (score >= 2) matches.push({ factId: fact.id, documentId: document.id, documentVersion: document.version, title: document.title, text: fact.text, score });
    }
  }
  return matches.sort((a, b) => b.score - a.score || a.factId.localeCompare(b.factId)).slice(0, limit);
}

export function makeMessages(question, facts) {
  return [
    { role: 'system', content: selectorPrompt },
    { role: 'user', content: JSON.stringify({ question, approvedFacts: facts.map(({ factId, documentId, documentVersion, text }) => ({ factId, documentId, documentVersion, text })) }) },
  ];
}
