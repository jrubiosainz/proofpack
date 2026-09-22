import { createHash } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function activeRequirements(scope, catalog) {
  return scope.requirements.map(ref => {
    const requirement = catalog.requirements.find(item => item.id === ref.id && item.version === ref.version);
    if (!requirement) throw new Error(`Unknown requirement/version: ${ref.id}@${ref.version}`);
    return requirement;
  });
}

export function makeBinding({ scope, corpus, cases, requirements }) {
  return {
    scopeHash: digest(scope),
    corpusHash: digest(corpus),
    casesHash: digest(cases),
    requirementsHash: digest(activeRequirements(scope, requirements)),
  };
}

export function sealEvidence(evidence) {
  const { integrity, ...content } = evidence;
  return { ...content, integrity: { algorithm: 'sha256', contentHash: digest(content), signed: false } };
}

export function verifyEvidenceIntegrity(evidence) {
  if (!evidence || !evidence.integrity) return false;
  const { integrity, ...content } = evidence;
  return integrity.algorithm === 'sha256' && integrity.signed === false && integrity.contentHash === digest(content);
}
