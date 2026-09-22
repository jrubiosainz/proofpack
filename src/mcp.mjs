import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadView } from './view-model.mjs';

const stages = ['initial', 'changed', 'validated'];
const tools = [
  { name: 'proofpack_get_briefing', description: 'Read the synthetic briefing and data boundaries.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'proofpack_get_acceptance', description: 'Read a recomputed acceptance gate. Cannot approve or execute.', inputSchema: { type: 'object', properties: { stage: { type: 'string', enum: stages } }, required: ['stage'], additionalProperties: false } },
  { name: 'proofpack_get_evidence', description: 'Read current synthetic fixture evidence and its limitations. No model call.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
].map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
const resources = [
  { uri: 'proofpack://briefing', name: 'Synthetic discovery briefing', mimeType: 'application/json' },
  { uri: 'proofpack://acceptance/changed', name: 'Changed-scope blocking gate', mimeType: 'application/json' },
  { uri: 'proofpack://evidence/latest', name: 'Current synthetic fixture evidence', mimeType: 'application/json' },
];

export async function dispatch(message) {
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
    || (Object.hasOwn(message, 'id') && typeof message.id !== 'string' && !Number.isInteger(message.id))) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
  }
  if (!Object.hasOwn(message, 'id')) return null;
  const respond = result => ({ jsonrpc: '2.0', id: message.id, result });
  const fail = (code, text) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });
  if (message.method === 'initialize') {
    const requested = message.params?.protocolVersion;
    return respond({
      protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(requested) ? requested : '2024-11-05',
      capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'proofpack-readonly-context', version: '1.0.0' },
    });
  }
  if (message.method === 'ping') return respond({});
  if (message.method === 'tools/list') return respond({ tools });
  if (message.method === 'resources/list') return respond({ resources });
  if (message.method === 'resources/read') {
    if (!resources.some(resource => resource.uri === message.params?.uri)) return fail(-32602, 'Resource URI is not allowlisted.');
    const view = await loadView();
    const data = message.params.uri === 'proofpack://briefing' ? view.briefing
      : message.params.uri === 'proofpack://acceptance/changed' ? view.stages.changed.gate : view.latest;
    return respond({ contents: [{ uri: message.params.uri, mimeType: 'application/json', text: JSON.stringify(data) }] });
  }
  if (message.method === 'tools/call') {
    const definition = tools.find(tool => tool.name === message.params?.name);
    if (!definition) return fail(-32602, 'Unknown tool. Only bounded read-only context tools exist.');
    const args = message.params.arguments ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fail(-32602, 'Arguments must be an object.');
    if (Object.keys(args).some(key => !Object.hasOwn(definition.inputSchema.properties, key))) {
      return fail(-32602, 'Unexpected argument; paths, URLs and execution options are not accepted.');
    }
    if (definition.name === 'proofpack_get_acceptance' && !stages.includes(args.stage)) return fail(-32602, 'An explicit demo stage is required.');
    const view = await loadView();
    const data = definition.name === 'proofpack_get_briefing' ? view.briefing
      : definition.name === 'proofpack_get_acceptance' ? view.stages[args.stage].gate : view.latest;
    return respond({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
  }
  return fail(-32601, 'Unsupported method. This adapter cannot mutate, approve, browse arbitrary context or spend tokens.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let message;
    try {
      if (Buffer.byteLength(line) > 65_536) throw new SyntaxError('Request exceeds 64 KiB.');
      message = JSON.parse(line);
    } catch (error) {
      console.error(`ProofPack MCP parse failed: ${error.message}`);
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid or oversized JSON request.' } })}\n`);
      continue;
    }
    let reply;
    try {
      reply = await dispatch(message);
    } catch (error) {
      console.error(`ProofPack MCP read failed: ${error.message}`);
      reply = { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'Evidence read failed; inspect local operator logs.' } };
    }
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
  }
}
