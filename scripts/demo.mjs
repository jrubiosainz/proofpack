import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { projectPath, writeArtifact } from '../src/files.mjs';
import { createDemoView } from '../src/view-model.mjs';

const view = await createDemoView();
for (const stage of [view.stages.initial, view.stages.validated]) {
  await writeArtifact(`.proofpack/runs/${stage.evidence.runId}.json`, stage.evidence, { immutable: true });
}
await writeArtifact('.proofpack/demo.json', view);
const report = `.proofpack/runs/${view.latest.runId}.json`;
console.log(JSON.stringify({
  mode: 'synthetic-offline-demo',
  stages: Object.fromEntries(Object.entries(view.stages).map(([name, { gate }]) => [name, { status: gate.status, passed: gate.passed, total: gate.total }])),
  providerCalls: 0,
  currentReport: report,
  fileSha256: createHash('sha256').update(await readFile(projectPath(report))).digest('hex'),
  externalRelease: 'pending-human-review',
}, null, 2));
if (view.stages.initial.gate.passed !== 4 || view.stages.changed.gate.status !== 'blocked'
  || view.stages.changed.gate.passed !== 0 || view.stages.validated.gate.passed !== 5) process.exitCode = 1;
