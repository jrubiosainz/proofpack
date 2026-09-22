import { activeRequirements, digest, makeBinding } from './provenance.mjs';
import { validateSupportRoute } from './grounding.mjs';

const EXECUTABLE_CHECKS = new Map([
  ['R-01', 'grounded-supported'],
  ['R-02', 'unsupported-abstention'],
  ['R-03', 'untrusted-isolated'],
  ['R-04', 'traceability-complete'],
  ['R-05', 'explicit-escalation'],
]);
const MODES = ['local-fixture', 'live-azure'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const unique = values => new Set(values).size === values.length;
const identifiers = items => Array.isArray(items) && items.length > 0
  && items.every(item => item && nonempty(item.id)) && unique(items.map(item => item.id));
const stringSet = values => Array.isArray(values) && values.every(nonempty) && unique(values);

export class InputError extends Error {}

export function hasExecutableCheck(requirement) {
  return requirement.version === 1 && EXECUTABLE_CHECKS.has(requirement.id)
    && EXECUTABLE_CHECKS.get(requirement.id) === requirement.checkId;
}

export function validateInputs(inputs) {
  if (!identifiers(inputs?.scope?.requirements) || !identifiers(inputs?.cases?.cases)
    || !identifiers(inputs?.requirements?.requirements)) {
    throw new InputError('EMPTY_OR_DUPLICATE_SCOPE: non-empty, unique requirement and case IDs are required.');
  }
  const { scope, cases, corpus, requirements } = inputs;
  const budget = scope.budget;
  if (!budget || !Number.isInteger(budget.maxCallsPerRun) || budget.maxCallsPerRun < 1 || budget.maxCallsPerRun > 4
    || !Number.isInteger(budget.maxOutputTokensPerCall) || budget.maxOutputTokensPerCall < 1 || budget.maxOutputTokensPerCall > 180
    || !Number.isInteger(budget.maxInputCharactersPerCall) || budget.maxInputCharactersPerCall < 1 || budget.maxInputCharactersPerCall > 7000
    || cases.cases.length > budget.maxCallsPerRun) {
    throw new InputError('INVALID_BUDGET: require 1-4 calls, 1-180 output tokens and 1-7000 input characters, with all cases inside the call budget.');
  }
  if (scope.classification !== 'synthetic' || corpus?.classification !== 'synthetic' || cases.classification !== 'synthetic') {
    throw new InputError('DATA_BOUNDARY: only explicitly synthetic inputs are permitted.');
  }
  if (scope.corpusVersion !== corpus.version || scope.caseSetVersion !== cases.version) {
    throw new InputError('INPUT_VERSION_MISMATCH: scope must name the exact corpus and case-set versions.');
  }
  if (!stringSet(scope.allowedExecutionModes) || scope.allowedExecutionModes.length === 0
    || scope.allowedExecutionModes.some(mode => !MODES.includes(mode))
    || scope.externalRelease !== 'human-review-required') {
    throw new InputError('INVALID_EXECUTION_POLICY: select supported modes and retain human release review.');
  }
  if (!identifiers(corpus.documents) || corpus.documents.some(document =>
    !nonempty(document.version) || !nonempty(document.title)
    || !['approved-synthetic', 'quarantined-synthetic'].includes(document.trust)
    || !identifiers(document.facts) || document.facts.some(fact => !nonempty(fact.text)
      || !stringSet(fact.keywords) || fact.keywords.length === 0))
    || !unique(corpus.documents.flatMap(document => document.facts.map(fact => fact.id)))) {
    throw new InputError('INVALID_CORPUS: use unique versioned documents and facts with explicit trust and keywords.');
  }
  try {
    validateSupportRoute(corpus.supportRoute);
  } catch (error) {
    if (!error.message.startsWith('INVALID_SUPPORT_ROUTE:')) throw error;
    throw new InputError(error.message);
  }
  if (cases.cases.some(item => !nonempty(item.question) || item.question.length > 1000
    || !['answer', 'abstain'].includes(item.expectedDisposition)
    || !stringSet(item.expectedFactIds) || !stringSet(item.expectedDocumentIds)
    || (item.expectedDisposition === 'abstain' && (item.expectedFactIds.length || item.expectedDocumentIds.length))
    || (item.expectedDisposition === 'answer' && (!item.expectedFactIds.length || !item.expectedDocumentIds.length)))) {
    throw new InputError('INVALID_CASE: each bounded question needs an exact disposition, fact set and document set.');
  }
  const caseIds = new Set(cases.cases.map(item => item.id));
  for (const ref of scope.requirements) {
    const requirement = requirements.requirements.find(item => item.id === ref.id && item.version === ref.version);
    if (!requirement || !hasExecutableCheck(requirement) || !nonempty(requirement.title) || !nonempty(requirement.criterion)
      || !stringSet(requirement.caseIds) || requirement.caseIds.length === 0
      || requirement.caseIds.some(id => !caseIds.has(id))) {
      throw new InputError('UNIMPLEMENTED_ACCEPTANCE_CHECK: every criterion needs a registered executable version and non-empty, unique, existing case links.');
    }
  }
  return activeRequirements(scope, requirements);
}

export function createDemoApproval(inputs, approvedAt = new Date().toISOString()) {
  validateInputs(inputs);
  const binding = makeBinding(inputs);
  return {
    state: 'demo-approved', actor: 'Explicit synthetic demo operator', actorType: 'automated-demo',
    scopeHash: binding.scopeHash, inputBindingHash: digest(binding), approvedAt,
    externalRelease: 'pending-human-review',
    notice: 'Demo approval only. Not human approval or permission to release externally.',
  };
}

export function requireApprovedScope(inputs, approval, { allowDemoApproval = false, mode } = {}) {
  validateInputs(inputs);
  const binding = makeBinding(inputs);
  if (!approval || approval.state !== 'demo-approved' || approval.actorType !== 'automated-demo') {
    throw new Error('SCOPE_REVIEW_REQUIRED: create an explicit demo approval first.');
  }
  if (!allowDemoApproval) throw new Error('DEMO_OPT_IN_REQUIRED: explicitly opt in to demo approval; this is not human approval.');
  if (approval.scopeHash !== binding.scopeHash || approval.inputBindingHash !== digest(binding)) {
    throw new Error('SCOPE_CHANGED: review and approve the exact new scope and inputs before execution.');
  }
  if (!inputs.scope.allowedExecutionModes.includes(mode)) throw new Error('EXECUTION_MODE_NOT_APPROVED');
  if (approval.externalRelease !== 'pending-human-review') throw new Error('External release must remain pending human review.');
  return binding;
}
