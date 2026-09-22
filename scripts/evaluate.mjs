import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadInputs, readJson, writeArtifact, projectPath } from '../src/files.mjs';
import { prepareEvaluation, evaluate } from '../src/evaluation.mjs';
import { captureSource } from '../src/source.mjs';
import { callFoundry } from '../src/provider.mjs';
import { readAzureConfig, verifyAzureBoundary, operatorToken } from './azure.mjs';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'local-fixture' }, scope: { type: 'string', default: 'v2' },
    'allow-demo-approval': { type: 'boolean', default: false },
  },
});
if (!['local-fixture', 'live-azure'].includes(values.mode)) throw new Error('Choose local-fixture or live-azure explicitly.');
const inputs = await loadInputs(values.scope);
let approval;
try {
  approval = await readJson(`.proofpack/approval.${values.scope}.json`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  throw new Error(`SCOPE_REVIEW_REQUIRED: run npm run scope:approve -- --scope ${values.scope} after reviewing the synthetic inputs.`);
}
const options = { approval, mode: values.mode, allowDemoApproval: values['allow-demo-approval'] };
prepareEvaluation(inputs, approval, options);
const source = await captureSource({ requireCleanCommit: values.mode === 'live-azure' });
let invoke;
if (values.mode === 'live-azure') {
  const config = readAzureConfig();
  verifyAzureBoundary(config);
  const token = operatorToken(config);
  invoke = input => callFoundry({ ...input, endpoint: config.endpoint, deployment: config.deployment, token });
}
const { evidence, gate } = await evaluate(inputs, { ...options, source, invoke });
const currentSource = await captureSource({ requireCleanCommit: values.mode === 'live-azure' });
if (currentSource.contentHash !== source.contentHash) throw new Error('SOURCE_CHANGED_DURING_RUN: do not treat this execution as current evidence.');
const report = `.proofpack/runs/${evidence.runId}.json`;
await writeArtifact(report, evidence, { immutable: true });
console.log(JSON.stringify({
  report, fileSha256: createHash('sha256').update(await readFile(projectPath(report))).digest('hex'),
  mode: values.mode, status: gate.status, passed: gate.passed, total: gate.total,
  execution: evidence.execution, externalRelease: 'pending-human-review',
}, null, 2));
if (gate.status !== 'passed') process.exitCode = 1;
