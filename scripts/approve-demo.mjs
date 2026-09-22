import { parseArgs } from 'node:util';
import { loadInputs, writeArtifact } from '../src/files.mjs';
import { createDemoApproval } from '../src/scope.mjs';

const { values } = parseArgs({ options: { scope: { type: 'string', default: 'v2' } } });
const inputs = await loadInputs(values.scope);
const approval = createDemoApproval(inputs);
await writeArtifact(`.proofpack/approval.${values.scope}.json`, approval);
console.log(JSON.stringify({ scope: values.scope, scopeHash: approval.scopeHash, notice: approval.notice }, null, 2));
