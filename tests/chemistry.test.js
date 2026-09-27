import { test } from 'node:test';
import assert from 'node:assert/strict';
import { molecularSO2, freeSO2ForMolecular, so2Plan, potentialAlcohol, yanTarget, sugarDepletion } from '../shared/chemistry.js';

const near = (actual, expected, tol) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} not within ${tol} of ${expected}`);

test('molecular SO2 falls as pH rises', () => {
  near(molecularSO2(18, 3.45), 0.40, 0.005);
  near(molecularSO2(22, 3.79), 0.23, 0.005);
  assert.ok(molecularSO2(30, 3.3) > molecularSO2(30, 3.6));
  assert.equal(molecularSO2(null, 3.4), null);
});

test('free SO2 needed for a molecular target', () => {
  near(freeSO2ForMolecular(0.8, 3.5), 40, 0.1);
  near(freeSO2ForMolecular(0.5, 3.79), 48.3, 0.1);
});

test('SO2 plan gives ppm and grams of KMBS', () => {
  const plan = so2Plan({ freeSO2: 18, pH: 3.45, volumeL: 189, targetMolecular: 0.8 });
  near(plan.addPpm, 17.7, 0.1);
  near(plan.kmbsGrams, 5.8, 0.05);
});

test('SO2 plan never suggests a negative addition, and handles missing volume', () => {
  assert.equal(so2Plan({ freeSO2: 60, pH: 3.3, volumeL: 100, targetMolecular: 0.8 }).addPpm, 0);
  assert.equal(so2Plan({ freeSO2: 10, pH: 3.4, targetMolecular: 0.8 }).kmbsGrams, null);
  assert.equal(so2Plan({ freeSO2: 10, pH: null, targetMolecular: 0.8 }), null);
});

test('potential alcohol, YAN need, and sugar depletion', () => {
  assert.equal(potentialAlcohol(24).toFixed(1), '14.2');
  assert.equal(yanTarget(21), 150);
  assert.equal(yanTarget(25), 250);
  assert.equal(yanTarget(19), 150);
  assert.equal(sugarDepletion(24, 24), 0);
  assert.equal(sugarDepletion(24, -1.5), 1);
  near(sugarDepletion(24, 11.25), 0.5, 1e-9);
});

test('timestamps must name a real moment', async () => {
  const { parseStamp } = await import('../shared/time.js');
  assert.deepEqual(parseStamp('2026-09-27T07:30'), { date: '2026-09-27', time: '07:30' });
  assert.deepEqual(parseStamp('2026-09-27T07:30:15'), { date: '2026-09-27', time: '07:30' });
  assert.deepEqual(parseStamp('2026-09-27'), { date: '2026-09-27', time: null });
  assert.deepEqual(parseStamp('2028-02-29'), { date: '2028-02-29', time: null });
  for (const bad of ['2026-02-29', '2026-13-01', '2026-09-31', '2026-09-27T24:00', '2026-09-27T12:60', '2026-09-27garbage', '9/27/2026', '', null]) {
    assert.equal(parseStamp(bad), null, String(bad));
  }
});
