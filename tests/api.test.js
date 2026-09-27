import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const server = await startServer();
after(() => server.stop());
const call = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${server.base}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
};

test('empty database seeds the demo cellar on first start', async () => {
  const { data } = await call('/api/state');
  assert.equal(data.batches.length, 7);
  assert.equal(data.engine, 'rules');
  assert.ok(data.alerts.length >= 6);
});

test('saving a reading and an SO2 addition clears the SO2 alert', async () => {
  const { status, data } = await call('/api/entries', {
    method: 'POST',
    body: { batchId: 4, reading: { free_so2: 36, ph: 3.45 }, additions: [{ kind: 'so2', product: 'KMBS', amount: 5.8, unit: 'g', so2_ppm: 18, reason: 'topping' }] },
  });
  assert.equal(status, 200);
  assert.ok(!data.alerts.some(a => a.kind === 'so2-low'));
  assert.ok(data.metrics.molecular > 0.8);
});

test('bad input gets a plain-language 400', async () => {
  const bad = await call('/api/entries', { method: 'POST', body: { batchId: 4, reading: { brix: 'abc' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /brix must be a number/);
  const empty = await call('/api/entries', { method: 'POST', body: { batchId: 4 } });
  assert.equal(empty.status, 400);
  assert.equal((await call('/api/batches/999')).status, 404);
});

test('a yeast addition starts primary; phase changes stamp their dates', async () => {
  const created = await call('/api/batches', { method: 'POST', body: { vintage: 2026, varietal: 'Grenache', vineyard: 'Arroyo Seco', block: 'Block 11', phase: 'cold_soak', volume_l: 150 } });
  const id = created.data.batch.id;
  assert.equal(created.data.batch.lineage, 'arroyo-seco-block-11-grenache');
  await call('/api/entries', { method: 'POST', body: { batchId: id, reading: { brix: 24 }, additions: [{ kind: 'yeast', product: 'BM4X4', amount: 40, unit: 'g' }] } });
  let b = (await call(`/api/batches/${id}`)).data.batch;
  assert.equal(b.phase, 'af');
  assert.equal(b.yeast, 'BM4X4');
  assert.ok(b.inoculated_at);
  b = (await call(`/api/batches/${id}`, { method: 'PATCH', body: { phase: 'pressed' } })).data.batch;
  assert.ok(b.pressed_at);
});

test('journal, Brain, decisions, and export', async () => {
  const entry = await call('/api/journal', { method: 'POST', body: { body: 'Smoke on the ridge by noon.', weather: ['smoke'], batchId: 1 } });
  assert.equal(entry.data.weather, 'smoke');
  const brain = await call('/api/brain', { method: 'POST', body: { batchId: 1, message: 'Compare this ferment to last vintage' } });
  assert.equal(brain.data.message.engine, 'rules');
  assert.match(brain.data.message.content, /behind/);
  const thread = await call('/api/brain?batchId=1');
  assert.equal(thread.data.messages.length, 2);
  const decision = await call('/api/decisions', { method: 'POST', body: { batchId: 1, decision: 'Add yeast hulls at 25 g/hL', source: 'brain' } });
  assert.equal(decision.data.source, 'brain');
  const res = await fetch(`${server.base}/api/export`);
  assert.match(res.headers.get('content-disposition'), /harvest-brain-export/);
  const dump = await res.json();
  assert.ok(dump.batches.length >= 8 && dump.readings.length > 50);
});

// ── Hardening ──────────────────────────────────────────────────────────
const raw = (path, { method = 'GET', headers = {}, body } = {}) => fetch(`${server.base}${path}`, { method, headers, body });

test('writes must be JSON, so another website cannot post into the cellar', async () => {
  const res = await raw('/api/journal', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ body: 'planted' }) });
  assert.equal(res.status, 415);
  const { data } = await call('/api/journal');
  assert.ok(![...data.entries, ...data.recent].some(e => e.body === 'planted'));
});

test('requests addressed to an unknown host name are refused (DNS rebinding)', async () => {
  const headers = host => ({ headers: { host } });
  // fetch won't override Host, so use node:http directly
  const http = await import('node:http');
  const status = host => new Promise((resolve, reject) => {
    const { port } = new URL(server.base);
    http.get({ host: '127.0.0.1', port, path: '/api/health', ...headers(host) }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(await status('evil.example.com'), 403);
  assert.equal(await status('localhost:5173'), 200);
  assert.equal(await status('192.168.1.20:5173'), 200);
  assert.equal(await status('cellar-mac.local:5173'), 200);
});

test('oversized bodies are rejected', async () => {
  const res = await raw('/api/journal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'x'.repeat(1.1 * 1024 * 1024) }) });
  assert.equal(res.status, 413);
});

test('references to missing batches are a 404, not a server error', async () => {
  assert.equal((await call('/api/journal', { method: 'POST', body: { body: 'x', batchId: 999 } })).status, 404);
  assert.equal((await call('/api/decisions', { method: 'POST', body: { decision: 'x', batchId: 999 } })).status, 404);
  assert.equal((await call('/api/brain?batchId=abc')).status, 404);
  assert.equal((await call('/api/entries', { method: 'POST', body: { reading: { brix: 3 } } })).status, 400);
});

test('batch edits cannot blank required fields', async () => {
  const blank = await call('/api/batches/2', { method: 'PATCH', body: { varietal: '' } });
  assert.equal(blank.status, 400);
  assert.match(blank.data.error, /varietal is required/);
  assert.equal((await call('/api/batches/2', { method: 'PATCH', body: { vintage: 26 } })).status, 400);
  assert.equal((await call('/api/batches/2')).data.batch.varietal, 'Chardonnay');
});

test('impossible dates are rejected; a bare date logs at noon', async () => {
  const bad = await call('/api/entries', { method: 'POST', body: { batchId: 2, takenAt: '2026-13-45T99:99', reading: { brix: 3 } } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /real date/);
  assert.equal((await call('/api/entries', { method: 'POST', body: { batchId: 2, takenAt: '2026-02-30', reading: { brix: 3 } } })).status, 400);
  assert.equal((await call('/api/journal?date=yesterday')).status, 400);
  assert.equal((await call('/api/batches/2', { method: 'PATCH', body: { bottled_at: '2026-06-31' } })).status, 400);
  await call('/api/entries', { method: 'POST', body: { batchId: 6, takenAt: '2026-01-15', reading: { free_so2: 30, ph: 3.5 } } });
  const readings = (await call('/api/batches/6')).data.readings;
  assert.ok(readings.some(r => r.taken_at === '2026-01-15T12:00'));
});

test('ML bacteria during primary is co-inoculation and keeps the primary alerts', async () => {
  const before = (await call('/api/batches/1')).data;
  assert.equal(before.batch.phase, 'af');
  await call('/api/entries', { method: 'POST', body: { batchId: 1, additions: [{ kind: 'ml_bacteria', product: 'VP41', amount: 10, unit: 'g' }] } });
  const after = (await call('/api/batches/1')).data;
  assert.equal(after.batch.phase, 'af');
  assert.ok(after.batch.ml_inoculated_at);
  assert.ok(after.alerts.some(a => a.kind === 'cap-temp'));

  const soak = (await call('/api/batches', { method: 'POST', body: { vintage: 2026, varietal: 'Petite Sirah', phase: 'cold_soak' } })).data.batch;
  await call('/api/entries', { method: 'POST', body: { batchId: soak.id, reading: { brix: 25 }, additions: [{ kind: 'yeast', product: 'D254' }, { kind: 'ml_bacteria', product: 'VP41' }] } });
  const both = (await call(`/api/batches/${soak.id}`)).data.batch;
  assert.equal(both.phase, 'af', 'yeast and bacteria together start primary and stay there');
  assert.ok(both.inoculated_at && both.ml_inoculated_at);

  const pressed = (await call('/api/batches', { method: 'POST', body: { vintage: 2026, varietal: 'Mourvèdre', phase: 'pressed' } })).data.batch;
  await call('/api/entries', { method: 'POST', body: { batchId: pressed.id, reading: { brix: -1.4 }, additions: [{ kind: 'ml_bacteria', product: 'CH16' }] } });
  assert.equal((await call(`/api/batches/${pressed.id}`)).data.batch.phase, 'mlf');
});

test('wrong method on a real route is a 405; the export is named for today', async () => {
  assert.equal((await call('/api/state', { method: 'POST', body: {} })).status, 405);
  const res = await raw('/api/export');
  const { localDate } = await import('../shared/time.js');
  assert.match(res.headers.get('content-disposition'), new RegExp(`harvest-brain-export-${localDate()}\\.json`));
  await res.body.cancel();
});

test('a malformed URL gets a 400 and the server keeps running', async () => {
  assert.equal((await raw('/%E0%A4%A')).status, 400);
  assert.equal((await raw('/..%2f..%2fpackage.json')).headers.get('content-type')?.startsWith('application/json'), false);
  assert.equal((await call('/api/health')).status, 200);
});
