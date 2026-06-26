/**
 * Shared OpenAI client + streaming chat helper.
 *
 * Single source for the OpenAI SDK client across the backend. The client is
 * wrapped in a Proxy so tests can stub `globalThis.__CODELENS_OPENAI__`,
 * matching the convention used for embeddings (see ragService.js). All chat /
 * reasoning features (review, security audit, proposals, agent, RAG synthesis,
 * file chat, tours) go through this module.
 *
 * Model selection is env-overridable:
 *   - OPENAI_CHAT_MODEL  (default gpt-4.1)     — main reasoning features
 *   - OPENAI_TITLE_MODEL (default gpt-4o-mini) — cheap, high-volume calls
 */

const { OpenAI } = require('openai');

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1';
const TITLE_MODEL = process.env.OPENAI_TITLE_MODEL || 'gpt-4o-mini';

const _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-dummy' });
const openai = new Proxy(_openai, {
  get(_t, p) {
    const a = globalThis.__CODELENS_OPENAI__ || _openai;
    const v = a[p];
    return typeof v === 'function' ? v.bind(a) : v;
  },
});

/**
 * Stream a single-shot chat completion as text. Emits each text fragment via
 * `onDelta(fragment)` and returns the accumulated text + token usage.
 *
 * Contract: an optional system prompt plus one user message, streamed, with
 * usage captured for budget tracking. Pass `signal` (from
 * sseAbort.bindRequestAbort) to abort on client
 * disconnect — the OpenAI SDK throws an AbortError, which callers classify via
 * sseAbort.isAbortError.
 *
 * NOTE: `stream_options: { include_usage: true }` is required — OpenAI only
 * emits token usage on a final chunk (with an empty `choices` array) when this
 * is set. Without it, usage tracking silently records zero.
 *
 * @returns {Promise<{ text: string, promptTokens: number, completionTokens: number }>}
 */
async function streamChatText({ system, user, model = CHAT_MODEL, maxTokens = 1500, signal, onDelta }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const stream = await openai.chat.completions.create(
    {
      model,
      max_tokens: maxTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    },
    signal ? { signal } : undefined,
  );

  let text = '';
  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta?.(delta);
    }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens || promptTokens;
      completionTokens = chunk.usage.completion_tokens || completionTokens;
    }
  }

  return { text, promptTokens, completionTokens };
}

module.exports = { openai, streamChatText, CHAT_MODEL, TITLE_MODEL };
