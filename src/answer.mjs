import { ABSTENTION, validateSupportRoute, verifySelection } from './grounding.mjs';

export function materializeAnswer(selection, facts, corpus) {
  if (!verifySelection(selection, facts)) throw new Error('UNSUPPORTED_CLAIM: selection is outside the retrieved, approved fact set.');
  if (selection.disposition === 'abstain') {
    return {
      disposition: 'abstain', text: ABSTENTION, factIds: [], citations: [],
      escalation: { ...validateSupportRoute(corpus?.supportRoute), ticketCreated: false },
    };
  }
  const selected = selection.factIds.map(id => facts.find(fact => fact.factId === id));
  return {
    disposition: 'answer',
    text: selected.map(fact => fact.text).join('\n\n'),
    factIds: [...selection.factIds],
    citations: selected.map(fact => ({ factId: fact.factId, documentId: fact.documentId, documentVersion: fact.documentVersion, quote: fact.text })),
    escalation: null,
  };
}
