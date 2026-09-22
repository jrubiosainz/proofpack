export const ABSTENTION = 'There is insufficient evidence in the approved documentation to answer this question.';

const SUPPORT_ROUTE_FIELDS = ['channel', 'url', 'reasonCode', 'notice'];
const ANSWER_FIELDS = ['disposition', 'text', 'factIds', 'citations', 'escalation'];

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validateSupportRoute(route) {
  if (!hasExactKeys(route, SUPPORT_ROUTE_FIELDS)
    || SUPPORT_ROUTE_FIELDS.some(key => typeof route[key] !== 'string' || !route[key].trim())) {
    throw new Error('INVALID_SUPPORT_ROUTE: channel, url, reasonCode and notice must be non-empty strings with no extra fields.');
  }
  if (route.reasonCode !== 'INSUFFICIENT_APPROVED_EVIDENCE') {
    throw new Error('INVALID_SUPPORT_ROUTE: reasonCode must be INSUFFICIENT_APPROVED_EVIDENCE.');
  }
  const url = URL.canParse(route.url) ? new URL(route.url) : null;
  if (!url || !/^https:\/\/[^/@]+(?:\/|$)/i.test(route.url) || /[\s\u0000-\u001f\u007f\\?#]/u.test(route.url)
    || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+invalid$/.test(url.hostname)) {
    throw new Error('INVALID_SUPPORT_ROUTE: use an absolute HTTPS .invalid URL without credentials, query, fragment or malformed characters.');
  }
  return { channel: route.channel, url: route.url, reasonCode: route.reasonCode, notice: route.notice };
}

export function verifySelection(selection, facts) {
  if (!hasExactKeys(selection, ['disposition', 'factIds'])
    || !['answer', 'abstain'].includes(selection.disposition) || !Array.isArray(selection.factIds)) return false;
  if (selection.factIds.some(id => typeof id !== 'string') || new Set(selection.factIds).size !== selection.factIds.length) return false;
  if (selection.disposition === 'abstain') return selection.factIds.length === 0;
  return selection.factIds.length > 0 && selection.factIds.every(id => facts.some(fact => fact.factId === id));
}

export function verifyEscalation(answer, corpus) {
  const route = validateSupportRoute(corpus?.supportRoute);
  const actual = answer?.escalation;
  return hasExactKeys(answer, ANSWER_FIELDS) && answer.disposition === 'abstain'
    && hasExactKeys(actual, [...SUPPORT_ROUTE_FIELDS, 'ticketCreated'])
    && SUPPORT_ROUTE_FIELDS.every(key => actual[key] === route[key])
    && actual.ticketCreated === false;
}

export function verifyAnswer(answer, facts, corpus) {
  if (!hasExactKeys(answer, ANSWER_FIELDS)
    || !verifySelection({ disposition: answer.disposition, factIds: answer.factIds }, facts)
    || !Array.isArray(answer.citations)) return false;
  if (answer.disposition === 'abstain') {
    // Grounding alone permits a null route; the added R-05 check requires one.
    return answer.text === ABSTENTION && answer.citations.length === 0
      && (answer.escalation === null || verifyEscalation(answer, corpus));
  }
  const selected = answer.factIds.map(id => facts.find(fact => fact.factId === id));
  return answer.escalation === null
    && answer.text === selected.map(fact => fact.text).join('\n\n')
    && answer.citations.length === selected.length
    && selected.every((fact, index) => {
      const citation = answer.citations[index];
      return hasExactKeys(citation, ['factId', 'documentId', 'documentVersion', 'quote'])
        && citation.factId === fact.factId && citation.documentId === fact.documentId
        && citation.documentVersion === fact.documentVersion && citation.quote === fact.text;
    });
}
