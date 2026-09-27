// The decision engine against the demo cellar and hand-built edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HB_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hb-engine-')), 'test.db');
const { getDb } = await import('../server/db.js');
const { seedDemo } = await import('../server/seed.js');
const { analyzeBatch, cellarState } = await import('../server/store.js');
const { analyze } = await import('../server/analysis.js');
const { offlineAnswer } = await import('../server/brain.js');

const base = new Date(2026, 8, 26, 14, 0); // Sep 26, 2026, 2 pm: a fixed "now" so results are repeatable
const now = base.getTime();
getDb();
seedDemo(base);
const kinds = id => analyzeBatch(id, now).alerts.map(a => a.kind);
const ctx = id => ({ focus: id ? analyzeBatch(id, now) : null, state: cellarState(now) });

test('current Pinot: behind the same block last year, hot cap, past the nutrient window', () => {
  const x = analyzeBatch(1, now);
  assert.equal(x.comparison.vintage, 2025);
  assert.ok(x.comparison.pctSlower > 15, `pctSlower ${x.comparison.pctSlower}`);
  assert.deepEqual(kinds(1).sort(), ['cap-temp', 'nutrient-late', 'vs-prior']);
});

test('Chardonnay fermenting cool and steady raises nothing', () => {
  assert.deepEqual(kinds(2), []);
});

test('Syrah in MLF: too cold and stalled', () => {
  assert.deepEqual(kinds(3).sort(), ['mlf-cold', 'mlf-stall']);
});

test('rosé with low molecular SO2 gets a dose for its volume', () => {
  const alert = analyzeBatch(4, now).alerts.find(a => a.kind === 'so2-low');
  assert.ok(alert);
  assert.match(alert.action, /18 ppm, roughly 5\.8 g KMBS for 189 L/);
});

test('last year\'s Syrah: Brett words in the journal plus low SO2 at high pH', () => {
  assert.deepEqual(kinds(5).sort(), ['brett', 'so2-low']);
  const so2 = analyzeBatch(5, now).alerts.find(a => a.kind === 'so2-low');
  assert.match(so2.detail, /tartaric/);
});

test('healthy aging and bottled batches stay quiet', () => {
  assert.deepEqual(kinds(6), []);
  assert.deepEqual(kinds(7), []);
});

test('cellar state orders alerts by severity', () => {
  const order = { act: 0, watch: 1, info: 2 };
  const sev = cellarState(now).alerts.map(a => order[a.severity]);
  assert.deepEqual(sev, [...sev].sort((a, b) => a - b));
});

// Hand-built cases
const batch = (over = {}) => ({ id: 99, vintage: 2026, varietal: 'Zinfandel', color: 'red', phase: 'af', inoculated_at: '2026-09-18T09:00', brix_at_pick: 26, ...over });
const r = (taken_at, fields) => ({ taken_at, ...fields });

test('flat Brix for two days reads as stuck', () => {
  const readings = [
    r('2026-09-18T08:00', { brix: 26 }), r('2026-09-20T08:00', { brix: 18 }), r('2026-09-22T08:00', { brix: 9.2 }),
    r('2026-09-23T08:00', { brix: 8.9 }), r('2026-09-24T08:00', { brix: 8.8 }),
  ];
  const out = analyze({ batch: batch(), readings, additions: [], journal: [] }, new Date(2026, 8, 24, 10).getTime());
  assert.ok(out.alerts.some(a => a.kind === 'stuck' && a.severity === 'act'));
});

test('no reading for more than 30 hours during primary', () => {
  const readings = [r('2026-09-19T08:00', { brix: 24 }), r('2026-09-20T08:00', { brix: 20 })];
  const out = analyze({ batch: batch(), readings, additions: [], journal: [] }, new Date(2026, 8, 21, 20).getTime());
  assert.ok(out.alerts.some(a => a.kind === 'stale'));
});

test('malic spot gone means MLF looks done; SO2 during MLF is flagged', () => {
  const b = batch({ phase: 'mlf', ml_inoculated_at: '2026-09-01T10:00' });
  const readings = [r('2026-09-02T09:00', { malic: 1.8, must_temp_f: 68 }), r('2026-09-20T09:00', { ml_chroma: 'absent', must_temp_f: 68 })];
  const additions = [{ kind: 'so2', added_at: '2026-09-10T10:00', so2_ppm: 20 }];
  const out = analyze({ batch: b, readings, additions, journal: [] }, new Date(2026, 8, 21).getTime());
  assert.ok(out.alerts.some(a => a.kind === 'mlf-done'));
  assert.ok(out.alerts.some(a => a.kind === 'mlf-so2'));
});

test('offline Brain grounds answers in the records', () => {
  const compare = offlineAnswer('Compare this ferment to last vintage', ctx(1));
  assert.match(compare, /behind/);
  assert.match(compare, /YAN at pick 142 mg\/L vs 205 in 2025/);
  assert.match(offlineAnswer('how much SO2 do I need?', ctx(4)), /5\.8 g KMBS/);
  assert.match(offlineAnswer('is it stuck?', ctx(1)), /No restart needed/);
  assert.match(offlineAnswer('is MLF progressing?', ctx(3)), /Malic \(g\/L\)/);
  assert.match(offlineAnswer('what needs attention?', ctx(null)), /In priority order/);
  assert.match(offlineAnswer('should I add SO2?', ctx(3)), /Hold SO₂/);
});
