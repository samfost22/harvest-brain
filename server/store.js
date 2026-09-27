// Loads batches with everything the engine needs, and assembles the cellar-wide view.
import { all, get } from './db.js';
import { analyze, batchName, ms } from './analysis.js';
import { SEVERITY_ORDER } from '../shared/rules.js';

const pad = n => String(n).padStart(2, '0');
export const localStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const localDate = (d = new Date()) => localStamp(d).slice(0, 10);

const readingsFor = id => all('SELECT * FROM readings WHERE batch_id = ? ORDER BY taken_at, id', id);

export function loadBatch(id) {
  const batch = get('SELECT * FROM batches WHERE id = ?', id);
  if (!batch) return null;
  return {
    batch,
    readings: readingsFor(id),
    additions: all('SELECT * FROM additions WHERE batch_id = ? ORDER BY added_at, id', id),
    journal: all('SELECT * FROM journal WHERE batch_id = ? ORDER BY entry_date DESC, id DESC', id),
    decisions: all('SELECT * FROM decisions WHERE batch_id = ? ORDER BY decided_at DESC, id DESC', id),
    priors: batch.lineage
      ? all('SELECT * FROM batches WHERE lineage = ? AND vintage < ? ORDER BY vintage DESC', batch.lineage, batch.vintage)
          .map(p => ({ batch: p, readings: readingsFor(p.id) }))
      : [],
  };
}

export function analyzeBatch(id, nowMs = Date.now()) {
  const loaded = loadBatch(id);
  return loaded ? { ...loaded, ...analyze(loaded, nowMs) } : null;
}

export function summarize(x) {
  const b = x.batch;
  return {
    id: b.id,
    name: batchName(b),
    sub: [b.vineyard, b.block].filter(Boolean).join(', '),
    vintage: b.vintage,
    varietal: b.varietal,
    color: b.color,
    phase: b.phase,
    facility: b.facility,
    vessel: b.vessel,
    volume_l: b.volume_l,
    lineage: b.lineage,
    metrics: x.metrics,
    alertCount: x.alerts.length,
    topSeverity: x.alerts[0]?.severity ?? null,
  };
}

export function cellarState(nowMs = Date.now()) {
  const ids = all('SELECT id FROM batches WHERE archived = 0 ORDER BY vintage DESC, id').map(r => r.id);
  const analyzed = ids.map(id => analyzeBatch(id, nowMs));
  const batches = analyzed.map(a => a.batch);
  const vintage = batches.length ? Math.max(...batches.map(b => b.vintage)) : new Date(nowMs).getFullYear();
  const picks = batches.filter(b => b.vintage === vintage && b.harvest_date).map(b => ms(b.harvest_date));
  const now = new Date(nowMs);
  return {
    today: {
      date: localDate(now),
      label: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      vintage,
      harvestDay: picks.length ? Math.floor((nowMs - Math.min(...picks)) / 864e5) + 1 : null,
    },
    batches: analyzed.map(summarize),
    alerts: analyzed.flatMap(a => a.alerts).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    lineages: [...new Set(batches.map(b => b.lineage).filter(Boolean))].sort(),
  };
}
