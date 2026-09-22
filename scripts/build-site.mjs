import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { projectPath } from '../src/files.mjs';
import { createDemoView } from '../src/view-model.mjs';

const view = await createDemoView();
if (view.stages.validated.gate.status !== 'passed' || view.stages.changed.gate.status !== 'blocked') {
  throw new Error('DEMO_GATE_FAILED: refusing to build an inconsistent fixture package.');
}
await mkdir(projectPath('dist'), { recursive: true });
for (const file of ['index.html', 'app.mjs', 'styles.css', 'favicon.svg']) {
  await copyFile(projectPath(`public/${file}`), projectPath(`dist/${file}`));
}
const records = {
  view, manifest: view.manifest, evidence: view.latest,
  health: { product: 'proofpack', status: 'ok', kind: 'static-synthetic-snapshot', inferenceEnabled: false, mutationsEnabled: false, approval: 'pending-human-review' },
};
for (const [name, value] of Object.entries(records)) {
  await writeFile(projectPath(`dist/${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}
console.log('Built a synthetic read-only snapshot in dist/. No cloud execution or deployment.');
