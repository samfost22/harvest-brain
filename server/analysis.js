// The decision engine: turns raw readings into metrics, vintage comparisons, and alerts.
import { RULES, SEVERITY_ORDER } from '../shared/rules.js';
import { DRY_BRIX, molecularSO2, so2Plan, sugarDepletion, yanTarget } from '../shared/chemistry.js';
import { brixAtDay } from '../shared/curve.js';

export { brixAtDay };

const HOUR = 36e5;
const DAY = 24 * HOUR;

// Local wall-clock strings. Date-only strings are pinned to noon so they never slip a day.
export const ms = s => (s ? new Date(s.length === 10 ? `${s}T12:00` : s).getTime() : null);
export const shortDate = s => new Date(s.length === 10 ? `${s}T12:00` : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const batchName = b => `${b.vintage} ${b.varietal}`;
export const f1 = n => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1));
export const f2 = n => (n == null ? '—' : n.toFixed(2));
export const i0 = n => (n == null ? '—' : String(Math.round(n)));

const latest = (rows, key) => {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return rows[i];
  return null;
};

/** Complex nutrients count; rehydration nutrients (Go-Ferm) at inoculation don't. */
export const isFeeding = a => a.kind === 'nutrient' && !/go-?ferm|rehydrat/i.test(`${a.product ?? ''} ${a.note ?? ''}`);

/** Brix by day since inoculation. Negative days are cold soak. */
export function afCurve(batch, readings) {
  const t0 = ms(batch.inoculated_at);
  if (!t0) return [];
  return readings
    .filter(r => r.brix != null)
    .map(r => ({
      day: Math.round(((ms(r.taken_at) - t0) / DAY) * 100) / 100,
      brix: r.brix,
      must: r.must_temp_f,
      cap: r.cap_temp_f,
      at: r.taken_at,
    }));
}

/** °Bx per day over roughly the last 48 h (at least 20 h of history). */
export function brixRate(readings) {
  const pts = readings.filter(r => r.brix != null);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const lastT = ms(last.taken_at);
  let ref = null;
  for (let i = pts.length - 2; i >= 0; i--) {
    const dt = lastT - ms(pts[i].taken_at);
    if (dt >= 20 * HOUR) {
      ref = pts[i];
      if (dt >= 44 * HOUR) break;
    }
  }
  if (!ref) return null;
  const days = (lastT - ms(ref.taken_at)) / DAY;
  return { perDay: (ref.brix - last.brix) / days, overHours: days * 24 };
}

export function computeMetrics(batch, readings, nowMs = Date.now()) {
  const curve = afCurve(batch, readings);
  const last = readings.at(-1) ?? null;
  const brixRow = latest(readings, 'brix');
  const fermenting = batch.inoculated_at ? readings.filter(r => r.taken_at >= batch.inoculated_at) : readings;
  const rate = brixRate(fermenting);
  const startBrix = (curve.length ? brixAtDay(curve, 0) : null) ?? batch.brix_at_pick ?? null;
  const so2Row = latest(readings, 'free_so2');
  const ph = so2Row?.ph ?? latest(readings, 'ph')?.ph ?? batch.ph_at_pick ?? null;
  const capRow = latest(readings, 'cap_temp_f');
  const mustRow = latest(readings, 'must_temp_f');
  const malicRow = latest(readings, 'malic');
  const brix = brixRow?.brix ?? null;
  const ratePerDay = rate?.perDay ?? null;
  return {
    brix,
    brixAt: brixRow?.taken_at ?? null,
    ratePerDay,
    afDay: batch.inoculated_at ? (nowMs - ms(batch.inoculated_at)) / DAY : null,
    mlfDay: batch.ml_inoculated_at ? (nowMs - ms(batch.ml_inoculated_at)) / DAY : null,
    startBrix,
    depletion: sugarDepletion(startBrix, brix),
    daysToDry: brix != null && ratePerDay > 0.2 && brix > DRY_BRIX ? (brix - DRY_BRIX) / ratePerDay : null,
    capF: capRow?.cap_temp_f ?? null,
    capAt: capRow?.taken_at ?? null,
    mustF: mustRow?.must_temp_f ?? null,
    mustAt: mustRow?.taken_at ?? null,
    freeSO2: so2Row?.free_so2 ?? null,
    totalSO2: latest(readings, 'total_so2')?.total_so2 ?? null,
    so2At: so2Row?.taken_at ?? null,
    ph,
    molecular: molecularSO2(so2Row?.free_so2 ?? null, ph),
    malic: malicRow?.malic ?? null,
    malicAt: malicRow?.taken_at ?? null,
    va: latest(readings, 'va')?.va ?? null,
    lastReadingAt: last?.taken_at ?? null,
    hoursSinceReading: last ? (nowMs - ms(last.taken_at)) / HOUR : null,
  };
}

/** Compare cumulative sugar drop with the most recent prior vintage of the same block, at the same day. */
export function compareToPrior(batch, curve, priorCurves) {
  const now = curve.at(-1);
  if (!now || now.day < 1) return null;
  const start = brixAtDay(curve, 0) ?? batch.brix_at_pick;
  for (const p of priorCurves) {
    const pStart = brixAtDay(p.curve, 0) ?? p.batch.brix_at_pick;
    const pAt = brixAtDay(p.curve, now.day);
    if (start == null || pStart == null || pAt == null) continue;
    const curDrop = start - now.brix;
    const priorDrop = pStart - pAt;
    if (priorDrop <= 0.5) continue;
    return {
      vintage: p.batch.vintage,
      batchId: p.batch.id,
      day: now.day,
      brixNow: now.brix,
      priorBrix: pAt,
      startNow: start,
      startPrior: pStart,
      curDrop,
      priorDrop,
      pctSlower: (1 - curDrop / priorDrop) * 100,
    };
  }
  return null;
}

export function computeAlerts(batch, loaded, m, cmp, nowMs = Date.now()) {
  const out = [];
  const color = batch.color || 'red';
  const { readings = [], additions = [], journal = [] } = loaded;
  const add = (severity, kind, title, detail, action) =>
    out.push({ id: `${batch.id}:${kind}`, batchId: batch.id, batchName: batchName(batch), severity, kind, title, detail, action });

  // ── Primary fermentation ─────────────────────────────────────────────
  if (batch.phase === 'af') {
    if (m.hoursSinceReading != null && m.hoursSinceReading > RULES.staleReadingHours) {
      add('watch', 'stale', `No reading in ${Math.round(m.hoursSinceReading)} hours`,
        `Last logged ${shortDate(m.lastReadingAt)}.`, 'Log a Brix and temperature so the curve stays honest.');
    }
    const afDay = m.afDay ?? 0;
    if (m.brix != null && m.brix > DRY_BRIX + 0.5 && m.ratePerDay != null && afDay > 2 && m.ratePerDay < RULES.stuckBrixPerDay) {
      add('act', 'stuck', `Ferment may be stuck at ${f1(m.brix)} °Bx`,
        `Only ${f1(m.ratePerDay)} °Bx/day over the last two days.`,
        'Check temperature and nutrition, then ask Brain for the restart steps.');
    } else if (m.brix != null && m.brix > 5 && m.ratePerDay != null && afDay > 1.5 && m.ratePerDay < RULES.sluggishBrixPerDay[color]) {
      add('watch', 'sluggish', `Ferment slowing to ${f1(m.ratePerDay)} °Bx/day`,
        `At ${f1(m.brix)} °Bx with ${Math.round((1 - (m.depletion ?? 0)) * 100)}% of the sugar left.`,
        'Warm it, mix it, and check nutrition before it stalls.');
    }

    if (cmp && cmp.brixNow > 0) {
      if (cmp.pctSlower >= RULES.vsLastVintageWatchPct) {
        add(cmp.pctSlower >= RULES.vsLastVintageActPct ? 'act' : 'watch', 'vs-prior',
          `${Math.round(cmp.pctSlower)}% behind ${cmp.vintage} at day ${f1(cmp.day)}`,
          `${f1(cmp.brixNow)} °Bx now. The ${cmp.vintage} lot from this block was at ${f1(cmp.priorBrix)} °Bx at the same point.`,
          'Ask Brain what differs between the two vintages.');
      } else if (cmp.pctSlower <= -RULES.vsLastVintageWatchPct) {
        add('info', 'vs-prior', `Running ${Math.round(-cmp.pctSlower)}% ahead of ${cmp.vintage}`,
          `${f1(cmp.brixNow)} °Bx now vs ${f1(cmp.priorBrix)} °Bx at day ${f1(cmp.day)} in ${cmp.vintage}.`,
          'Fast ferments run hot. Keep an eye on the cap.');
      }
    }

    const capFresh = m.capF != null && m.capAt && nowMs - ms(m.capAt) < 36 * HOUR;
    if (capFresh) {
      const delta = m.mustF != null ? m.capF - m.mustF : null;
      if (m.capF >= RULES.capTempWatchF || (delta != null && delta >= RULES.capOverMustWatchF)) {
        add(m.capF >= RULES.capTempActF ? 'act' : 'watch', 'cap-temp', `Cap at ${i0(m.capF)} °F`,
          delta != null
            ? `${i0(delta)} °F hotter than the must (${i0(m.mustF)} °F). Yeast stress climbs above about 90 °F.`
            : 'Yeast stress climbs above about 90 °F.',
          'Add a punch-down and pull heat out of the must.');
      }
    }

    if (batch.yan_at_pick != null && m.depletion != null) {
      const need = yanTarget(m.startBrix ?? batch.brix_at_pick);
      const low = batch.yan_at_pick < need;
      const feeds = additions.filter(a => isFeeding(a) && (!batch.inoculated_at || a.added_at >= batch.inoculated_at)).length;
      if (low && feeds === 0 && m.depletion < RULES.nutrientSecondAt) {
        add('act', 'nutrient-first', 'First nutrient addition is due',
          `YAN at pick was ${i0(batch.yan_at_pick)} mg/L against a need of about ${need} mg/L.`,
          'Add a complex nutrient now. The window is 24–48 hours after inoculation.');
      } else if (low && feeds === 1 && m.depletion >= RULES.nutrientSecondAt && m.depletion < RULES.nutrientCutoff) {
        add('watch', 'nutrient-second', 'Second nutrient window is open',
          `${Math.round(m.depletion * 100)}% of the sugar is gone and YAN started at ${i0(batch.yan_at_pick)} mg/L.`,
          'Make the second addition before the ferment is half done.');
      } else if (low && feeds < 2 && m.depletion >= RULES.nutrientCutoff) {
        add('info', 'nutrient-late', 'Past the nutrient window',
          `YAN started at ${i0(batch.yan_at_pick)} mg/L (need about ${need}) and ${feeds === 1 ? 'one feeding' : `${feeds} feedings`} went in. Past half-sugar, yeast can't use added nitrogen well.`,
          'Skip DAP now. If it slows, yeast hulls at about 25 g/hL help more.');
      }
    }
  }

  // ── Malolactic ───────────────────────────────────────────────────────
  if (batch.phase === 'mlf') {
    const since = batch.ml_inoculated_at;
    const temp = latest(readings.filter(r => !since || r.taken_at >= since), 'must_temp_f');
    if (temp && temp.must_temp_f < RULES.mlfMinTempF) {
      add('watch', 'mlf-cold', `Too cold for MLF at ${i0(temp.must_temp_f)} °F`,
        `ML bacteria slow sharply below ${RULES.mlfMinTempF} °F.`, 'Warm the wine to 64–72 °F.');
    }
    const malic = readings.filter(r => r.malic != null && (!since || r.taken_at >= since));
    const lastMalic = malic.at(-1);
    const spotGone = latest(readings, 'ml_chroma')?.ml_chroma === 'absent';
    if ((lastMalic && lastMalic.malic <= RULES.mlfDoneMalic) || spotGone) {
      add('info', 'mlf-done', 'MLF looks complete',
        lastMalic ? `Malic at ${f2(lastMalic.malic)} g/L on ${shortDate(lastMalic.taken_at)}.` : 'The malic spot is gone on the chromatography paper.',
        'Confirm with a lab or enzymatic test, then add SO₂ and move it to aging.');
    } else if (malic.length >= 2) {
      const days = (ms(lastMalic.taken_at) - ms(malic[0].taken_at)) / DAY;
      const drop = malic[0].malic - lastMalic.malic;
      if (days >= RULES.mlfStallDays && drop < RULES.mlfStallDrop) {
        add('watch', 'mlf-stall', `MLF stalled at ${f2(lastMalic.malic)} g/L malic`,
          `Down only ${f2(drop)} g/L in ${Math.round(days)} days.`,
          'Check temperature, free SO₂ (keep it under 10 ppm) and pH. Re-inoculate if it stays flat.');
      }
    }
    const so2DuringMlf = additions.filter(a => a.kind === 'so2' && since && a.added_at >= since);
    if (so2DuringMlf.length) {
      add('watch', 'mlf-so2', 'SO₂ added during MLF',
        `${so2DuringMlf.length} addition${so2DuringMlf.length > 1 ? 's' : ''} since inoculation on ${shortDate(since)}.`,
        'SO₂ inhibits ML bacteria. Hold additions until MLF is done.');
    }
  }

  // ── Aging ────────────────────────────────────────────────────────────
  if (batch.phase === 'aging') {
    const target = RULES.molecularSO2Target[color];
    if (m.freeSO2 == null) {
      add('watch', 'so2-none', 'No SO₂ reading on file', 'Aging wine needs a free SO₂ and pH check.', 'Run free SO₂ and pH.');
    } else {
      if (m.molecular != null && m.molecular < target) {
        const plan = so2Plan({ freeSO2: m.freeSO2, pH: m.ph, volumeL: batch.volume_l, targetMolecular: target });
        const dose = plan?.kmbsGrams != null ? ` Add about ${i0(plan.addPpm)} ppm, roughly ${f1(plan.kmbsGrams)} g KMBS for ${i0(batch.volume_l)} L.` : '';
        const highPh = m.ph > 3.7 && plan ? ` At pH ${f2(m.ph)} that takes ${i0(plan.needFree)} ppm free; a tartaric adjustment first may be kinder to the wine.` : '';
        add('act', 'so2-low', `Molecular SO₂ ${f2(m.molecular)} mg/L, target ${target}`,
          `Free SO₂ ${i0(m.freeSO2)} ppm at pH ${f2(m.ph)} on ${shortDate(m.so2At)}.${highPh}`,
          `Bring it up to ${target} mg/L.${dose}`);
      }
      const age = (nowMs - ms(m.so2At)) / DAY;
      if (age > RULES.so2CheckDays) {
        add('watch', 'so2-due', 'SO₂ check due', `Last free SO₂ was ${Math.round(age)} days ago.`,
          'Run free SO₂ and pH. Free SO₂ drifts down in barrel.');
      }
    }
  }

  // ── Spoilage (any phase before bottling) ─────────────────────────────
  if (batch.phase !== 'bottled') {
    if (m.va != null && m.va >= RULES.vaAct) {
      add('act', 'va', `VA at ${f2(m.va)} g/L`, 'Acetic spoilage is building.',
        'Top up, raise molecular SO₂, check for film or a weeping barrel, and get a lab read.');
    } else if (m.va != null && m.va >= RULES.vaWatch) {
      add('watch', 'va', `VA creeping up to ${f2(m.va)} g/L`, 'Most tasters notice it around 0.7–0.8 g/L.', 'Top up and re-test in two weeks.');
    }

    const cutoff = nowMs - 45 * DAY;
    const hits = journal
      .filter(j => ms(j.entry_date) >= cutoff)
      .map(j => ({ date: j.entry_date, words: RULES.brettWords.filter(w => j.body.toLowerCase().includes(w)) }))
      .filter(h => h.words.length);
    const target = RULES.molecularSO2Target[color];
    const riskyPh = m.ph != null && m.ph >= RULES.brettPh;
    const lowMol = m.molecular != null && m.molecular < target;
    if (hits.length) {
      const h = hits[0];
      const context = riskyPh ? ` pH ${f2(m.ph)}${lowMol ? ' and low molecular SO₂ make' : ' makes'} it an easy home for Brett.` : '';
      add('act', 'brett', 'Possible Brett in your notes',
        `You wrote ${h.words.map(w => `“${w}”`).join(' and ')} on ${shortDate(h.date)}.${context}`,
        'Send a sample for 4-EP/4-EG or a Brett PCR, isolate the barrel, and keep it topped.');
    } else if (batch.phase === 'aging' && color === 'red' && riskyPh && lowMol) {
      add('watch', 'brett-risk', 'Brett-friendly conditions', `pH ${f2(m.ph)} with ${f2(m.molecular)} mg/L molecular SO₂.`,
        'Raise molecular SO₂ and keep the cellar under 60 °F.');
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function analyze(loaded, nowMs = Date.now()) {
  const { batch, readings, priors = [] } = loaded;
  const metrics = computeMetrics(batch, readings, nowMs);
  const curve = afCurve(batch, readings);
  const priorCurves = priors
    .map(p => ({ batch: p.batch, curve: afCurve(p.batch, p.readings) }))
    .filter(p => p.curve.length);
  const comparison = compareToPrior(batch, curve, priorCurves);
  const alerts = computeAlerts(batch, loaded, metrics, comparison, nowMs);
  return {
    metrics,
    curve,
    priorCurves: priorCurves.map(p => ({ vintage: p.batch.vintage, batchId: p.batch.id, curve: p.curve })),
    comparison,
    alerts,
  };
}
