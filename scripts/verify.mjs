import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projectPath, loadInputs } from '../src/files.mjs';
import { captureSource } from '../src/source.mjs';
import { evaluateGate } from '../src/acceptance.mjs';

const { values } = parseArgs({
  options: {
    report: { type: 'string' }, sha256: { type: 'string' },
    scope: { type: 'string', default: 'v2' }, mode: { type: 'string' },
  },
});
if (!values.report || !/^[0-9a-f]{64}$/.test(values.sha256 || '')) throw new Error('Supply --report <project-relative-file> and its previously recorded --sha256.');
const bytes = await readFile(projectPath(values.report));
if (createHash('sha256').update(bytes).digest('hex') !== values.sha256) throw new Error('REPORT_BYTES_CHANGED: the file does not match the supplied SHA-256.');
const evidence = JSON.parse(bytes);
const [inputs, source] = await Promise.all([loadInputs(values.scope), captureSource()]);
const gate = evaluateGate(inputs, evidence, { expectedMode: values.mode || evidence.executionMode, expectedSourceHash: source.contentHash });
console.log(JSON.stringify({ runId: evidence.runId, mode: 'offline-revalidation', networkRequests: 0, gate }, null, 2));
if (gate.status !== 'passed') process.exitCode = 1;
