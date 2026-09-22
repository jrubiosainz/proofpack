import { access, readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { projectPath, loadInputs } from '../src/files.mjs';
import { validateInputs } from '../src/scope.mjs';

async function check(directory) {
  for (const item of await readdir(projectPath(directory), { withFileTypes: true })) {
    const relative = `${directory}/${item.name}`;
    if (item.isDirectory()) await check(relative);
    else if (item.name.endsWith('.mjs')) execFileSync(process.execPath, ['--check', projectPath(relative)], { stdio: 'pipe' });
    else if (item.name.endsWith('.json')) JSON.parse(await readFile(projectPath(relative), 'utf8'));
  }
}
for (const directory of ['src', 'scripts', 'tests', 'samples', 'public']) await check(directory);
for (const version of ['v1', 'v2']) {
  const inputs = await loadInputs(version);
  for (const requirement of validateInputs(inputs)) {
    for (const file of [...requirement.code, ...requirement.tests]) await access(projectPath(file.split('#')[0]));
  }
}
console.log('JavaScript syntax, sample contracts and requirement-to-code/test links are valid.');
