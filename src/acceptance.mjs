import { makeBinding, canonical, digest, verifyEvidenceIntegrity } from './provenance.mjs';
import { retrieve } from './retrieval.mjs';
import { verifyAnswer, verifyEscalation } from './grounding.mjs';
import { validateInputs, InputError } from './scope.mjs';
import { verifySource } from './source.mjs';

function sameSet(actual, expected) {
  return Array.isArray(actual) && canonical([...actual].sort()) === canonical([...expected].sort());
}

export function verifyCase(result, gold, corpus) {
  if (!result || result.error || !gold || result.question !== gold.question
    || !result.answer || !Array.isArray(result.answer.citations)) return false;
  const facts = retrieve(gold.question, corpus);
  return result.answer.disposition === gold.expectedDisposition
    && sameSet(result.answer.factIds, gold.expectedFactIds)
    && sameSet(result.answer.citations.map(item => item?.documentId), gold.expectedDocumentIds)
    && canonical(result.retrievedFacts) === canonical(facts)
    && canonical(result.selection) === canonical({ disposition: result.answer.disposition, factIds: result.answer.factIds })
    && verifyAnswer(result.answer, facts, corpus);
}

function validReceipt(result, mode, budget) {
  const receipt = result.provider;
  if (!receipt || receipt.mode !== mode || receipt.retries !== 0
    || !Number.isFinite(receipt.latencyMs) || receipt.latencyMs < 0) return false;
  if (mode === 'local-fixture') {
    return receipt.model === 'deterministic-fixture-not-an-llm'
      && receipt.usage?.inputTokens === 0 && receipt.usage?.outputTokens === 0;
  }
  return mode === 'live-azure' && typeof receipt.requestId === 'string' && receipt.requestId.length > 0
    && receipt.finishReason === 'stop'
    && Number.isInteger(receipt.usage?.inputTokens) && receipt.usage.inputTokens > 0
    && Number.isInteger(receipt.usage?.outputTokens) && receipt.usage.outputTokens > 0
    && receipt.usage.outputTokens <= budget.maxOutputTokensPerCall;
}

function checkRequirement(requirement, evidence, inputs) {
  const results = Array.isArray(evidence.responses) ? evidence.responses : [];
  const cases = inputs.cases.cases;
  const relevant = requirement.caseIds.map(id => ({ result: results.find(item => item?.caseId === id), gold: cases.find(item => item.id === id) }));
  if (relevant.some(({ result, gold }) => !verifyCase(result, gold, inputs.corpus))) {
    return { passed: false, reason: 'A result is missing or its literal answer, selection, retrieval or citation does not satisfy the expected case.' };
  }
  if (requirement.id === 'R-03') {
    const trustedIds = new Set(inputs.corpus.documents.filter(doc => doc.trust === 'approved-synthetic').map(doc => doc.id));
    const safe = results.every(result => Array.isArray(result?.retrievedFacts) && result.retrievedFacts.every(fact => trustedIds.has(fact?.documentId)));
    return { passed: safe, reason: safe ? 'The unapproved attachment stayed outside retrieval and the answer.' : 'Unapproved context was detected.' };
  }
  if (requirement.id === 'R-04') {
    const uniqueCases = new Set(results.map(item => item?.caseId));
    const expectedCases = new Set(cases.map(item => item.id));
    const live = evidence.executionMode === 'live-azure';
    const passed = verifySource(evidence.source, evidence.executionMode)
      && uniqueCases.size === results.length && results.length === cases.length
      && [...uniqueCases].every(id => expectedCases.has(id))
      && canonical(evidence.requirementVersions) === canonical(inputs.scope.requirements)
      && evidence.scopeApproval?.actorType === 'automated-demo' && evidence.scopeApproval.state === 'demo-approved'
      && evidence.scopeApproval.scopeHash === evidence.binding.scopeHash
      && evidence.scopeApproval.inputBindingHash === digest(evidence.binding)
      && evidence.scopeApproval.externalRelease === 'pending-human-review'
      && evidence.execution?.providerAttempts === (live ? results.length : 0)
      && evidence.execution?.completions === (live ? results.length : 0)
      && evidence.execution?.refusals === 0 && evidence.execution?.retries === 0
      && results.every(item => validReceipt(item, evidence.executionMode, inputs.scope.budget));
    return {
      passed,
      reason: passed ? 'Unique cases, exact source/input hashes, demo approval and mode-appropriate receipts are present.'
        : 'Source binding, unique cases, demo approval or execution receipts are invalid.',
    };
  }
  if (requirement.id === 'R-05') {
    const passed = relevant.every(({ result }) => verifyEscalation(result.answer, inputs.corpus))
      && results.filter(result => result?.answer?.disposition === 'answer').every(result => result.answer.escalation === null);
    return { passed, reason: passed ? 'Abstentions include the approved channel and reason. No ticket was sent.' : 'An abstention lacks the explicit route required by R-05.' };
  }
  return { passed: true, reason: 'All linked cases satisfy the exact criterion, without free-form claims.' };
}

export function evaluateGate(inputs, evidence, { expectedMode, expectedSourceHash, expectedSourceCommit } = {}) {
  const review = { externalReleaseAllowed: false, approval: { state: 'pending', actorType: 'none', reason: 'Human review required' } };
  let requirements;
  try {
    requirements = validateInputs(inputs);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const refs = Array.isArray(inputs?.scope?.requirements) ? inputs.scope.requirements : [];
    return {
      scopeVersion: inputs?.scope?.version ?? null, status: 'blocked', passed: 0, total: refs.length,
      inputError: error.message,
      rows: refs.map(ref => ({ ...ref, status: 'fail', state: 'invalid', details: error.message, runId: null })),
      ...review,
    };
  }
  const binding = makeBinding(inputs);
  const integrityValid = verifyEvidenceIntegrity(evidence);
  const bindingMatches = evidence && canonical(evidence.binding) === canonical(binding);
  const provenanceMatches = evidence && inputs.scope.allowedExecutionModes.includes(evidence.executionMode)
    && (!expectedMode || evidence.executionMode === expectedMode)
    && (!expectedSourceHash || evidence.source?.contentHash === expectedSourceHash)
    && (!expectedSourceCommit || evidence.source?.commit === expectedSourceCommit);
  const rows = requirements.map(requirement => {
    let state = 'missing';
    let result = { passed: false, reason: 'No execution evidence exists for this requirement.' };
    if (evidence) {
      if (!integrityValid) {
        state = 'invalid';
        result.reason = 'The SHA-256 does not match the evidence content.';
      } else if (!bindingMatches) {
        const existed = Array.isArray(evidence.requirementVersions)
          && evidence.requirementVersions.some(item => item?.id === requirement.id && item.version === requirement.version);
        state = existed ? 'stale' : 'missing';
        result.reason = existed ? 'Evidence belongs to different scope or inputs. A new execution is required.'
          : 'Requirement added after execution: no applicable evidence exists.';
      } else if (!provenanceMatches) {
        state = 'invalid';
        result.reason = 'Execution mode or source does not match the requested one.';
      } else {
        result = checkRequirement(requirement, evidence, inputs);
        state = result.passed ? 'verified' : 'failed';
      }
    }
    return { ...requirement, status: result.passed ? 'pass' : 'fail', state, details: result.reason, runId: evidence?.runId || null };
  });
  return {
    scopeVersion: inputs.scope.version, scopeHash: binding.scopeHash,
    status: rows.length > 0 && rows.every(row => row.status === 'pass') ? 'passed' : 'blocked',
    passed: rows.filter(row => row.status === 'pass').length, total: rows.length, rows, ...review,
  };
}
