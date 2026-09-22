import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { handleRequest } from '../src/http.mjs';
import { dispatch } from '../src/mcp.mjs';
import { ROOT, projectPath } from '../src/files.mjs';

test('HTTP rejects every mutation method including invented run and approval endpoints', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const url of ['/', '/api/run', '/api/approve', '/api/release', '/evidence.json']) {
      const response = await handleRequest(method, url);
      assert.equal(response.status, 405);
      assert.equal(JSON.parse(response.body).error, 'READ_ONLY');
      assert.equal(response.headers.allow, 'GET, HEAD');
    }
  }
});

test('HTTP serves only allowlisted assets, never credentials, source or arbitrary files', async () => {
  for (const url of ['/.env', '/src/provider.mjs', '/../../.azure/accessTokens.json', '/api/context?path=/etc/passwd', '/.proofpack/demo.json']) {
    assert.equal((await handleRequest('GET', url)).status, 404);
    assert.equal((await handleRequest('HEAD', url)).body, '');
  }
  const home = await handleRequest('GET', '/');
  assert.match(home.body.toString(), /<html lang="en">/);
  assert.match(home.headers['content-security-policy'], /connect-src 'self'/);
  assert.equal((await handleRequest('HEAD', '/')).body, '');
});

test('JSON aliases expose the same read-only synthetic package with review pending', async () => {
  for (const name of ['health', 'manifest', 'evidence', 'view']) {
    const first = await handleRequest('GET', `/${name}.json`);
    const alias = await handleRequest('GET', `/api/${name}`);
    assert.equal(first.status, 200);
    assert.deepEqual(JSON.parse(first.body), JSON.parse(alias.body));
    assert.equal((await handleRequest('HEAD', `/${name}.json`)).body, '');
  }
  const health = JSON.parse((await handleRequest('GET', '/health.json')).body);
  assert.equal(health.inferenceEnabled, false);
  assert.equal(health.mutationsEnabled, false);
  assert.equal(health.approval, 'pending-human-review');
});

test('MCP advertises only three bounded read-only tools and rejects arbitrary context', async () => {
  const list = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(list.result.tools.length, 3);
  assert.ok(list.result.tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.openWorldHint && !tool.annotations.destructiveHint));
  for (const request of [
    { method: 'tools/call', params: { name: 'proofpack_approve', arguments: {} } },
    { method: 'tools/call', params: { name: 'proofpack_get_briefing', arguments: { path: '../../.env' } } },
    { method: 'tools/call', params: { name: 'proofpack_get_acceptance', arguments: { stage: 'unknown' } } },
    { method: 'tools/call', params: { name: 'proofpack_get_acceptance', arguments: null } },
    { method: 'resources/read', params: { uri: 'file:///etc/passwd' } },
  ]) assert.equal((await dispatch({ jsonrpc: '2.0', id: 1, ...request })).error.code, -32602);
});

test('MCP initialize, notifications, resources and gate reads use actual JSON-RPC', async () => {
  const initialized = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(initialized.result.protocolVersion, '2025-03-26');
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const gate = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'proofpack_get_acceptance', arguments: { stage: 'changed' } } });
  assert.equal(gate.result.structuredContent.status, 'blocked');
  assert.equal(gate.result.structuredContent.passed, 0);
  const resource = await dispatch({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'proofpack://evidence/latest' } });
  assert.equal(JSON.parse(resource.result.contents[0].text).executionMode, 'local-fixture');
});

test('stdio adapter is portable and stdout contains only protocol responses', () => {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'proofpack_get_acceptance', arguments: { stage: 'validated' } } },
  ];
  const child = spawnSync(process.execPath, [projectPath('src/mcp.mjs')], {
    cwd: ROOT, input: `${messages.map(item => JSON.stringify(item)).join('\n')}\n`, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(child.status, 0, child.stderr);
  const replies = child.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(replies.map(item => item.id), [1, 2, 3]);
  assert.equal(replies[2].result.structuredContent.passed, 5);
});
