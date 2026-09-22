import { readFile } from 'node:fs/promises';
import { projectPath } from './files.mjs';
import { loadView } from './view-model.mjs';

const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
]);
const jsonRoutes = new Map(['health', 'manifest', 'evidence', 'view'].flatMap(name => [[`/api/${name}`, name], [`/${name}.json`, name]]));
export const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

function response(status, body, type = 'application/json; charset=utf-8') {
  return { status, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), headers: { ...SECURITY_HEADERS, 'content-type': type } };
}

export async function handleRequest(method, rawUrl) {
  if (!['GET', 'HEAD'].includes(method)) {
    return {
      ...response(405, { error: 'READ_ONLY', details: 'No run, mutation, ticket, approval or release endpoint exists.' }),
      headers: { ...SECURITY_HEADERS, 'content-type': 'application/json', allow: 'GET, HEAD' },
    };
  }
  const url = new URL(rawUrl, 'http://localhost');
  let result;
  const asset = assets.get(url.pathname);
  if (asset) {
    result = response(200, await readFile(projectPath(asset[0])), asset[1]);
  } else if (jsonRoutes.has(url.pathname)) {
    const kind = jsonRoutes.get(url.pathname);
    const view = await loadView();
    const data = kind === 'health'
      ? { product: 'proofpack', status: 'ok', kind: 'synthetic-offline-viewer', inferenceEnabled: false, mutationsEnabled: false, approval: 'pending-human-review' }
      : kind === 'manifest' ? view.manifest : kind === 'evidence' ? view.latest : view;
    result = response(200, data);
  } else {
    result = response(404, { error: 'NOT_FOUND' });
  }
  return method === 'HEAD' ? { ...result, body: '' } : result;
}
