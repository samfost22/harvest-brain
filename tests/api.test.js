import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const server = await startServer(8791);
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
