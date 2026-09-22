import { loadInputs } from './files.mjs';
import { createDemoApproval } from './scope.mjs';
import { evaluate } from './evaluation.mjs';
import { evaluateGate } from './acceptance.mjs';
import { captureSource } from './source.mjs';

export async function createDemoView() {
  const [initial, current, source] = await Promise.all([loadInputs('v1'), loadInputs('v2'), captureSource()]);
  const initialRun = await evaluate(initial, { approval: createDemoApproval(initial), allowDemoApproval: true, source });
  const currentRun = await evaluate(current, { approval: createDemoApproval(current), allowDemoApproval: true, source });
  const stage = (title, inputs, evidence) => ({
    title, scopeVersion: inputs.scope.version, evidence,
    gate: evaluateGate(inputs, evidence, { expectedMode: 'local-fixture', expectedSourceHash: source.contentHash }),
  });
  return {
    schemaVersion: 1, product: 'proofpack', readOnly: true,
    notice: 'Synthetic offline demo. Two local fixture reports; no model calls or network requests.',
    briefing: current.briefing,
    cases: current.cases.cases,
    corpus: current.corpus,
    latest: currentRun.evidence,
    manifest: {
      product: 'ProofPack', executionMode: 'local-fixture', sourceHash: source.contentHash,
      inferenceEnabled: false, mutationsEnabled: false, externalRelease: 'pending-human-review',
    },
    stages: {
      initial: stage('Initial scope', initial, initialRun.evidence),
      changed: {
        ...stage('Changed scope', current, initialRun.evidence),
        method: 'Recheck the unchanged scope-v1 report against scope v2. No new execution is used for this comparison.',
      },
      validated: stage('Fresh evidence', current, currentRun.evidence),
    },
  };
}

let savedView;

export async function loadView() {
  savedView ??= createDemoView();
  const view = await savedView;
  const current = await captureSource();
  if (view.manifest.sourceHash !== current.contentHash) {
    throw new Error('SOURCE_CHANGED: restart the viewer to bind its fixtures to the current source and inputs.');
  }
  return view;
}
