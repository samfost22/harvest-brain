// JSON API over node:http. Every route is local; nothing leaves the machine except Brain calls to Claude.
import { all, get, run, tx } from './db.js';
import { analyzeBatch, cellarState } from './store.js';
import { batchName } from './analysis.js';
import { engineName, respond } from './brain.js';
import { RULES } from '../shared/rules.js';
import { lineageSlug } from '../shared/curve.js';
import { localDate, localStamp, parseStamp } from '../shared/time.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
};

const MAX_BODY = 1024 * 1024;

async function body(req) {
  // Requiring JSON forces a CORS preflight for cross-site requests, which this server never approves,
  // so a web page you happen to visit can't post into your cellar with a plain form or text body.
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Send the request body as JSON with content-type: application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body is over 1 MB');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

const num = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  return n;
};
const text = v => (v == null || String(v).trim() === '' ? null : String(v).trim());
const parsed = (v, field) => {
  const p = parseStamp(v);
  if (!p) throw new HttpError(400, `${field} must be a real date, as YYYY-MM-DD or YYYY-MM-DDTHH:MM`);
  return p;
};
/** Reading and addition times: 'YYYY-MM-DDTHH:MM', now when blank, noon when only a date is given. */
const stamp = (v, field = 'Time') => {
  if (!text(v)) return localStamp();
  const p = parsed(v, field);
  return `${p.date}T${p.time ?? '12:00'}`;
};
/** A calendar day, 'YYYY-MM-DD'. */
const day = (v, field = 'Date') => (text(v) ? parsed(v, field).date : null);
/** Batch milestones keep whatever precision was given: a day, or a day and time. */
const moment = (v, field) => {
  if (!text(v)) return null;
  const p = parsed(v, field);
  return p.time ? `${p.date}T${p.time}` : p.date;
};
/** An optional batch reference: null when blank, 404 when it names no batch. */
const batchRef = v => {
  if (v == null || v === '') return null;
  const id = Number(v);
  if (!Number.isInteger(id) || !get('SELECT id FROM batches WHERE id = ?', id)) throw new HttpError(404, 'Batch not found');
  return id;
};

const READING_FIELDS = ['brix', 'must_temp_f', 'cap_temp_f', 'ph', 'ta', 'free_so2', 'total_so2', 'malic', 'yan', 'va'];
const ADDITION_KINDS = ['so2', 'nutrient', 'yeast', 'ml_bacteria', 'acid', 'tannin', 'enzyme', 'water', 'other'];
const PHASES = ['pre_harvest', 'cold_soak', 'af', 'pressed', 'mlf', 'aging', 'bottled'];
const BATCH_TEXT = ['varietal', 'vineyard', 'block', 'lineage', 'facility', 'vessel', 'yeast', 'ml_strain', 'notes'];
const BATCH_MOMENTS = ['harvest_date', 'inoculated_at', 'pressed_at', 'ml_inoculated_at', 'ml_completed_at', 'bottled_at'];
const BATCH_NUM = ['vintage', 'volume_l', 'tons', 'brix_at_pick', 'ph_at_pick', 'ta_at_pick', 'yan_at_pick', 'whole_cluster_pct'];

function batchFields(input, { partial }) {
  const out = {};
  for (const f of BATCH_TEXT) if (f in input) out[f] = text(input[f]);
  for (const f of BATCH_MOMENTS) if (f in input) out[f] = moment(input[f], f);
  for (const f of BATCH_NUM) if (f in input) out[f] = num(input[f], f);
  if ('vintage' in out && !(Number.isInteger(out.vintage) && out.vintage >= 1900 && out.vintage <= 2999)) {
    throw new HttpError(400, 'vintage must be a year, like 2026');
  }
  if ('varietal' in out && !out.varietal) throw new HttpError(400, 'varietal is required');
  if ('color' in input) {
    if (!['red', 'white', 'rose'].includes(input.color)) throw new HttpError(400, 'color must be red, white, or rose');
    out.color = input.color;
  }
  if ('phase' in input) {
    if (!PHASES.includes(input.phase)) throw new HttpError(400, `phase must be one of ${PHASES.join(', ')}`);
    out.phase = input.phase;
  }
  if ('archived' in input) out.archived = input.archived ? 1 : 0;
  if (!partial) {
    if (!out.vintage) throw new HttpError(400, 'vintage is required');
    if (!out.varietal) throw new HttpError(400, 'varietal is required');
    out.color ??= 'red';
    out.phase ??= 'af';
    out.lineage ??= lineageSlug(out.vineyard, out.block, out.varietal) || null;
  }
  return out;
}

function detail(id) {
  const x = analyzeBatch(id);
  if (!x) throw new HttpError(404, 'Batch not found');
  const priors = x.priors.map(p => ({ id: p.batch.id, name: batchName(p.batch), vintage: p.batch.vintage, yan_at_pick: p.batch.yan_at_pick, brix_at_pick: p.batch.brix_at_pick }));
  return { ...x, priors };
}

// ── Routes ─────────────────────────────────────────────────────────────
const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true, engine: engineName(), today: localDate() })],

  ['GET', /^\/api\/state$/, () => ({ ...cellarState(), engine: engineName() })],

  ['GET', /^\/api\/batches\/(\d+)$/, (_req, [id]) => detail(Number(id))],

  ['POST', /^\/api\/batches$/, async req => {
    const b = batchFields(await body(req), { partial: false });
    const cols = Object.keys(b);
    const info = run(`INSERT INTO batches (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map(c => b[c]));
    return detail(Number(info.lastInsertRowid));
  }],

  ['PATCH', /^\/api\/batches\/(\d+)$/, async (req, [idStr]) => {
    const id = Number(idStr);
    const current = get('SELECT * FROM batches WHERE id = ?', id);
    if (!current) throw new HttpError(404, 'Batch not found');
    const patch = batchFields(await body(req), { partial: true });
    // Stamp the phase-change dates the first time a batch reaches a phase.
    if (patch.phase === 'pressed' && !current.pressed_at) patch.pressed_at = localStamp();
    if (patch.phase === 'aging' && current.phase === 'mlf' && !current.ml_completed_at) patch.ml_completed_at = localDate();
    if (patch.phase === 'bottled' && !current.bottled_at) patch.bottled_at = localDate();
    const cols = Object.keys(patch);
    if (cols.length) run(`UPDATE batches SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map(c => patch[c]), id);
    return detail(id);
  }],

  // One save from the Log screen: a reading, any additions, and a note.
  ['POST', /^\/api\/entries$/, async req => {
    const input = await body(req);
    const batchId = batchRef(input.batchId);
    if (batchId == null) throw new HttpError(400, 'Pick a batch first.');
    const batch = get('SELECT * FROM batches WHERE id = ?', batchId);
    const takenAt = stamp(input.takenAt, 'takenAt');
    const reading = Object.fromEntries(READING_FIELDS.map(f => [f, num(input.reading?.[f], f)]));
    const chroma = ['present', 'faint', 'absent'].includes(input.reading?.ml_chroma) ? input.reading.ml_chroma : null;
    const note = text(input.note);
    const additions = (input.additions ?? []).filter(a => a && a.kind);
    for (const a of additions) if (!ADDITION_KINDS.includes(a.kind)) throw new HttpError(400, `Unknown addition kind: ${a.kind}`);
    const hasReading = READING_FIELDS.some(f => reading[f] != null) || chroma || note;
    if (!hasReading && !additions.length) throw new HttpError(400, 'Nothing to save: add a reading, an addition, or a note.');

    tx(() => {
      if (hasReading) {
        run(`INSERT INTO readings (batch_id, taken_at, ${READING_FIELDS.join(', ')}, ml_chroma, note, source)
             VALUES (?, ?, ${READING_FIELDS.map(() => '?').join(', ')}, ?, ?, ?)`,
          batchId, takenAt, ...READING_FIELDS.map(f => reading[f]), chroma, note, text(input.source) ?? 'manual');
      }
      for (const a of additions) {
        run(`INSERT INTO additions (batch_id, added_at, kind, product, amount, unit, so2_ppm, reason, ph_at_add, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          batchId, takenAt, a.kind, text(a.product), num(a.amount, 'amount'), text(a.unit), num(a.so2_ppm, 'so2_ppm'),
          text(a.reason), num(a.ph_at_add, 'ph_at_add') ?? reading.ph, text(a.note));
        if (a.kind === 'yeast' && !batch.inoculated_at) {
          run('UPDATE batches SET inoculated_at = ?, yeast = COALESCE(yeast, ?), phase = CASE WHEN phase IN (\'pre_harvest\', \'cold_soak\') THEN \'af\' ELSE phase END WHERE id = ?', takenAt, text(a.product), batchId);
        }
        if (a.kind === 'ml_bacteria' && !batch.ml_inoculated_at) {
          // Bacteria added while there's still sugar is co-inoculation: keep the primary alerts running.
          // Read the phase fresh: a yeast addition earlier in this same entry may have just moved it to primary.
          const { phase } = get('SELECT phase FROM batches WHERE id = ?', batchId);
          const brix = get('SELECT brix FROM readings WHERE batch_id = ? AND brix IS NOT NULL ORDER BY taken_at DESC, id DESC LIMIT 1', batchId)?.brix;
          const coInoculated = ['cold_soak', 'af'].includes(phase) && (brix == null || brix > RULES.coInoculationBrix);
          run('UPDATE batches SET ml_inoculated_at = ?, ml_strain = COALESCE(ml_strain, ?), phase = ? WHERE id = ?',
            takenAt, text(a.product), coInoculated ? phase : 'mlf', batchId);
        }
      }
    });
    const x = analyzeBatch(batchId);
    return { ok: true, alerts: x.alerts, metrics: x.metrics };
  }],

  ['GET', /^\/api\/journal$/, (_req, _m, url) => {
    const date = day(url.searchParams.get('date'), 'date') ?? localDate();
    const withName = r => ({ ...r, batch_name: r.vintage ? `${r.vintage} ${r.varietal}` : null });
    return {
      date,
      entries: all(`SELECT j.*, b.vintage, b.varietal FROM journal j LEFT JOIN batches b ON b.id = j.batch_id
                    WHERE j.entry_date = ? ORDER BY j.id DESC`, date).map(withName),
      readings: all(`SELECT r.*, b.vintage, b.varietal FROM readings r JOIN batches b ON b.id = r.batch_id
                     WHERE substr(r.taken_at, 1, 10) = ? ORDER BY r.taken_at`, date).map(withName),
      recent: all(`SELECT j.*, b.vintage, b.varietal FROM journal j LEFT JOIN batches b ON b.id = j.batch_id
                   WHERE j.entry_date <> ? ORDER BY j.entry_date DESC, j.id DESC LIMIT 20`, date).map(withName),
    };
  }],

  ['POST', /^\/api\/journal$/, async req => {
    const input = await body(req);
    const bodyText = text(input.body);
    if (!bodyText) throw new HttpError(400, 'Write something first.');
    const info = run('INSERT INTO journal (entry_date, batch_id, body, weather) VALUES (?, ?, ?, ?)',
      day(input.entryDate, 'entryDate') ?? localDate(), batchRef(input.batchId), bodyText,
      Array.isArray(input.weather) ? input.weather.join(',') : text(input.weather));
    return get('SELECT * FROM journal WHERE id = ?', Number(info.lastInsertRowid));
  }],

  ['GET', /^\/api\/brain$/, (_req, _m, url) => {
    const batchId = batchRef(url.searchParams.get('batchId'));
    return { engine: engineName(), messages: all('SELECT * FROM brain_messages WHERE batch_id IS ? ORDER BY id', batchId) };
  }],

  ['POST', /^\/api\/brain$/, async req => {
    const input = await body(req);
    const message = text(input.message);
    if (!message) throw new HttpError(400, 'Ask a question first.');
    return { message: await respond({ batchId: batchRef(input.batchId), message }) };
  }],

  ['POST', /^\/api\/decisions$/, async req => {
    const input = await body(req);
    const decision = text(input.decision);
    if (!decision) throw new HttpError(400, 'A decision needs some text.');
    const info = run('INSERT INTO decisions (batch_id, decided_at, decision, rationale, source) VALUES (?, ?, ?, ?, ?)',
      batchRef(input.batchId), localStamp(), decision, text(input.rationale), text(input.source) ?? 'manual');
    return get('SELECT * FROM decisions WHERE id = ?', Number(info.lastInsertRowid));
  }],

  // Your data, portable: one JSON file with everything.
  ['GET', /^\/api\/export$/, () => ({
    exported_at: new Date().toISOString(),
    app: 'harvest-brain',
    batches: all('SELECT * FROM batches ORDER BY id'),
    readings: all('SELECT * FROM readings ORDER BY id'),
    additions: all('SELECT * FROM additions ORDER BY id'),
    journal: all('SELECT * FROM journal ORDER BY id'),
    decisions: all('SELECT * FROM decisions ORDER BY id'),
    brain_messages: all('SELECT * FROM brain_messages ORDER BY id'),
  }), () => ({ 'content-disposition': `attachment; filename="harvest-brain-export-${localDate()}.json"` })],
];

// The API has no login. Answer only requests addressed to this machine by IP address or a local name,
// so a page on some other domain can't reach it by pointing that domain at 127.0.0.1 (DNS rebinding).
// Add other names you use, such as a Tailscale host, to HB_ALLOWED_HOSTS (comma-separated).
const LOCAL_HOST = /^(localhost|[a-z0-9-]+\.(localhost|local)|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

export function allowedHost(host) {
  if (!host) return true; // HTTP/1.0 clients; browsers always send Host
  const name = host.toLowerCase().replace(/:\d+$/, '');
  const extra = (process.env.HB_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  return LOCAL_HOST.test(name) || extra.includes(name);
}

// SQLite constraint failures (a missing required field, a bad reference) are the caller's mistake, not a crash.
const isConstraintError = err => err?.code === 'ERR_SQLITE_ERROR' && (err.errcode & 0xff) === 19;

export async function handleApi(req, res) {
  try {
    if (!allowedHost(req.headers.host)) {
      throw new HttpError(403, `Harvest Brain doesn't answer to ${req.headers.host}. Add it to HB_ALLOWED_HOSTS if it's yours.`);
    }
    const url = new URL(req.url, 'http://localhost');
    let pathMatched = false;
    for (const [method, pattern, handler, headers] of routes) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      pathMatched = true;
      if (req.method !== method) continue;
      const data = await handler(req, match.slice(1), url);
      return send(res, 200, data, typeof headers === 'function' ? headers() : headers);
    }
    throw new HttpError(pathMatched ? 405 : 404, `No route for ${req.method} ${url.pathname}`);
  } catch (err) {
    const status = err.status ?? (isConstraintError(err) ? 400 : 500);
    if (status === 500) console.error(err);
    const message = status === 500 ? 'Something went wrong on the server. Check the terminal.'
      : isConstraintError(err) ? `The database rejected that: ${err.message}.` : err.message;
    // If we answered before reading the whole body (too large, wrong type), don't reuse the connection.
    return send(res, status, { error: message }, req.complete ? {} : { connection: 'close' });
  }
}
