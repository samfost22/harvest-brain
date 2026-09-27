// Demo cellar, dated relative to today so the harvest always looks live.
//   npm run seed   -> wipe and reseed the demo
//   npm run fresh  -> wipe to an empty cellar
import { pathToFileURL } from 'node:url';
import { getDb, run, tx } from './db.js';
import { localStamp } from './store.js';
import { DRY_BRIX } from '../shared/chemistry.js';

const DAY = 864e5;
const r1 = n => Math.round(n * 10) / 10;

/** Local stamp for today + dayOffset at hh:mm, optionally shifted back whole years. */
const at = (base, dayOffset, hour = 8, minute = 0, years = 0) =>
  localStamp(new Date(base.getFullYear() - years, base.getMonth(), base.getDate() + dayOffset, hour, minute));
const dateOf = stamp => stamp.slice(0, 10);

/** Logistic sugar curve pinned to `start` at t = 0 and ending just below dry. */
const sugarCurve = ({ start, k, mid }) => {
  const scale = (start - DRY_BRIX) * (1 + Math.exp(-k * mid));
  return t => DRY_BRIX + scale / (1 + Math.exp(k * (t - mid)));
};
const bell = (t, mid, width) => Math.exp(-((t - mid) ** 2) / (2 * width ** 2));

/** Deterministic wobble so curves look hand-measured. */
function wobble(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647 - 0.5) * 2;
  };
}

function fermentReadings({ inoculated, brix, must, cap, days, hours = [7, 17], seed = 7, now }) {
  const t0 = new Date(inoculated).getTime();
  const noise = wobble(seed);
  const rows = [];
  let prev = Infinity;
  for (let d = 0; d <= days; d++) {
    for (const h of hours) {
      const when = new Date(t0);
      when.setDate(when.getDate() + d);
      when.setHours(h, d % 3 === 1 ? 20 : 0, 0, 0);
      const t = (when.getTime() - t0) / DAY;
      const stamp = localStamp(when);
      if (t <= 0.05 || stamp > now) continue;
      const b = Math.min(prev, r1(brix(t) + noise() * 0.15));
      prev = b;
      rows.push({
        taken_at: stamp,
        brix: Math.max(b, DRY_BRIX - 0.3),
        must_temp_f: must ? Math.round(must(t) + noise() * 0.6) : null,
        cap_temp_f: cap && t > 0.6 ? Math.round(cap(t) + noise() * 0.6) : null,
      });
      if (b <= DRY_BRIX + 0.2) return rows;
    }
  }
  return rows;
}

function insertBatch(b) {
  const cols = Object.keys(b);
  const info = run(`INSERT INTO batches (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map(c => b[c]));
  return Number(info.lastInsertRowid);
}
function insertReadings(batchId, rows) {
  for (const r of rows) {
    run(`INSERT INTO readings (batch_id, taken_at, brix, must_temp_f, cap_temp_f, ph, ta, free_so2, total_so2, malic, ml_chroma, yan, va, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      batchId, r.taken_at, r.brix, r.must_temp_f, r.cap_temp_f, r.ph, r.ta, r.free_so2, r.total_so2, r.malic, r.ml_chroma, r.yan, r.va, r.note);
  }
}
function insertAdditions(batchId, rows) {
  for (const a of rows) {
    run(`INSERT INTO additions (batch_id, added_at, kind, product, amount, unit, so2_ppm, reason, ph_at_add, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      batchId, a.added_at, a.kind, a.product, a.amount, a.unit, a.so2_ppm, a.reason, a.ph_at_add, a.note);
  }
}
const kmbs = (ppm, liters) => r1((ppm * liters) / 1000 / 0.576);

export function wipe() {
  tx(() => {
    for (const t of ['brain_messages', 'decisions', 'journal', 'additions', 'readings', 'batches']) run(`DELETE FROM ${t}`);
  });
}

export function seedDemo(base = new Date()) {
  const now = localStamp(base);
  const V = new Date(base.getTime() - 10 * DAY).getFullYear();

  tx(() => {
    // ── 1. Current Pinot Noir: fermenting, behind last year's pace, hot cap, low YAN ──
    const pnInoc = at(base, -6, 9, 0);
    const pn = insertBatch({
      vintage: V, varietal: 'Pinot Noir', color: 'red', vineyard: 'Santa Lucia Highlands', block: 'Block 3',
      lineage: 'slh-block-3-pinot-noir', facility: 'Old Mill Custom Crush', vessel: 'Open-top fermenter, 1.5 T',
      volume_l: 1000, phase: 'af', harvest_date: dateOf(at(base, -10)), tons: 1.5, brix_at_pick: 25.2, ph_at_pick: 3.48,
      ta_at_pick: 5.9, yan_at_pick: 142, whole_cluster_pct: 30, yeast: 'RC212', inoculated_at: pnInoc,
    });
    insertReadings(pn, [
      { taken_at: at(base, -10, 14), brix: 25.2, must_temp_f: 56, ph: 3.48, ta: 5.9, yan: 142, note: 'At the crush pad' },
      { taken_at: at(base, -9, 8), brix: 25.3, must_temp_f: 53 },
      { taken_at: at(base, -8, 8), brix: 25.4, must_temp_f: 52 },
      { taken_at: at(base, -7, 8), brix: 25.4, must_temp_f: 55 },
      { taken_at: at(base, -6, 8, 30), brix: 25.4, must_temp_f: 60, note: 'Pulled dry ice, warming for inoculation' },
      ...fermentReadings({
        inoculated: pnInoc, now, days: 14, seed: 11,
        brix: sugarCurve({ start: 25.4, k: 0.72, mid: 5.2 }),
        must: t => 60 + 24 * bell(t, 5.5, 2.4),
        cap: t => 60 + 24 * bell(t, 5.5, 2.4) + 10.5 * bell(t, 5.3, 2.2),
      }),
    ]);
    insertAdditions(pn, [
      { added_at: at(base, -10, 14, 30), kind: 'so2', product: 'KMBS', amount: kmbs(30, 1000), unit: 'g', so2_ppm: 30, reason: 'crush', ph_at_add: 3.48 },
      { added_at: at(base, -6, 9), kind: 'nutrient', product: 'Go-Ferm Protect', amount: 300, unit: 'g', note: 'Rehydration' },
      { added_at: at(base, -6, 9, 5), kind: 'yeast', product: 'RC212', amount: 250, unit: 'g' },
      { added_at: at(base, -5, 8), kind: 'nutrient', product: 'Fermaid O', amount: 200, unit: 'g', note: '20 g/hL' },
    ]);

    // ── 2. Current Chardonnay: barrel ferment, cool and steady ──
    const chInoc = at(base, -10, 10, 0);
    const ch = insertBatch({
      vintage: V, varietal: 'Chardonnay', color: 'white', vineyard: 'Arroyo Seco', block: 'Block 7',
      lineage: 'arroyo-seco-block-7-chardonnay', facility: 'Old Mill Custom Crush', vessel: 'French oak barrels, 4 × 228 L',
      volume_l: 900, phase: 'af', harvest_date: dateOf(at(base, -12)), tons: 1.4, brix_at_pick: 23.4, ph_at_pick: 3.32,
      ta_at_pick: 7.4, yan_at_pick: 238, yeast: 'CY3079', inoculated_at: chInoc,
    });
    insertReadings(ch, [
      { taken_at: at(base, -12, 15), brix: 23.4, must_temp_f: 55, ph: 3.32, ta: 7.4, yan: 238, note: 'Settled juice' },
      ...fermentReadings({
        inoculated: chInoc, now, days: 30, hours: [8], seed: 5,
        brix: sugarCurve({ start: 23.4, k: 0.22, mid: 12.5 }),
        must: t => 57 + 4 * bell(t, 9, 5),
      }),
    ]);
    insertAdditions(ch, [
      { added_at: at(base, -11, 16), kind: 'so2', product: 'KMBS', amount: kmbs(25, 900), unit: 'g', so2_ppm: 25, reason: 'crush', ph_at_add: 3.32 },
      { added_at: at(base, -10, 10), kind: 'nutrient', product: 'Go-Ferm', amount: 270, unit: 'g', note: 'Rehydration' },
      { added_at: at(base, -10, 10, 5), kind: 'yeast', product: 'CY3079', amount: 225, unit: 'g' },
      { added_at: at(base, -8, 9), kind: 'nutrient', product: 'Fermaid K', amount: 180, unit: 'g' },
      { added_at: at(base, -4, 9), kind: 'nutrient', product: 'Fermaid O', amount: 180, unit: 'g', note: 'At one-third sugar depletion' },
    ]);

    // ── 3. Current Syrah: pressed, in MLF, cellar too cold ──
    const syInoc = at(base, -25, 9, 0);
    const syMl = at(base, -15, 11, 0);
    const sy = insertBatch({
      vintage: V, varietal: 'Syrah', color: 'red', vineyard: 'Pelio Vineyard', block: 'Block 2',
      lineage: 'pelio-block-2-syrah', facility: 'Old Mill Custom Crush', vessel: 'Neutral barrels, 3 × 228 L',
      volume_l: 684, phase: 'mlf', harvest_date: dateOf(at(base, -28)), tons: 1.1, brix_at_pick: 24.1, ph_at_pick: 3.62,
      ta_at_pick: 5.6, yan_at_pick: 188, yeast: 'D254', inoculated_at: syInoc, pressed_at: at(base, -16, 10),
      ml_strain: 'VP41', ml_inoculated_at: syMl,
    });
    insertReadings(sy, [
      { taken_at: at(base, -28, 13), brix: 24.1, must_temp_f: 64, ph: 3.62, ta: 5.6, yan: 188 },
      { taken_at: at(base, -25, 8, 30), brix: 24.1, must_temp_f: 62 },
      ...fermentReadings({
        inoculated: syInoc, now: at(base, -16, 9), days: 12, hours: [8], seed: 3,
        brix: sugarCurve({ start: 24.1, k: 0.9, mid: 4.5 }),
        must: t => 62 + 21 * bell(t, 4.6, 2.2),
        cap: t => 62 + 21 * bell(t, 4.6, 2.2) + 6 * bell(t, 4.5, 2),
      }),
      { taken_at: at(base, -15, 10), malic: 2.1, must_temp_f: 60, ph: 3.66, note: 'Before ML inoculation' },
      { taken_at: at(base, -12, 9), malic: 2.05, must_temp_f: 59 },
      { taken_at: at(base, -9, 9), malic: 2.02, must_temp_f: 58 },
      { taken_at: at(base, -6, 9), malic: 1.99, must_temp_f: 58 },
      { taken_at: at(base, -3, 9), malic: 1.96, must_temp_f: 57, ml_chroma: 'present' },
      { taken_at: at(base, -1, 9), malic: 1.94, must_temp_f: 58 },
    ]);
    insertAdditions(sy, [
      { added_at: at(base, -28, 14), kind: 'so2', product: 'KMBS', amount: kmbs(25, 760), unit: 'g', so2_ppm: 25, reason: 'crush', ph_at_add: 3.62 },
      { added_at: at(base, -25, 9), kind: 'nutrient', product: 'Go-Ferm Protect', amount: 230, unit: 'g', note: 'Rehydration' },
      { added_at: at(base, -25, 9, 5), kind: 'yeast', product: 'D254', amount: 190, unit: 'g' },
      { added_at: at(base, -24, 8), kind: 'nutrient', product: 'Fermaid O', amount: 150, unit: 'g' },
      { added_at: at(base, -22, 8), kind: 'nutrient', product: 'Fermaid O', amount: 150, unit: 'g', note: 'At one-third sugar depletion' },
      { added_at: syMl, kind: 'ml_bacteria', product: 'VP41', amount: 7, unit: 'g', note: '1 g/hL' },
    ]);

    // ── 4. Last year's rosé: home cellar keg, molecular SO₂ has drifted low ──
    const ro = insertBatch({
      vintage: V - 1, varietal: 'Grenache Rosé', color: 'rose', vineyard: 'Arroyo Seco', block: 'Block 11',
      lineage: 'arroyo-seco-block-11-grenache-rose', facility: 'Home cellar', vessel: 'Stainless keg tank, 50 gal',
      volume_l: 189, phase: 'aging', harvest_date: `${V - 1}-09-12`, tons: 0.25, brix_at_pick: 21.8, ph_at_pick: 3.31, ta_at_pick: 6.9,
    });
    insertReadings(ro, [
      { taken_at: at(base, -95, 18), free_so2: 31, ph: 3.43, total_so2: 92 },
      { taken_at: at(base, -60, 18), free_so2: 25, ph: 3.44, total_so2: 96 },
      { taken_at: at(base, -21, 18), free_so2: 18, ph: 3.45, total_so2: 90, va: 0.36 },
    ]);
    insertAdditions(ro, [
      { added_at: `${V - 1}-09-12T15:00`, kind: 'so2', product: 'KMBS', amount: kmbs(25, 200), unit: 'g', so2_ppm: 25, reason: 'crush', ph_at_add: 3.31 },
      { added_at: `${V - 1}-10-10T17:00`, kind: 'so2', product: 'KMBS', amount: kmbs(40, 189), unit: 'g', so2_ppm: 40, reason: 'post_ferment', ph_at_add: 3.42 },
      { added_at: at(base, -95, 18, 30), kind: 'so2', product: 'KMBS', amount: kmbs(20, 189), unit: 'g', so2_ppm: 20, reason: 'racking', ph_at_add: 3.43 },
    ]);

    // ── 5. Last year's Syrah: barrel aging, high pH, low molecular SO₂, Brett words in the notes ──
    const sy1Inoc = at(base, -25, 9, 0, 1);
    const sy1 = insertBatch({
      vintage: V - 1, varietal: 'Syrah', color: 'red', vineyard: 'Pelio Vineyard', block: 'Block 2',
      lineage: 'pelio-block-2-syrah', facility: 'Old Mill Custom Crush', vessel: 'French oak barrels, 2 × 228 L',
      volume_l: 456, phase: 'aging', harvest_date: dateOf(at(base, -28, 8, 0, 1)), tons: 0.8, brix_at_pick: 24.4, ph_at_pick: 3.66,
      ta_at_pick: 5.4, yan_at_pick: 201, yeast: 'D254', inoculated_at: sy1Inoc, pressed_at: at(base, -16, 10, 0, 1),
      ml_strain: 'VP41', ml_inoculated_at: at(base, -15, 11, 0, 1), ml_completed_at: `${V - 1}-11-15`,
    });
    insertReadings(sy1, [
      { taken_at: at(base, -25, 8, 30, 1), brix: 24.4, must_temp_f: 63 },
      ...fermentReadings({
        inoculated: sy1Inoc, now, days: 12, hours: [8], seed: 17,
        brix: sugarCurve({ start: 24.4, k: 0.95, mid: 4.2 }),
        must: t => 62 + 22 * bell(t, 4.3, 2.2),
        cap: t => 62 + 22 * bell(t, 4.3, 2.2) + 6 * bell(t, 4.2, 2),
      }),
      { taken_at: at(base, -40, 10), free_so2: 24, ph: 3.78, total_so2: 72, va: 0.52 },
      { taken_at: at(base, -5, 10), free_so2: 22, ph: 3.79, total_so2: 70, va: 0.58 },
    ]);
    insertAdditions(sy1, [
      { added_at: `${V - 1}-11-20T10:00`, kind: 'so2', product: 'KMBS', amount: kmbs(40, 456), unit: 'g', so2_ppm: 40, reason: 'post_mlf', ph_at_add: 3.76 },
      { added_at: at(base, -60, 10), kind: 'so2', product: 'KMBS', amount: kmbs(25, 456), unit: 'g', so2_ppm: 25, reason: 'racking', ph_at_add: 3.78 },
    ]);

    // ── 6–7. Same Pinot block, two prior vintages: the comparison baseline ──
    const pn1Inoc = at(base, -6, 9, 0, 1);
    const pn1 = insertBatch({
      vintage: V - 1, varietal: 'Pinot Noir', color: 'red', vineyard: 'Santa Lucia Highlands', block: 'Block 3',
      lineage: 'slh-block-3-pinot-noir', facility: 'Old Mill Custom Crush', vessel: 'French oak barrels, 4 × 228 L',
      volume_l: 900, phase: 'aging', harvest_date: dateOf(at(base, -10, 8, 0, 1)), tons: 1.4, brix_at_pick: 24.5, ph_at_pick: 3.44,
      ta_at_pick: 6.2, yan_at_pick: 205, whole_cluster_pct: 25, yeast: 'RC212', inoculated_at: pn1Inoc,
      pressed_at: at(base, 6, 10, 0, 1), ml_strain: 'VP41', ml_inoculated_at: at(base, 7, 10, 0, 1), ml_completed_at: `${V - 1}-11-28`,
    });
    insertReadings(pn1, [
      { taken_at: at(base, -10, 13, 0, 1), brix: 24.5, must_temp_f: 58, ph: 3.44, ta: 6.2, yan: 205 },
      { taken_at: at(base, -6, 8, 30, 1), brix: 24.6, must_temp_f: 60 },
      ...fermentReadings({
        inoculated: pn1Inoc, now, days: 14, seed: 23,
        brix: sugarCurve({ start: 24.6, k: 0.95, mid: 4.0 }),
        must: t => 58 + 24 * bell(t, 4.2, 2.2),
        cap: t => 58 + 24 * bell(t, 4.2, 2.2) + 7 * bell(t, 4.0, 2),
      }),
      { taken_at: at(base, -24, 10), free_so2: 28, ph: 3.52, total_so2: 64, va: 0.41 },
    ]);
    insertAdditions(pn1, [
      { added_at: at(base, -10, 14, 0, 1), kind: 'so2', product: 'KMBS', amount: kmbs(30, 950), unit: 'g', so2_ppm: 30, reason: 'crush', ph_at_add: 3.44 },
      { added_at: pn1Inoc, kind: 'nutrient', product: 'Go-Ferm Protect', amount: 280, unit: 'g', note: 'Rehydration' },
      { added_at: pn1Inoc, kind: 'yeast', product: 'RC212', amount: 240, unit: 'g' },
      { added_at: at(base, -5, 8, 0, 1), kind: 'nutrient', product: 'Fermaid O', amount: 190, unit: 'g' },
      { added_at: at(base, -3, 8, 0, 1), kind: 'nutrient', product: 'Fermaid O', amount: 190, unit: 'g', note: 'At one-third sugar depletion' },
      { added_at: `${V - 1}-12-02T10:00`, kind: 'so2', product: 'KMBS', amount: kmbs(45, 900), unit: 'g', so2_ppm: 45, reason: 'post_mlf', ph_at_add: 3.51 },
    ]);

    const pn2Inoc = at(base, -6, 9, 0, 2);
    const pn2 = insertBatch({
      vintage: V - 2, varietal: 'Pinot Noir', color: 'red', vineyard: 'Santa Lucia Highlands', block: 'Block 3',
      lineage: 'slh-block-3-pinot-noir', facility: 'Old Mill Custom Crush', vessel: 'French oak barrels, 4 × 228 L',
      volume_l: 880, phase: 'bottled', harvest_date: dateOf(at(base, -10, 8, 0, 2)), tons: 1.3, brix_at_pick: 23.8, ph_at_pick: 3.41,
      ta_at_pick: 6.4, yan_at_pick: 176, whole_cluster_pct: 20, yeast: 'RC212', inoculated_at: pn2Inoc, bottled_at: `${V - 1}-08-20`,
    });
    insertReadings(pn2, [
      { taken_at: at(base, -6, 8, 30, 2), brix: 23.9, must_temp_f: 59 },
      ...fermentReadings({
        inoculated: pn2Inoc, now, days: 14, seed: 29,
        brix: sugarCurve({ start: 23.9, k: 0.85, mid: 4.4 }),
        must: t => 58 + 23 * bell(t, 4.6, 2.3),
        cap: t => 58 + 23 * bell(t, 4.6, 2.3) + 6 * bell(t, 4.4, 2),
      }),
    ]);

    // ── Journal ──
    const journal = [
      [-10, pn, 'fog,sun', 'Picked SLH Block 3 at first light, 1.5 tons. Set aside 30% whole cluster. Fruit is riper than last year after the heat spike: seeds brown, stems still green on the clusters we kept whole.'],
      [-9, pn, 'heat', 'Heat again, 97 °F in Soledad by 3 pm. Cold soak on the Pinot holding at 53 °F with dry ice.'],
      [-6, null, 'fog', 'Inoculated the Pinot with RC212 and Go-Ferm. Chard barrels bubbling nicely at 60 °F.'],
      [-4, pn, 'sun', 'Pinot cap getting thick and hot. Up to three punch-downs a day. Smells great: violet, dark cherry, a little stem spice from the whole clusters.'],
      [-3, sy1, 'fog', "Topped last year's Syrah. Barrel 2 has a little barnyard creeping in behind the dark fruit, maybe band-aid on the finish? Barrel 1 still clean."],
      [-2, sy, 'wind', 'Syrah barely moving on ML. The barrel room is cold, 58 °F by the racks. Need a heater or move the barrels to the warm room.'],
      [-1, ch, 'sun', 'Tasted the Chard barrels: pear, lemon curd. Barrel 3 a touch reductive, gave it a stir.'],
    ];
    for (const [offset, batchId, weather, body] of journal) {
      run('INSERT INTO journal (entry_date, batch_id, body, weather) VALUES (?, ?, ?, ?)', dateOf(at(base, offset)), batchId, body, weather);
    }

    run('INSERT INTO decisions (batch_id, decided_at, decision, rationale, source) VALUES (?, ?, ?, ?, ?)',
      pn, at(base, -4, 18), 'Punch down three times a day through peak; hold the must under 85 °F.',
      'Cap hit 88 °F on day 2 with 30% whole cluster.', 'manual');
  });
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  getDb();
  wipe();
  if (process.argv.includes('--empty')) {
    console.log('Cellar wiped. Start the app and add your first batch.');
  } else {
    seedDemo();
    console.log('Demo cellar seeded, dated to today.');
  }
}
