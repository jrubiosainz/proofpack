import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ROOT, projectPath } from './files.mjs';
import { digest } from './provenance.mjs';

export const SOURCE_DIRECTORIES = ['src', 'scripts', 'prompts', 'samples', 'public'];
export const SOURCE_FILES = ['package.json', 'package-lock.json'];

export async function captureSource({ requireCleanCommit = false } = {}) {
  const paths = [...SOURCE_FILES];
  async function collect(directory) {
    for (const item of await readdir(projectPath(directory), { withFileTypes: true })) {
      const relative = `${directory}/${item.name}`;
      if (item.isSymbolicLink()) throw new Error('SOURCE_SYMLINK: source snapshots must remain inside the project.');
      if (item.isDirectory()) await collect(relative);
      else if (item.isFile()) paths.push(relative);
    }
  }
  for (const directory of SOURCE_DIRECTORIES) await collect(directory);
  const files = await Promise.all(paths.sort().map(async file => ({
    path: file, sha256: createHash('sha256').update(await readFile(projectPath(file))).digest('hex'),
  })));
  const source = { kind: 'source-snapshot', contentHash: digest(files), files };
  if (requireCleanCommit) {
    const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (git(['status', '--porcelain', '--untracked-files=all'])) {
      throw new Error('DIRTY_SOURCE: commit reviewed source and inputs before an Azure evaluation.');
    }
    source.kind = 'git-commit';
    source.commit = git(['rev-parse', 'HEAD']);
    source.clean = true;
  }
  return source;
}

export function verifySource(source, mode) {
  const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  if (!source || !hash(source.contentHash) || !Array.isArray(source.files) || source.files.length === 0
    || source.files.some(file => !file || typeof file.path !== 'string' || file.path.includes('..')
      || !/^(?:src|scripts|prompts|samples|public)\/[a-zA-Z0-9/_.-]+$|^package(?:-lock)?\.json$/.test(file.path) || !hash(file.sha256))
    || new Set(source.files.map(file => file.path)).size !== source.files.length
    || digest(source.files) !== source.contentHash) return false;
  if (mode === 'local-fixture') return source.kind === 'source-snapshot';
  return mode === 'live-azure' && source.kind === 'git-commit' && source.clean === true
    && typeof source.commit === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(source.commit) && !/^0+$/.test(source.commit);
}
