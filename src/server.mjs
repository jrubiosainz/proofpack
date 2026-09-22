import { createServer } from 'node:http';
import { handleRequest, SECURITY_HEADERS } from './http.mjs';
import { loadView } from './view-model.mjs';

const port = Number(process.env.PORT || 4272);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535.');
await loadView();
const server = createServer(async (request, response) => {
  try {
    const result = await handleRequest(request.method, request.url);
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  } catch (error) {
    console.error(`ProofPack read failed: ${error.message}`);
    response.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
    response.end(request.method === 'HEAD' ? '' : JSON.stringify({
      error: 'EVIDENCE_READ_FAILED', details: 'The evidence package could not be loaded. Inspect local operator logs.',
    }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`ProofPack synthetic offline viewer: http://127.0.0.1:${port} (PID ${process.pid})`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
