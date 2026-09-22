import { loadInputs } from '../src/files.mjs';
import { digest } from '../src/provenance.mjs';
import { createDemoApproval } from '../src/scope.mjs';
import { evaluate } from '../src/evaluation.mjs';

export function testSource(mode = 'local-fixture') {
  const files = [{ path: 'src/fixture.mjs', sha256: 'a'.repeat(64) }];
  return {
    kind: mode === 'local-fixture' ? 'source-snapshot' : 'git-commit',
    contentHash: digest(files), files,
    ...(mode === 'live-azure' ? { commit: 'a'.repeat(40), clean: true } : {}),
  };
}

export async function makeTestEvidence(version = 'v1') {
  const inputs = await loadInputs(version);
  const result = await evaluate(inputs, {
    approval: createDemoApproval(inputs), allowDemoApproval: true, source: testSource(),
  });
  return { inputs, ...result };
}
