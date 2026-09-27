// Brain with Claude turned on, against a local stand-in for the Claude API: no network, no API spend.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.js';

// Each test sets what the fake API answers next; every request it receives is kept for inspection.
let reply = () => ({ status: 200, body: message('Mock answer from Claude.') });
const requests = [];
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  requests.push({ path: req.url, headers: req.headers, body: JSON.parse(raw) });
  const { status, body } = reply();
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});
await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));

const server = await startServer({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
after(() => { server.stop(); fake.close(); });

function message(text, stop_reason = 'end_turn') {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5', stop_reason, stop_sequence: null,
    content: text == null ? [] : [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 },
  };
}
const ask = async (batchId, question) => {
  const res = await fetch(`${server.base}/api/brain`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batchId, message: question }),
  });
  return (await res.json()).message;
};

test('the key in .env switches Brain to Claude', async () => {
  const health = await (await fetch(`${server.base}/api/health`)).json();
  assert.equal(health.engine, 'claude:claude-sonnet-5');
});

test('Claude gets the batch records, cached, and the question; its answer is saved', async () => {
  requests.length = 0;
  const answer = await ask(1, 'Why is this slower than last year?');
  assert.equal(answer.engine, 'claude:claude-sonnet-5');
  assert.equal(answer.content, 'Mock answer from Claude.');

  assert.equal(requests.length, 1);
  const { path, headers, body } = requests[0];
  assert.equal(path, '/v1/messages');
  assert.equal(headers['x-api-key'], 'test-key');
  assert.equal(body.model, 'claude-sonnet-5');
  assert.ok(body.max_tokens >= 8000, 'room for thinking plus the answer');
  const [instructions, records] = body.system;
  assert.match(instructions.text, /You are Harvest Brain/);
  assert.match(records.text, /BATCH #1: \d{4} Pinot Noir/);
  assert.match(records.text, /PRIOR VINTAGE/);
  assert.deepEqual(records.cache_control, { type: 'ephemeral' });
  assert.deepEqual(body.messages.at(-1), { role: 'user', content: 'Why is this slower than last year?' });
});

test('follow-up questions carry the thread, alternating roles', async () => {
  requests.length = 0;
  await ask(1, 'And the cap temperature?');
  const roles = requests[0].body.messages.map(m => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'user']);
});

test('an answer cut off at the length limit says so', async () => {
  reply = () => ({ status: 200, body: message('Partial answer', 'max_tokens') });
  const answer = await ask(1, 'Tell me everything');
  assert.match(answer.content, /^Partial answer\n\n\(Cut off at the length limit/);
});

test('a refusal or an API error falls back to the built-in rules and says why', async () => {
  reply = () => ({ status: 200, body: message(null, 'refusal') });
  let answer = await ask(1, 'Compare this ferment to last vintage');
  assert.equal(answer.engine, 'rules');
  assert.match(answer.content, /behind/);
  assert.match(answer.content, /Claude was unavailable: Claude declined to answer this one\. Answered from the built-in rules/);

  reply = () => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'model: not found' } } });
  answer = await ask(4, 'How much SO2 do I need?');
  assert.equal(answer.engine, 'rules');
  assert.match(answer.content, /g KMBS/);
  assert.match(answer.content, /Claude was unavailable: model: not found\./);
});

test('an overloaded API is retried once before falling back', async () => {
  requests.length = 0;
  reply = () => ({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } });
  const answer = await ask(null, 'What needs attention today?');
  assert.equal(requests.length, 2);
  assert.equal(answer.engine, 'rules');
  assert.match(answer.content, /In priority order/);
});
