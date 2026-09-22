import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function projectPath(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('A project-relative path is required.');
  const resolved = path.resolve(ROOT, relative);
  if (resolved !== path.resolve(ROOT) && !resolved.startsWith(ROOT)) throw new Error('Path is outside the ProofPack package.');
  return resolved;
}

export async function readJson(relative) {
  return JSON.parse(await readFile(projectPath(relative), 'utf8'));
}

export async function writeArtifact(relative, value, { immutable = false } = {}) {
  const file = projectPath(relative);
  if (!file.startsWith(projectPath('.proofpack') + path.sep)) throw new Error('Generated reports belong in .proofpack/.');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: immutable ? 'wx' : 'w' });
}

export async function loadInputs(version = 'v2') {
  if (!['v1', 'v2'].includes(version)) throw new Error('Scope must be v1 or v2.');
  const [scope, corpus, cases, requirements, briefing] = await Promise.all([
    readJson(`samples/scope.${version}.json`),
    readJson('samples/corpus.json'),
    readJson('samples/cases.json'),
    readJson('samples/requirements.json'),
    readJson('samples/briefing.json'),
  ]);
  return { scope, corpus, cases, requirements, briefing };
}
