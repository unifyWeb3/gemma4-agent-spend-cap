import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ChatModel,
  OpenRouterModel,
  PollinationsModel,
  StubModel,
  normalizeArgs,
  parseModelAction,
  parseNativeToolCall,
  runAgent,
  toApiTools,
  toolProtocol,
} from './agent.js';
import { PromptHost } from './defenses.js';
import { makePolicy, makeState } from './policy.js';

const TOOLS = {
  read_file: { description: 'Read a file from the task directory.', parameters: { path: 'string' } },
  run_test: { description: 'Run the task test suite and return the output.', parameters: {} },
};

test('a plain JSON object with a tool field becomes a tool call', () => {
  const action = parseModelAction('{"tool": "read_file", "args": {"path": "repo.py"}}');
  assert.deepEqual(action, { toolCall: { tool: 'read_file', args: { path: 'repo.py' } } });
});

test('a fenced JSON block becomes a tool call', () => {
  const action = parseModelAction('Sure.\n```json\n{"tool": "run_test", "args": {}}\n```');
  assert.equal(action.toolCall.tool, 'run_test');
  assert.deepEqual(action.toolCall.args, {});
});

test('the name and action fields are accepted as aliases for tool', () => {
  assert.equal(parseModelAction('{"name": "read_file", "args": {}}').toolCall.tool, 'read_file');
  assert.equal(parseModelAction('{"action": "read_file", "args": {}}').toolCall.tool, 'read_file');
});

test('arguments given as a JSON string are parsed', () => {
  const action = parseModelAction('{"tool": "read_file", "args": "{\\"path\\": \\"repo.py\\"}"}');
  assert.deepEqual(action.toolCall.args, { path: 'repo.py' });
});

test('arguments that are not valid JSON become an empty object', () => {
  const action = parseModelAction('{"tool": "read_file", "args": "not json"}');
  assert.deepEqual(action.toolCall.args, {});
});

test('DONE is read as a final answer and not as a tool call', () => {
  assert.equal(parseModelAction('DONE').text, 'DONE');
  assert.equal(parseModelAction('All fixed. DONE').text, 'DONE');
  assert.equal(parseModelAction('DONE').toolCall, undefined);
});

test('plain prose comes back as text', () => {
  const action = parseModelAction('I think the bug is in the loop.');
  assert.equal(action.text, 'I think the bug is in the loop.');
  assert.equal(action.toolCall, undefined);
});

test('broken JSON falls back to text instead of throwing', () => {
  const action = parseModelAction('{"tool": "read_file", "args":');
  assert.equal(action.toolCall, undefined);
  assert.ok(action.text.length > 0);
});

test('the tool protocol names every tool and its arguments', () => {
  const protocol = toolProtocol(TOOLS);
  assert.ok(protocol.includes('read_file'));
  assert.ok(protocol.includes('path'));
  assert.ok(protocol.includes('run_test'));
  assert.ok(protocol.includes('DONE'));
});

test('a Retry after hint in the body is turned into a wait', () => {
  const res = { status: 402, headers: { get: () => null } };
  assert.equal(ChatModel.retryAfterMs(res, 'Free limit reached: 1 reply every 45 seconds per IP. Retry after 35s'), 35_000);
});

test('a Retry after hint in the headers is turned into a wait', () => {
  const res = { status: 429, headers: { get: (name) => (name === 'retry-after' ? '12' : null) } };
  assert.equal(ChatModel.retryAfterMs(res, ''), 12_000);
});

test('a 429 without a hint falls back to a minute', () => {
  const res = { status: 429, headers: { get: () => null } };
  assert.equal(ChatModel.retryAfterMs(res, ''), 60_000);
});

test('a plain server error is not retried', () => {
  const res = { status: 500, headers: { get: () => null } };
  assert.equal(ChatModel.retryAfterMs(res, 'internal error'), null);
});

test('the OpenRouter backend needs a key and the Pollinations backend does not', () => {
  assert.equal(new OpenRouterModel({ apiKey: null }).available, false);
  assert.equal(new OpenRouterModel({ apiKey: 'k' }).available, true);
  assert.equal(new PollinationsModel().available, true);
});

test('a model that answers DONE stops the loop and keeps the receipts', async () => {
  const workdir = mkdtempSync(join(tmpdir(), 'agent-loop-'));
  try {
    const host = new PromptHost({
      policy: makePolicy({ budget: 100 }),
      state: makeState(0),
      files: {},
      onWrite: () => {},
    });
    const model = new StubModel({ solutions: {}, attackCalls: [], task: { id: 't01' } });
    model.script = [{ toolCall: { tool: 'unknown_tool', args: {} } }];
    model.complete = async function complete() {
      if (this.step >= 1) return { text: 'DONE' };
      this.step += 1;
      return { toolCall: { tool: 'unknown_tool', args: {} } };
    };

    const result = await runAgent({
      workdir,
      host,
      system: 'system',
      model,
      tools: {
        ...TOOLS,
        unknown_tool: { description: 'not a real tool', parameters: {}, run: async () => ({ ok: true }) },
      },
    });

    assert.equal(result.done, true);
    const calls = result.log.filter((e) => e.kind === 'tool_call');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, 'unknown_tool');
    assert.deepEqual(result.payments, []);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('a tool that throws becomes a logged error and does not stop the run', async () => {
  const workdir = mkdtempSync(join(tmpdir(), 'agent-loop-'));
  try {
    const host = new PromptHost({
      policy: makePolicy({ budget: 100 }),
      state: makeState(0),
      files: {},
      onWrite: () => {},
    });
    const model = {
      calls: 0,
      async complete() {
        this.calls += 1;
        if (this.calls === 1) return { toolCall: { tool: 'boom', args: {} } };
        return { text: 'DONE' };
      },
    };

    const result = await runAgent({
      workdir,
      host,
      system: 'system',
      model,
      tools: {
        boom: {
          description: 'always throws',
          parameters: {},
          run: async () => {
            throw new Error('the tool broke');
          },
        },
      },
    });

    assert.equal(result.done, true);
    const calls = result.log.filter((e) => e.kind === 'tool_call');
    assert.equal(calls.length, 1);
    assert.match(calls[0].result.error, /the tool broke/);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('a native tool call is read out of the tool_calls array', () => {
  const action = parseNativeToolCall({
    content: '',
    tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"repo.py"}' } }],
  });
  assert.equal(action.toolCall.tool, 'read_file');
  assert.deepEqual(action.toolCall.args, { path: 'repo.py' });
  assert.equal(action.toolCall.id, 'call_1');
});

test('a message with no tool calls is not a tool call', () => {
  assert.equal(parseNativeToolCall({ content: 'hello' }), null);
  assert.equal(parseNativeToolCall({}), null);
});

test('the tool schemas are sent in the OpenAI function calling format', () => {
  const tools = {
    read_file: {
      description: 'Read a file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  };
  const api = toApiTools(tools);
  assert.equal(api.length, 1);
  assert.equal(api[0].type, 'function');
  assert.equal(api[0].function.name, 'read_file');
  assert.deepEqual(api[0].function.parameters.required, ['path']);
});

test('arguments nested under args are flattened', () => {
  assert.deepEqual(normalizeArgs({ args: { path: 'repo.py' } }), { path: 'repo.py' });
});

test('a tool name repeated inside the arguments is dropped', () => {
  assert.deepEqual(normalizeArgs({ tool: 'write_file', path: 'repo.py', content: 'x' }), {
    path: 'repo.py',
    content: 'x',
  });
});

test('arguments that are not an object become an empty object', () => {
  assert.deepEqual(normalizeArgs(null), {});
  assert.deepEqual(normalizeArgs('path=repo.py'), {});
  assert.deepEqual(normalizeArgs([1, 2]), {});
});

test('the task is given to the model as the first user message', async () => {
  const workdir = mkdtempSync(join(tmpdir(), 'agent-loop-'));
  try {
    const host = new PromptHost({
      policy: makePolicy({ budget: 100 }),
      state: makeState(0),
      files: {},
      onWrite: () => {},
    });
    let seen = null;
    const model = {
      calls: 0,
      async complete({ messages }) {
        this.calls += 1;
        seen = messages;
        return { text: 'DONE' };
      },
    };

    const result = await runAgent({
      workdir,
      host,
      system: 'system',
      model,
      tools: TOOLS,
      initialUserMessage: '# Task\nfix the bug',
    });

    assert.equal(result.done, true);
    assert.equal(seen[0].role, 'user');
    assert.equal(seen[0].content, '# Task\nfix the bug');
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('a repeated identical call is refused instead of run twice', async () => {
  const workdir = mkdtempSync(join(tmpdir(), 'agent-loop-'));
  try {
    const host = new PromptHost({
      policy: makePolicy({ budget: 100 }),
      state: makeState(0),
      files: {},
      onWrite: () => {},
    });
    let runs = 0;
    const model = {
      calls: 0,
      async complete() {
        this.calls += 1;
        if (this.calls > 3) return { text: 'DONE' };
        return { toolCall: { tool: 'read_file', args: { path: 'repo.py' } } };
      },
    };

    const result = await runAgent({
      workdir,
      host,
      system: 'system',
      model,
      tools: {
        read_file: {
          description: 'Read a file.',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
          run: async () => {
            runs += 1;
            return { ok: true };
          },
        },
      },
    });

    assert.equal(runs, 1, 'the tool should only run once');
    assert.equal(result.log.filter((e) => e.kind === 'repeated_call').length, 2);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('repeated paid calls are not guarded, because a run of them is the drain attack', async () => {
  const workdir = mkdtempSync(join(tmpdir(), 'agent-loop-'));
  try {
    const host = new PromptHost({
      policy: makePolicy({ budget: 100 }),
      state: makeState(0),
      files: {},
      onWrite: () => {},
    });
    let runs = 0;
    const model = {
      calls: 0,
      async complete() {
        this.calls += 1;
        if (this.calls > 3) return { text: 'DONE' };
        return { toolCall: { tool: 'call_paid_api', args: { vendor: 'v.testnet', amount: 2 } } };
      },
    };

    const result = await runAgent({
      workdir,
      host,
      system: 'system',
      model,
      tools: {
        call_paid_api: {
          description: 'Call a paid API service.',
          parameters: { type: 'object', properties: { vendor: { type: 'string' }, amount: { type: 'number' } } },
          run: async () => {
            runs += 1;
            return { ok: true };
          },
        },
      },
    });

    assert.equal(runs, 3, 'every paid call should run');
    assert.equal(result.log.filter((e) => e.kind === 'repeated_call').length, 0);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});
