// Brain: answers questions about the cellar. Uses Claude when ANTHROPIC_API_KEY is set,
// otherwise answers from the built-in enology rules so the app works fully offline.
import Anthropic from '@anthropic-ai/sdk';
import { all, get, run } from './db.js';
import { analyzeBatch, cellarState } from './store.js';
import { batchName, f1, f2, i0, isFeeding, shortDate } from './analysis.js';
import { RULES } from '../shared/rules.js';
import { DRY_BRIX, potentialAlcohol, so2Plan, yanTarget } from '../shared/chemistry.js';

export const model = () => process.env.HB_MODEL || 'claude-sonnet-5';
export const engineName = () => (process.env.ANTHROPIC_API_KEY ? `claude:${model()}` : 'rules');

const SYSTEM = `You are Harvest Brain, the cellar assistant inside a winemaker's personal production journal.
Their records are below: batches, readings (Brix, temperatures, pH, TA, SO2, malic, VA), additions,
journal notes, decisions, earlier vintages from the same block, and alerts computed by rules.

How to answer:
- Lead with the answer in one or two sentences. They are reading on a phone in a cellar.
- Ground every claim in their records first, citing dates and numbers ("Sep 24: 9.8 °Bx, cap 91 °F").
- Then bring enology knowledge: doses, temperatures, timing windows, thresholds. Be specific.
- Give at most five short bullet actions. No preamble, no sign-off.
- Say plainly when data is missing and what to measure next. Never invent readings.
- Recommend lab confirmation for spoilage, MLF completion, and anything headed to bottle.
- Units: °Bx, °F, g/L, mg/L (ppm). Use **bold** sparingly and "- " for bullets.`;

const PHASE = { pre_harvest: 'pre-harvest', cold_soak: 'cold soak', af: 'primary fermentation', pressed: 'pressed', mlf: 'malolactic', aging: 'aging', bottled: 'bottled' };
const hhmm = s => s.slice(5, 16).replace('T', ' ');

// ── Context for Claude ─────────────────────────────────────────────────
function batchContext(x) {
  const { batch: b, metrics: m, readings, additions, decisions, journal, comparison: c, alerts, priorCurves } = x;
  const L = [];
  L.push(`BATCH #${b.id}: ${batchName(b)} (${b.color}) | ${[b.vineyard, b.block].filter(Boolean).join(', ')} | ${b.facility ?? 'facility n/a'} | ${b.vessel ?? ''}${b.volume_l ? ` (${i0(b.volume_l)} L)` : ''}`);
  L.push(`Phase: ${PHASE[b.phase]}.${b.inoculated_at ? ` Inoculated ${hhmm(b.inoculated_at)} with ${b.yeast ?? 'yeast n/a'}; day ${f1(m.afDay)}.` : ''}${b.whole_cluster_pct != null ? ` ${i0(b.whole_cluster_pct)}% whole cluster.` : ''}`);
  L.push(`At pick${b.harvest_date ? ` (${b.harvest_date})` : ''}: ${f1(b.brix_at_pick)} °Bx, pH ${f2(b.ph_at_pick)}, TA ${f1(b.ta_at_pick)} g/L, YAN ${i0(b.yan_at_pick)} mg/L (rule-of-thumb need ≈${yanTarget(b.brix_at_pick)}).`);
  L.push(`Now: ${f1(m.brix)} °Bx, ${f1(m.ratePerDay)} °Bx/day, must ${i0(m.mustF)} °F, cap ${i0(m.capF)} °F, sugar used ${m.depletion == null ? '—' : Math.round(m.depletion * 100) + '%'}, free SO2 ${i0(m.freeSO2)} @ pH ${f2(m.ph)} → molecular ${f2(m.molecular)} mg/L, malic ${f2(m.malic)} g/L, VA ${f2(m.va)} g/L.`);
  if (c) L.push(`Vs ${c.vintage} (same block) at day ${f1(c.day)}: ${f1(c.priorBrix)} °Bx then vs ${f1(c.brixNow)} now; ${Math.round(c.pctSlower)}% ${c.pctSlower >= 0 ? 'slower' : 'faster'}. Start Brix ${f1(c.startPrior)} then vs ${f1(c.startNow)} now.`);
  if (alerts.length) L.push(`ALERTS:\n${alerts.map(a => `- [${a.severity}] ${a.title}: ${a.detail} → ${a.action}`).join('\n')}`);
  const rows = readings.slice(-40).map(r =>
    [hhmm(r.taken_at), r.brix, r.must_temp_f, r.cap_temp_f, r.ph, r.ta, r.free_so2, r.total_so2, r.malic, r.ml_chroma, r.va, r.note]
      .map(v => (v == null ? '-' : v)).join(' | '));
  if (rows.length) L.push(`READINGS (time | °Bx | must °F | cap °F | pH | TA | free SO2 | total SO2 | malic | chroma | VA | note):\n${rows.join('\n')}`);
  if (additions.length) L.push(`ADDITIONS:\n${additions.map(a => `- ${hhmm(a.added_at)} ${a.kind}: ${a.product ?? ''} ${a.amount ?? ''}${a.unit ?? ''}${a.so2_ppm ? ` (${a.so2_ppm} ppm)` : ''}${a.reason ? `, ${a.reason}` : ''}${a.note ? `, ${a.note}` : ''}`).join('\n')}`);
  if (decisions.length) L.push(`DECISIONS:\n${decisions.slice(0, 10).map(d => `- ${hhmm(d.decided_at)}: ${d.decision}${d.rationale ? ` (why: ${d.rationale})` : ''}`).join('\n')}`);
  if (journal.length) L.push(`JOURNAL (newest first):\n${journal.slice(0, 10).map(j => `- ${j.entry_date}${j.weather ? ` [${j.weather}]` : ''}: ${j.body}`).join('\n')}`);
  for (const p of priorCurves) {
    const pts = p.curve.filter(pt => pt.day >= -0.5).filter((_, i) => i % 2 === 0).slice(0, 16)
      .map(pt => `d${f1(pt.day)}:${f1(pt.brix)}${pt.cap != null ? `/${pt.cap}°F cap` : ''}`);
    const pb = get('SELECT * FROM batches WHERE id = ?', p.batchId);
    L.push(`PRIOR VINTAGE ${p.vintage} same block: YAN at pick ${i0(pb?.yan_at_pick)}, start ${f1(pb?.brix_at_pick)} °Bx, ${pb?.whole_cluster_pct != null ? `${i0(pb.whole_cluster_pct)}% whole cluster, ` : ''}yeast ${pb?.yeast ?? 'n/a'}. Curve: ${pts.join(', ')}`);
  }
  return L.join('\n');
}

export function buildContext(batchId) {
  const state = cellarState();
  const lines = [`TODAY: ${state.today.label}, ${state.today.date}. Vintage ${state.today.vintage}${state.today.harvestDay ? `, harvest day ${state.today.harvestDay}` : ''}.`];
  const focus = batchId ? analyzeBatch(batchId) : null;
  if (focus) lines.push(batchContext(focus));
  const others = state.batches.filter(b => b.id !== batchId && b.phase !== 'bottled');
  if (others.length) {
    lines.push(`${focus ? 'OTHER' : 'ALL'} ACTIVE BATCHES:\n${others.map(b =>
      `- #${b.id} ${b.name} (${b.sub}), ${PHASE[b.phase]}: ${f1(b.metrics.brix)} °Bx, ${f1(b.metrics.ratePerDay)} °Bx/day, molecular SO2 ${f2(b.metrics.molecular)}, malic ${f2(b.metrics.malic)}, ${b.alertCount} alert(s)`).join('\n')}`);
  }
  if (!focus && state.alerts.length) lines.push(`CELLAR ALERTS:\n${state.alerts.map(a => `- [${a.severity}] ${a.batchName}: ${a.title}. ${a.detail}`).join('\n')}`);
  return { text: lines.join('\n\n'), focus, state };
}

// ── Claude ─────────────────────────────────────────────────────────────
// Only the key in .env turns Claude on: nothing leaves the machine unless you opt in.
// The SDK retries rate limits, overloads and dropped connections before Brain falls back to the rules.
let client;
const claude = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 }));

async function callClaude(records, messages) {
  const res = await claude().messages.create({
    model: model(),
    // Thinking counts against this cap, so leave room; the prompt keeps the visible answer short.
    max_tokens: 16000,
    system: [
      { type: 'text', text: SYSTEM },
      // The records only change when something is logged, so follow-up questions read them from cache.
      { type: 'text', text: `<cellar_records>\n${records}\n</cellar_records>`, cache_control: { type: 'ephemeral' } },
    ],
    messages,
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to answer this one');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error('Claude sent back an empty answer');
  return res.stop_reason === 'max_tokens' ? `${text}\n\n(Cut off at the length limit. Ask a narrower question for the rest.)` : text;
}

const claudeFailure = err =>
  err instanceof Anthropic.APIError && err.status ? err.error?.error?.message ?? `Claude API returned ${err.status}` : err.message;

/** Last few turns of the thread, merged so roles strictly alternate and it starts with the user. */
function history(batchId) {
  const rows = all('SELECT role, content FROM brain_messages WHERE batch_id IS ? ORDER BY id DESC LIMIT 12', batchId).reverse();
  const merged = [];
  for (const r of rows) {
    if (merged.at(-1)?.role === r.role) merged.at(-1).content += `\n\n${r.content}`;
    else merged.push({ role: r.role, content: r.content });
  }
  while (merged[0]?.role === 'assistant') merged.shift();
  return merged;
}

export async function respond({ batchId = null, message }) {
  run('INSERT INTO brain_messages (batch_id, role, content) VALUES (?, ?, ?)', batchId, 'user', message);
  const ctx = buildContext(batchId);
  let content;
  let engine = 'rules';
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      content = await callClaude(ctx.text, history(batchId));
      engine = `claude:${model()}`;
    } catch (err) {
      content = `${offlineAnswer(message, ctx)}\n\n(Claude was unavailable: ${claudeFailure(err).replace(/\.+$/, '')}. Answered from the built-in rules.)`;
    }
  } else {
    content = offlineAnswer(message, ctx);
  }
  const info = run('INSERT INTO brain_messages (batch_id, role, content, engine) VALUES (?, ?, ?, ?)', batchId, 'assistant', content, engine);
  return get('SELECT * FROM brain_messages WHERE id = ?', Number(info.lastInsertRowid));
}

// ── Offline answers from the rules engine ──────────────────────────────
const bullets = items => items.filter(Boolean).map(s => `- ${s}`).join('\n');

export function offlineAnswer(question, ctx) {
  const q = question.toLowerCase();
  const x = ctx.focus;
  if (!x) return cellarAnswer(ctx.state);
  if (/compar|last (year|vintage)|previous|prior|vs\.?\b|versus|\b(19|20)\d\d\b|behind|ahead/.test(q)) return compareAnswer(x);
  if (/stuck|slow|sluggish|stall|stopp|not moving|restart/.test(q)) return stuckAnswer(x);
  if (/so2|so₂|sulf|sulph|kmbs|meta|molecular/.test(q)) return so2Answer(x);
  if (/nutri|yan|fermaid|dap|go-?ferm|feed|nitrogen/.test(q)) return nutrientAnswer(x);
  if (/mlf|malo|malic|\bml\b|chromatog/.test(q)) return mlfAnswer(x);
  if (/brett|barnyard|band-?aid|spoil|mousy|\bva\b|volatile|acetic/.test(q)) return spoilageAnswer(x);
  if (/press|drain|when.*dry|dryness/.test(q)) return pressAnswer(x);
  return statusAnswer(x);
}

function alertLines(x, limit = 4) {
  return x.alerts.slice(0, limit).map(a => `**${a.title}.** ${a.action}`);
}

function statusAnswer(x) {
  const { batch: b, metrics: m } = x;
  let head;
  if (b.phase === 'af') {
    head = `**${batchName(b)}** is on day ${f1(m.afDay)} of primary at ${f1(m.brix)} °Bx, dropping ${f1(m.ratePerDay)} °Bx/day${m.daysToDry ? `, about ${f1(m.daysToDry)} days from dry at this pace` : ''}.`;
  } else if (b.phase === 'mlf') {
    head = `**${batchName(b)}** is in malolactic with ${b.ml_strain ?? 'bacteria'} since ${b.ml_inoculated_at ? shortDate(b.ml_inoculated_at) : 'n/a'}; malic is ${f2(m.malic)} g/L${m.malicAt ? ` (${shortDate(m.malicAt)})` : ''}.`;
  } else if (b.phase === 'aging') {
    head = `**${batchName(b)}** is aging. Last free SO₂ ${i0(m.freeSO2)} ppm at pH ${f2(m.ph)} gives ${f2(m.molecular)} mg/L molecular${m.va != null ? `; VA ${f2(m.va)} g/L` : ''}.`;
  } else {
    head = `**${batchName(b)}** is ${PHASE[b.phase]}.`;
  }
  const lines = alertLines(x);
  return `${head}\n\n${lines.length ? `What needs you:\n${bullets(lines)}` : 'Nothing is flagged. Keep logging so the curve stays honest.'}`;
}

function compareAnswer(x) {
  const { batch: b, metrics: m, comparison: c } = x;
  if (!c) {
    return x.priorCurves.length
      ? `There's an earlier vintage of this block on file, but not enough overlapping readings to compare yet. Log a Brix reading today and ask again.`
      : `No earlier vintage of this block is on file. Give future batches the same lineage ("${b.lineage ?? 'block-varietal'}") and next year you'll get a day-by-day comparison.`;
  }
  const prior = get('SELECT * FROM batches WHERE id = ?', c.batchId);
  const priorLoaded = analyzeBatch(c.batchId);
  const priorMaxCap = Math.max(...priorLoaded.readings.filter(r => r.cap_temp_f != null).map(r => r.cap_temp_f), -Infinity);
  const curMaxCap = Math.max(...x.readings.filter(r => r.cap_temp_f != null).map(r => r.cap_temp_f), -Infinity);
  const priorFeeds = priorLoaded.additions.filter(isFeeding).length;
  const curFeeds = x.additions.filter(isFeeding).length;
  const slower = c.pctSlower >= 0;
  const diffs = [];
  if (b.yan_at_pick != null && prior?.yan_at_pick != null && Math.abs(b.yan_at_pick - prior.yan_at_pick) >= 15)
    diffs.push(`YAN at pick ${i0(b.yan_at_pick)} mg/L vs ${i0(prior.yan_at_pick)} in ${c.vintage}`);
  if (Math.abs(c.startNow - c.startPrior) >= 0.4) diffs.push(`Starting sugar ${f1(c.startNow)} °Bx vs ${f1(c.startPrior)}`);
  if (curFeeds !== priorFeeds) diffs.push(`${curFeeds} nutrient feeding${curFeeds === 1 ? '' : 's'} vs ${priorFeeds}`);
  if (Number.isFinite(curMaxCap) && Number.isFinite(priorMaxCap) && Math.abs(curMaxCap - priorMaxCap) >= 3)
    diffs.push(`Cap peaked at ${i0(curMaxCap)} °F vs ${i0(priorMaxCap)} °F`);
  if (b.whole_cluster_pct != null && prior?.whole_cluster_pct != null && b.whole_cluster_pct !== prior.whole_cluster_pct)
    diffs.push(`${i0(b.whole_cluster_pct)}% whole cluster vs ${i0(prior.whole_cluster_pct)}%`);
  if (b.yeast && prior?.yeast && b.yeast !== prior.yeast) diffs.push(`Yeast ${b.yeast} vs ${prior.yeast}`);

  const actions = slower
    ? [
        m.depletion != null && m.depletion < RULES.nutrientCutoff ? 'Nutrition is the likeliest lever and you are still inside the window: add a complex nutrient now.' : 'Past half-sugar, skip DAP; yeast hulls (about 25 g/hL) help a tiring ferment more.',
        m.capF != null && m.capF >= RULES.capTempWatchF ? `Cap at ${i0(m.capF)} °F is stressing the yeast. Punch down more and pull heat out of the must.` : 'Keep the must in the upper 70s to low 80s °F to keep yeast working.',
        'Log Brix twice a day until it is back on pace. If the drop falls under 1 °Bx/day, ask me about a restart plan.',
      ]
    : ['Faster ferments run hot. Watch cap temperature and keep the must under 85 °F.', 'Plan press timing earlier than last year if you press near dryness.'];
  return `At day ${f1(c.day)} you're at **${f1(c.brixNow)} °Bx**. The ${c.vintage} lot from this block was at **${f1(c.priorBrix)} °Bx**, so you're **${Math.round(Math.abs(c.pctSlower))}% ${slower ? 'behind' : 'ahead of'}** its pace.\n\n${diffs.length ? `What's different in your records:\n${bullets(diffs)}\n\n` : ''}${slower ? 'Worth doing' : 'Keep in mind'}:\n${bullets(actions)}`;
}

function stuckAnswer(x) {
  const { batch: b, metrics: m } = x;
  if (b.phase !== 'af') return `${batchName(b)} isn't in primary, so a stuck ferment isn't the question. ${statusAnswer(x)}`;
  const sluggish = RULES.sluggishBrixPerDay[b.color];
  const verdict = m.ratePerDay == null
    ? 'Not enough readings to judge the rate yet. Log Brix twice a day.'
    : m.ratePerDay < RULES.stuckBrixPerDay ? `This looks **stuck**: ${f1(m.ratePerDay)} °Bx/day at ${f1(m.brix)} °Bx.`
    : m.ratePerDay < sluggish ? `This is **sluggish, not stuck**: ${f1(m.ratePerDay)} °Bx/day at ${f1(m.brix)} °Bx.`
    : `It's **moving fine** at ${f1(m.ratePerDay)} °Bx/day (${f1(m.brix)} °Bx).`;
  if (m.ratePerDay != null && m.ratePerDay >= sluggish) {
    const watch = x.alerts.filter(a => a.kind === 'vs-prior' || a.kind === 'cap-temp').map(a => `**${a.title}.** ${a.action}`);
    return `${verdict} No restart needed.${watch.length ? `\n\nWhat to watch instead:\n${bullets(watch)}` : ''}`;
  }
  const alcohol = m.startBrix != null && m.brix != null ? potentialAlcohol(m.startBrix - m.brix) : null;
  const steps = [
    `Temperature: must is ${i0(m.mustF)} °F. ${b.color === 'red' ? 'Reds want roughly 75–85 °F; warm it if it sits under 70 °F.' : 'Whites want roughly 58–65 °F; warm it a few degrees if it sits under 55 °F.'}`,
    m.depletion != null && m.depletion < RULES.nutrientCutoff
      ? 'Nutrition: still under half-sugar, so a complex nutrient addition can help now.'
      : 'Nutrition: past half-sugar, skip DAP. Add yeast hulls (about 25 g/hL) to soak up toxic fatty acids.',
    'Mix and aerate: a pump-over with air, or rack and return, gets settled yeast back to work.',
    `If it drops under ${RULES.stuckBrixPerDay} °Bx/day for 48 hours: build an acclimated restart culture (EC-1118-type yeast, stepped up in stages) and keep free SO₂ low.`,
    `Before a restart, measure residual sugar, VA and alcohol. You've made roughly ${f1(alcohol)}% alcohol so far.`,
  ];
  return `${verdict}\n\n${bullets(steps)}`;
}

function so2Answer(x) {
  const { batch: b, metrics: m } = x;
  const target = RULES.molecularSO2Target[b.color];
  if (b.phase === 'mlf') return `Hold SO₂ while ${batchName(b)} is in malolactic: it inhibits the bacteria. Add it once malic is under ${RULES.mlfDoneMalic} g/L and confirmed.`;
  if (m.freeSO2 == null || m.ph == null) return `No free SO₂ and pH reading on file for ${batchName(b)}. Run both, log them, and I'll calculate the addition to reach ${target} mg/L molecular.`;
  const plan = so2Plan({ freeSO2: m.freeSO2, pH: m.ph, volumeL: b.volume_l, targetMolecular: target });
  const head = `Free SO₂ ${i0(m.freeSO2)} ppm at pH ${f2(m.ph)} (${shortDate(m.so2At)}) is **${f2(m.molecular)} mg/L molecular**. Target for a ${b.color === 'rose' ? 'rosé' : b.color} is ${target}.`;
  if (plan.addPpm < 1) return `${head}\n\nYou're covered. Re-check in ${RULES.so2CheckDays} days; free SO₂ drifts down in barrel.`;
  const items = [
    `Reach ${i0(plan.needFree)} ppm free: add about **${i0(plan.addPpm)} ppm**${plan.kmbsGrams != null ? `, roughly **${f1(plan.kmbsGrams)} g KMBS** for ${i0(b.volume_l)} L` : ''}.`,
    m.ph > 3.7 ? `At pH ${f2(m.ph)} that much free SO₂ gets harsh. A tartaric adjustment first lowers what you need.` : null,
    'Dissolve the KMBS in a little wine or water and mix it in well.',
    'Some of it will bind, more so in reds. Re-test free SO₂ 24 hours later.',
  ];
  return `${head}\n\n${bullets(items)}`;
}

function nutrientAnswer(x) {
  const { batch: b, metrics: m, additions } = x;
  const need = yanTarget(m.startBrix ?? b.brix_at_pick);
  const feeds = additions.filter(isFeeding);
  const d = m.depletion;
  const head = b.yan_at_pick != null
    ? `YAN at pick was **${i0(b.yan_at_pick)} mg/L** against a rule-of-thumb need of about **${need} mg/L** at ${f1(m.startBrix ?? b.brix_at_pick)} °Bx.`
    : `No YAN on file. At ${f1(m.startBrix ?? b.brix_at_pick)} °Bx, plan on roughly ${need} mg/L; get a YAN test at the next pick.`;
  const done = feeds.length ? `Feedings so far: ${feeds.map(a => `${a.product ?? 'nutrient'} on ${shortDate(a.added_at)}`).join(', ')}.` : 'No complex nutrient additions yet.';
  const window = d == null ? 'Log a Brix reading to place the ferment in its nutrient window.'
    : d < RULES.nutrientSecondAt ? `${Math.round(d * 100)}% of the sugar is used. Now is the time for a complex nutrient if you haven't added one.`
    : d < RULES.nutrientCutoff ? `${Math.round(d * 100)}% of the sugar is used: the second-addition window. Add it before half-sugar.`
    : `${Math.round(d * 100)}% of the sugar is used, past the window. Skip DAP; yeast hulls help more if it slows.`;
  return `${head}\n\n${bullets([done, window, 'Rehydration nutrients (Go-Ferm) at inoculation support the yeast but do not count toward YAN.'])}`;
}

function mlfAnswer(x) {
  const { batch: b, metrics: m, readings } = x;
  const since = b.ml_inoculated_at;
  const series = readings.filter(r => r.malic != null && (!since || r.taken_at >= since)).map(r => `${shortDate(r.taken_at)}: ${f2(r.malic)}`);
  const head = b.phase === 'mlf'
    ? `Malolactic with ${b.ml_strain ?? 'bacteria'} since ${since ? shortDate(since) : 'n/a'}. Malic is **${f2(m.malic)} g/L**.`
    : b.ml_completed_at ? `MLF finished on ${shortDate(b.ml_completed_at)}.` : `${batchName(b)} hasn't started malolactic.`;
  return `${head}${series.length ? `\n\nMalic (g/L): ${series.join(' → ')}` : ''}\n\n${bullets([
    `Conditions ML bacteria like: ${RULES.mlfMinTempF}–72 °F, free SO₂ under 10 ppm, pH above 3.2. Wine temperature now: ${i0(m.mustF)} °F.`,
    `It's done when malic is under ${RULES.mlfDoneMalic} g/L. Confirm with a lab or enzymatic test; paper chromatography is a good first look.`,
    'Once confirmed, add SO₂ promptly and move it to aging.',
  ])}`;
}

function spoilageAnswer(x) {
  const { batch: b, metrics: m } = x;
  const brett = x.alerts.find(a => a.kind === 'brett' || a.kind === 'brett-risk');
  const target = RULES.molecularSO2Target[b.color];
  return `${brett ? `**${brett.title}.** ${brett.detail}` : 'No spoilage markers in your notes for this batch.'}\n\n${bullets([
    `Molecular SO₂ is ${f2(m.molecular)} mg/L (target ${target}) at pH ${f2(m.ph)}.${m.molecular != null && m.molecular < target ? ' Raise it: that is your main defense.' : ''}`,
    m.va != null ? `VA is ${f2(m.va)} g/L. Watch above ${RULES.vaWatch}; act above ${RULES.vaAct}.` : 'No VA on file. Run one with the next panel.',
    'Confirm Brett with a 4-EP/4-EG panel or PCR before treating. Tasting alone misleads.',
    'Keep barrels topped, the cellar under 60 °F, and sanitize any hoses and tools that touched the suspect barrel.',
  ])}`;
}

function pressAnswer(x) {
  const { batch: b, metrics: m } = x;
  if (b.phase !== 'af') return statusAnswer(x);
  if (b.color !== 'red') return `${batchName(b)} is a ${b.color}; it was pressed before fermentation. At ${f1(m.ratePerDay)} °Bx/day it's about ${f1(m.daysToDry)} days from dry.`;
  return `At ${f1(m.brix)} °Bx and ${f1(m.ratePerDay)} °Bx/day, ${batchName(b)} is about **${f1(m.daysToDry)} days from dry** (${String(DRY_BRIX).replace('-', '−')} °Bx).\n\n${bullets([
    'Pressing at or just before dryness (0 to −1 °Bx) is the common default; press earlier for softer tannins, or hold on skins for extended maceration if the tannins are fine.',
    'Taste twice a day as it approaches dry. Tannin texture should decide, not the calendar.',
    'Log the press date and fractions (free run vs press) as a note so next vintage has the reference.',
  ])}`;
}

function cellarAnswer(state) {
  const active = state.batches.filter(b => b.phase !== 'bottled');
  const counts = Object.entries(active.reduce((acc, b) => ({ ...acc, [PHASE[b.phase]]: (acc[PHASE[b.phase]] ?? 0) + 1 }), {}))
    .map(([k, v]) => `${v} ${k}`).join(', ');
  const top = state.alerts.slice(0, 5).map(a => `**${a.batchName}**: ${a.title}. ${a.action}`);
  return `${state.today.label}${state.today.harvestDay ? `, harvest day ${state.today.harvestDay}` : ''}. ${active.length} active batch${active.length === 1 ? '' : 'es'}${counts ? `: ${counts}` : ''}.\n\n${top.length ? `In priority order:\n${bullets(top)}` : 'Nothing flagged across the cellar.'}\n\nPick a batch above to ask about it specifically.`;
}
