import { makeMessages } from './retrieval.mjs';

export const SELECTION_SCHEMA = {
  type: 'object',
  properties: {
    disposition: { type: 'string', enum: ['answer', 'abstain'] },
    factIds: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
  required: ['disposition', 'factIds'],
  additionalProperties: false,
};

export function validateEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.openai\.azure\.com$/.test(url.hostname)
    || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('INVALID_ENDPOINT: use an HTTPS Azure OpenAI account origin without credentials, port, path or query.');
  }
  return url.origin;
}

export function classifyProviderFailure(status, body) {
  return status === 400 && body?.error?.code === 'content_filter'
    && body?.error?.innererror?.code === 'ResponsibleAIPolicyViolation'
    ? 'provider-refused' : 'provider-error';
}

export function validateMessageBudget(question, facts, budget) {
  const messages = makeMessages(question, facts);
  if (!Number.isInteger(budget?.maxInputCharactersPerCall) || budget.maxInputCharactersPerCall < 1
    || budget.maxInputCharactersPerCall > 7000 || JSON.stringify(messages).length > budget.maxInputCharactersPerCall) {
    throw new Error('INPUT_BUDGET_EXCEEDED');
  }
  if (!Number.isInteger(budget.maxOutputTokensPerCall) || budget.maxOutputTokensPerCall > 180 || budget.maxOutputTokensPerCall < 1) {
    throw new Error('OUTPUT_BUDGET_EXCEEDED');
  }
  return messages;
}

export async function callFoundry({ question, facts, endpoint, deployment, token, budget, fetchImpl = fetch }) {
  const origin = validateEndpoint(endpoint);
  if (typeof deployment !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(deployment)) throw new Error('INVALID_DEPLOYMENT');
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error('MISSING_OPERATOR_TOKEN');
  const messages = validateMessageBudget(question, facts, budget);
  const started = performance.now();
  const response = await fetchImpl(`${origin}/openai/deployments/${deployment}/chat/completions?api-version=2024-10-21`, {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messages, temperature: 0, max_tokens: budget.maxOutputTokensPerCall,
      response_format: { type: 'json_schema', json_schema: { name: 'proofpack_selection', strict: true, schema: SELECTION_SCHEMA } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    let failureBody;
    let errorBodyReadable = true;
    try {
      failureBody = await response.json();
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      errorBodyReadable = false;
    }
    const state = classifyProviderFailure(response.status, failureBody);
    const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_]{1,100}$/.test(value) ? value : null;
    const failure = new Error(`AZURE_HTTP_${response.status}: ${state}; no completion, fixture fallback or automatic retry.`);
    failure.providerFailure = {
      state, httpStatus: response.status,
      code: safeCode(failureBody?.error?.code), innerCode: safeCode(failureBody?.error?.innererror?.code),
      errorBodyReadable,
      requestId: response.headers.get('apim-request-id') || response.headers.get('x-request-id'),
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      completionReceived: false, usage: null,
    };
    throw failure;
  }
  const body = await response.json();
  const choice = body.choices?.[0];
  if (choice?.finish_reason !== 'stop' || !choice.message?.content || choice.message.refusal) {
    throw new Error('AZURE_INCOMPLETE_RESPONSE: refused, filtered, truncated or missing output.');
  }
  const requestId = response.headers.get('apim-request-id') || response.headers.get('x-request-id') || body.id;
  if (typeof requestId !== 'string' || !requestId
    || !Number.isInteger(body.usage?.prompt_tokens) || body.usage.prompt_tokens < 1
    || !Number.isInteger(body.usage?.completion_tokens) || body.usage.completion_tokens < 1
    || body.usage.completion_tokens > budget.maxOutputTokensPerCall) {
    throw new Error('AZURE_MISSING_RECEIPT: no usable request ID or bounded positive token usage.');
  }
  return {
    selection: JSON.parse(choice.message.content),
    receipt: {
      mode: 'live-azure', requestId, model: body.model || null,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      usage: { inputTokens: body.usage.prompt_tokens, outputTokens: body.usage.completion_tokens },
      finishReason: choice.finish_reason, retries: 0,
    },
  };
}

export async function callFixture({ facts }) {
  return {
    selection: facts.length ? { disposition: 'answer', factIds: facts.map(fact => fact.factId) } : { disposition: 'abstain', factIds: [] },
    receipt: {
      mode: 'local-fixture', model: 'deterministic-fixture-not-an-llm',
      latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0 }, retries: 0,
    },
  };
}
