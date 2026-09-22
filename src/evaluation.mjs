import { randomUUID } from 'node:crypto';
import { requireApprovedScope } from './scope.mjs';
import { retrieve } from './retrieval.mjs';
import { callFixture, validateMessageBudget } from './provider.mjs';
import { materializeAnswer } from './answer.mjs';
import { sealEvidence } from './provenance.mjs';
import { evaluateGate, verifyCase } from './acceptance.mjs';
import { captureSource, verifySource } from './source.mjs';

export function prepareEvaluation(inputs, approval, options) {
  const binding = requireApprovedScope(inputs, approval, options);
  const prepared = inputs.cases.cases.map(gold => {
    const facts = retrieve(gold.question, inputs.corpus);
    validateMessageBudget(gold.question, facts, inputs.scope.budget);
    return { gold, facts };
  });
  return { binding, prepared };
}

export async function evaluate(inputs, {
  approval, mode = 'local-fixture', allowDemoApproval = false, source,
  invoke, onError = message => console.error(message),
} = {}) {
  const { binding, prepared } = prepareEvaluation(inputs, approval, { mode, allowDemoApproval });
  if (mode === 'live-azure' && typeof invoke !== 'function') throw new Error('LIVE_PROVIDER_REQUIRED: use the explicit operator command.');
  source ??= await captureSource({ requireCleanCommit: mode === 'live-azure' });
  if (!verifySource(source, mode)) throw new Error('INVALID_SOURCE: evidence needs a valid source snapshot; Azure also requires a clean commit.');
  const call = invoke || callFixture;
  const responses = [];
  const started = performance.now();
  for (const { gold, facts } of prepared) {
    const result = { caseId: gold.id, title: gold.title, question: gold.question, retrievedFacts: facts };
    try {
      const { selection, receipt } = await call({ question: gold.question, facts, budget: inputs.scope.budget });
      result.provider = receipt;
      result.selection = selection;
      result.answer = materializeAnswer(selection, facts, inputs.corpus);
      result.passed = verifyCase(result, gold, inputs.corpus);
    } catch (error) {
      result.error = { code: error.name, message: error.message };
      result.providerFailure = error.providerFailure || null;
      result.passed = false;
      onError(`${gold.id}: ${error.message}`);
    }
    responses.push(result);
  }
  const live = mode === 'live-azure';
  const usage = responses.reduce((total, result) => ({
    inputTokens: total.inputTokens + (result.provider?.usage?.inputTokens || 0),
    outputTokens: total.outputTokens + (result.provider?.usage?.outputTokens || 0),
  }), { inputTokens: 0, outputTokens: 0 });
  let evidence = sealEvidence({
    schemaVersion: 1, product: 'proofpack', runId: `pp-${randomUUID()}`,
    generatedAt: new Date().toISOString(), executionMode: mode, classification: 'synthetic',
    notice: live ? 'Operator-run model selections over synthetic inputs. Text is rendered extractively.'
      : 'Synthetic deterministic fixture. No model inference, recorded Azure answers or translations.',
    source, binding, requirementVersions: inputs.scope.requirements, scopeApproval: approval,
    execution: {
      providerAttempts: live ? responses.length : 0,
      completions: live ? responses.filter(result => result.provider).length : 0,
      refusals: live ? responses.filter(result => result.providerFailure?.state === 'provider-refused').length : 0,
      fixtureCases: live ? 0 : responses.length,
      retries: 0, budget: inputs.scope.budget,
    },
    responses,
    metrics: {
      kind: live ? 'measured-on-synthetic-cases' : 'synthetic',
      casePassCount: responses.filter(result => result.passed).length, caseCount: prepared.length, ...usage,
      localEvaluationDurationMs: Math.round((performance.now() - started) * 100) / 100,
    },
    approval: { state: 'pending', actorType: 'none', reason: 'Human review required' },
    limitations: [
      'Four synthetic cases, not a production accuracy or service-level estimate.',
      'The selector chooses approved fact IDs; the renderer supplies exact text, not free-form generation.',
      'Hashes detect change but are not signatures or independent attestations.',
      'A support route is displayed only; no ticket is created or sent.',
      'Automated demo approval never replaces human release review.',
    ],
  });
  const gate = evaluateGate(inputs, evidence, { expectedMode: mode, expectedSourceHash: source.contentHash });
  evidence = sealEvidence({ ...evidence, acceptance: gate });
  return { evidence, gate };
}
