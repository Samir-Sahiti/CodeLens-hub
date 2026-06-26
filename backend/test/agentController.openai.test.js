/**
 * Focused unit tests for the OpenAI migration of the agent tool-use loop.
 *
 * Covers the two riskiest pure functions:
 *   - consumeStream:     accumulate OpenAI streamed tool_call fragments by index,
 *                        parse arguments once at the end, read usage from the
 *                        final include_usage chunk.
 *   - rehydrateMessages: map persisted agent_messages rows into OpenAI's chat
 *                        message shape (assistant.tool_calls + role:'tool').
 */

import { describe, it, expect } from 'vitest';

// setup.js stubs env vars; importing the controller is side-effect-free here.
const agentController = require('../src/controllers/agentController');
const { consumeStream, rehydrateMessages } = agentController._private;

function streamOf(chunks) {
  return (async function* gen() { for (const c of chunks) yield c; })();
}

describe('agentController._private.consumeStream (OpenAI)', () => {
  it('accumulates text deltas and emits text_delta events', async () => {
    const sent = [];
    const turn = await consumeStream(
      streamOf([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 11, completion_tokens: 2 } },
      ]),
      (e) => sent.push(e),
    );
    expect(turn.textBlocks.join('')).toBe('Hello');
    expect(turn.toolUses).toHaveLength(0);
    expect(turn.stopReason).toBe('stop');
    expect(turn.inputTokens).toBe(11);
    expect(turn.outputTokens).toBe(2);
    expect(sent.filter((e) => e.type === 'text_delta')).toHaveLength(2);
  });

  it('accumulates tool_call argument fragments by index and parses once', async () => {
    const turn = await consumeStream(
      streamOf([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_blast_radius', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.js"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 30, completion_tokens: 9 } },
      ]),
      () => {},
    );
    expect(turn.stopReason).toBe('tool_calls');
    expect(turn.toolUses).toEqual([
      { id: 'call_1', name: 'get_blast_radius', input: { path: 'a.js' } },
    ]);
    expect(turn.outputTokens).toBe(9);
  });

  it('handles multiple parallel tool calls and malformed args gracefully', async () => {
    const turn = await consumeStream(
      streamOf([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c0', function: { name: 'list_issues', arguments: '{}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c1', function: { name: 'read_file', arguments: 'NOT JSON' } }] }, finish_reason: 'tool_calls' }] },
      ]),
      () => {},
    );
    expect(turn.toolUses).toHaveLength(2);
    expect(turn.toolUses[0]).toEqual({ id: 'c0', name: 'list_issues', input: {} });
    // Malformed JSON falls back to {} rather than throwing.
    expect(turn.toolUses[1]).toEqual({ id: 'c1', name: 'read_file', input: {} });
  });
});

describe('agentController._private.rehydrateMessages (OpenAI shape)', () => {
  it('maps a plain user/assistant exchange', () => {
    const out = rehydrateMessages([
      { role: 'user', content_json: { text: 'hi' } },
      { role: 'assistant', content_json: { text: 'hello' } },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('folds assistant text + tool_use rows into one assistant message with tool_calls, then role:tool results', () => {
    const out = rehydrateMessages([
      { role: 'user', content_json: { text: 'impact of a.js?' } },
      { role: 'assistant', content_json: { text: 'Let me check.' } },
      { role: 'tool_use', content_json: { tool_use_id: 'call_1', tool_name: 'get_blast_radius', input: { path: 'a.js' } } },
      { role: 'tool_result', content_json: { tool_use_id: 'call_1', output: { direct: ['b.js'] } } },
      { role: 'assistant', content_json: { text: 'b.js is affected.' } },
    ]);

    expect(out[0]).toEqual({ role: 'user', content: 'impact of a.js?' });

    expect(out[1]).toEqual({
      role: 'assistant',
      content: 'Let me check.',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'get_blast_radius', arguments: JSON.stringify({ path: 'a.js' }) },
      }],
    });

    // Tool result is its own role:'tool' message, immediately after the assistant.
    expect(out[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: JSON.stringify({ direct: ['b.js'] }),
    });

    expect(out[3]).toEqual({ role: 'assistant', content: 'b.js is affected.' });
  });

  it('uses null content when an assistant turn is tool_calls-only', () => {
    const out = rehydrateMessages([
      { role: 'tool_use', content_json: { tool_use_id: 'c1', tool_name: 'list_issues', input: {} } },
      { role: 'tool_result', content_json: { tool_use_id: 'c1', output: { items: [] } } },
    ]);
    expect(out[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_issues', arguments: '{}' } }],
    });
    expect(out[1].role).toBe('tool');
  });
});
