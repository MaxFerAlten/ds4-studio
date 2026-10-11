const MAX_MODEL_TOKENS = 8192;
const MAX_MODEL_MODES = 32;

function failure(code, message) {
  throw Object.assign(new Error(message), { code });
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(content) {
  if (typeof content !== 'string') return null;
  try {
    const value = JSON.parse(content);
    return object(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Build the OpenWiki controller's generator from the active DS4 chat adapter.
 * It prefers one structured function call and supports backends that return a
 * strict JSON object in message content instead. The generation controller
 * validates JSON output against its bounded plan/page rules before any write.
 * It never starts an OpenWiki model or forwards provider credentials.
 */
export function createOpenWikiModelGenerator({ buildChatPayload, postJson, endpoint } = {}) {
  if (typeof buildChatPayload !== 'function') throw new TypeError('buildChatPayload is required');
  if (typeof postJson !== 'function') throw new TypeError('postJson is required');
  if (typeof endpoint !== 'function') throw new TypeError('endpoint is required');
  const modelModes = new Map();

  function setMode(key, mode) {
    modelModes.delete(key);
    modelModes.set(key, mode);
    while (modelModes.size > MAX_MODEL_MODES) modelModes.delete(modelModes.keys().next().value);
  }

  const generate = async function generate({ kind, schema, prompt, maxTokens, signal, modelContext, forceJson = false } = {}) {
    if (kind !== 'plan' && kind !== 'page' && kind !== 'probe') failure('MODEL_REQUEST_INVALID', 'model request kind is invalid');
    if (!object(schema) || typeof prompt !== 'string' || prompt.length > 600_000) {
      failure('MODEL_REQUEST_INVALID', 'model request schema or prompt is invalid');
    }
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_MODEL_TOKENS) {
      failure('MODEL_REQUEST_INVALID', 'model token budget is invalid');
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) failure('MODEL_REQUEST_INVALID', 'signal is invalid');
    if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('model request aborted'), { code: 'ABORTED' });
    const request = modelContext?.request;
    if (!object(request)) failure('MODEL_CONTEXT_INVALID', 'active DS4 request parameters are unavailable');

    const name = kind === 'plan' ? 'openwiki_plan' : kind === 'page' ? 'openwiki_page' : 'openwiki_capability_probe';
    const modelId = typeof request.model === 'string' && request.model ? request.model : 'default';
    const modelEndpoint = endpoint();
    const modelKey = `${modelEndpoint}\n${modelId}`;
    // Vitronia's peg-native tool parser can leave a trailing </parameter> in
    // message.content, and its llama-server ignores named tool_choice objects.
    // Request constrained JSON without tools for this backend on every call,
    // including the probe; a successful tool probe does not prove page support.
    const jsonMode = /vitronia/i.test(modelId) || forceJson || modelModes.get(modelKey) === 'json';
    const jsonInstruction = `\n\nReturn exactly one JSON object matching this schema. Do not use Markdown fences or add prose.\n${JSON.stringify(schema)}`;
    const taskPrompt = kind === 'page'
      ? `${prompt}\nKeep this page focused and under 1000 words so the complete JSON fits the output budget. Proposed claims must use evidence arrays of objects with only a resource field, e.g. {"resource":"repo://README.md#L1-L5"}. Use canonical repo:// repository-relative references to the supplied source files; do not invent source paths or evidence.`
      : prompt;
    // These are bounded structured side calls, regardless of the chat's think
    // mode. llama-server ignores DS4's `think` flag; use its template/effort
    // controls as well so hidden reasoning cannot consume the JSON budget.
    const modelRequest = { ...request, thinking: false, think: false, reasoning_effort: 'none' };
    const payload = buildChatPayload({ ...modelRequest, stream: false, max_tokens: maxTokens }, [
      { role: 'user', content: jsonMode ? `${taskPrompt}${jsonInstruction}` : `${taskPrompt}\nIf function calls are unavailable, return only a JSON object matching this schema, with no Markdown or prose:\n${JSON.stringify(schema)}` },
    ]);
    payload.enable_thinking = false;
    payload.chat_template_kwargs = { enable_thinking: false };
    payload.reasoning_effort = 'none';
    if (!jsonMode) {
      payload.tools = [{ type: 'function', function: {
        name,
        description: kind === 'plan'
          ? 'Return a bounded OpenWiki page plan grounded in the supplied repository context.'
          : kind === 'page'
            ? 'Return bounded Markdown and claims grounded in the supplied repository context.'
            : 'Return the requested minimal OpenWiki capability confirmation.',
        parameters: schema,
      } }];
      payload.tool_choice = { type: 'function', function: { name } };
    } else {
      payload.response_format = { type: 'json_object' };
    }

    let response;
    try { response = await postJson(modelEndpoint, payload, signal); }
    catch (cause) {
      if (signal?.aborted) throw signal.reason ?? cause;
      throw Object.assign(new Error('active DS4 model request failed'), { code: 'MODEL_REQUEST_FAILED', cause });
    }
    if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      failure('MODEL_REQUEST_FAILED', 'active DS4 model returned an unsuccessful status');
    }
    let parsed;
    try { parsed = JSON.parse(response.body); }
    catch (cause) { throw Object.assign(new Error('active DS4 model returned invalid JSON'), { code: 'MODEL_RESPONSE_INVALID', cause }); }
    if (parsed?.choices?.[0]?.finish_reason === 'length') {
      failure('MODEL_OUTPUT_TRUNCATED', 'active DS4 model exhausted the output token budget before completing structured output');
    }
    const calls = parsed?.choices?.[0]?.message?.tool_calls;
    if (Array.isArray(calls) && calls.length === 1 && calls[0]?.type === 'function' &&
        calls[0]?.function?.name === name && typeof calls[0]?.function?.arguments === 'string') {
      if (jsonMode && kind !== 'probe') setMode(modelKey, 'tool');
      return { mode: 'tool', toolCalls: [{ name, arguments: calls[0].function.arguments }] };
    }
    if (calls === undefined || calls === null || (Array.isArray(calls) && calls.length === 0)) {
      const value = parseJsonObject(parsed?.choices?.[0]?.message?.content);
      if (value) {
        if (kind !== 'probe') setMode(modelKey, 'json');
        return { mode: 'json', value };
      }
    }
    failure('MODEL_TOOL_CALL_UNSUPPORTED', 'active DS4 model returned neither the requested function call nor a JSON object');
  };

  generate.probeModel = async ({ modelContext, signal } = {}) => {
    const probe = {
      kind: 'probe', schema: {
        type: 'object', required: ['ready'], properties: { ready: { type: 'boolean' } }, additionalProperties: false,
      },
      prompt: 'Return ready=true using the requested function call, or as a raw JSON object if function calls are unavailable.',
      // Vitronia can spend the first few dozen generated tokens on hidden
      // reasoning even with thinking disabled; 256 still keeps this probe tiny
      // while leaving room for the actual JSON object.
      maxTokens: 256,
      modelContext,
      signal,
    };
    let response;
    try { response = await generate(probe); }
    catch (error) {
      if (error?.code !== 'MODEL_TOOL_CALL_UNSUPPORTED') throw error;
      // Some OpenAI-compatible backends reject or ignore tool_choice. Retry
      // the tiny readiness probe once with JSON mode and no function tools.
      response = await generate({ ...probe, forceJson: true });
    }
    let result = response.value;
    if (!result && Array.isArray(response.toolCalls) && response.toolCalls.length === 1) {
      try { result = JSON.parse(response.toolCalls[0].arguments); }
      catch { result = null; }
    }
    if (!object(result) || result.ready !== true || Object.keys(result).length !== 1) {
      failure('MODEL_TOOL_CALL_UNSUPPORTED', 'active DS4 model did not pass the structured JSON capability probe');
    }
    const request = modelContext?.request;
    const modelId = typeof request?.model === 'string' && request.model ? request.model : 'default';
    setMode(`${endpoint()}\n${modelId}`, response.mode === 'json' ? 'json' : 'tool');
    return true;
  };
  return generate;
}

export default createOpenWikiModelGenerator;
