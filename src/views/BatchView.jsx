import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { AlertList, Icon, Stat } from '../components/ui.jsx';
import FermentChart from '../components/FermentChart.jsx';
import { L_PER_GAL, PHASES, dateLabel, fmt, phaseOf, stampLabel } from '../lib/format.js';

const STEPS = PHASES.filter(p => p.key !== 'pre_harvest');
const COLUMNS = [
  ['brix', '°Bx', 1], ['must_temp_f', 'Must °F', 0], ['cap_temp_f', 'Cap °F', 0], ['ph', 'pH', 2], ['ta', 'TA', 1],
  ['free_so2', 'Free SO₂', 0], ['total_so2', 'Total SO₂', 0], ['malic', 'Malic', 2], ['ml_chroma', 'Malic spot', null],
  ['yan', 'YAN', 0], ['va', 'VA', 2],
];
const KIND_LABEL = { so2: 'SO₂', nutrient: 'Nutrient', yeast: 'Yeast', ml_bacteria: 'ML bacteria', acid: 'Acid', tannin: 'Tannin', enzyme: 'Enzyme', water: 'Water', other: 'Other' };

function KeyFigures({ batch: b, metrics: m }) {
  if (b.phase === 'af' || b.phase === 'cold_soak' || b.phase === 'pre_harvest') {
    return (
      <div className="stats">
        <Stat label="Brix now" value={fmt(m.brix)} unit="°Bx" tone="lead" />
        <Stat label="Per day, last 48 h" value={fmt(m.ratePerDay)} unit="°Bx" />
        <Stat label="Day since inoculation" value={m.afDay != null ? fmt(m.afDay) : '—'} />
        <Stat label="Must / cap" value={`${fmt(m.mustF, 0)} / ${fmt(m.capF, 0)}`} unit="°F" />
        <Stat label="Sugar used" value={m.depletion != null ? Math.round(m.depletion * 100) : '—'} unit="%" hint={m.daysToDry ? `about ${fmt(m.daysToDry)} days to dry` : null} />
      </div>
    );
  }
  if (b.phase === 'mlf') {
    return (
      <div className="stats">
        <Stat label="Malic" value={fmt(m.malic, 2)} unit="g/L" tone="lead" />
        <Stat label="Wine temperature" value={fmt(m.mustF, 0)} unit="°F" />
        <Stat label="Days in MLF" value={m.mlfDay != null ? Math.floor(m.mlfDay) : '—'} />
        <Stat label="pH" value={fmt(m.ph, 2)} />
      </div>
    );
  }
  return (
    <div className="stats">
      <Stat label="Molecular SO₂" value={fmt(m.molecular, 2)} unit="mg/L" tone="lead" />
      <Stat label="Free / total SO₂" value={`${fmt(m.freeSO2, 0)} / ${fmt(m.totalSO2, 0)}`} unit="mg/L" />
      <Stat label="pH" value={fmt(m.ph, 2)} />
      <Stat label="VA" value={fmt(m.va, 2)} unit="g/L" />
    </div>
  );
}

export default function BatchView({ batchId, version, onChanged, onLog, onAsk, notify }) {
  const [loaded, setLoaded] = useState(null); // { id, data } or { id, error }: stale results for another batch never show
  const [showTemps, setShowTemps] = useState(true);

  useEffect(() => {
    let ignore = false;
    api.batch(batchId)
      .then(data => { if (!ignore) setLoaded({ id: batchId, data }); })
      .catch(e => { if (!ignore) setLoaded({ id: batchId, error: e.message }); });
    return () => { ignore = true; };
  }, [batchId, version]);

  if (loaded?.id !== batchId) return <div className="view"><p className="loading">Opening the batch…</p></div>;
  if (loaded.error) return <div className="view"><p className="empty">{loaded.error}</p></div>;

  const { batch: b, metrics, alerts, curve, priorCurves, readings, additions, decisions, journal } = loaded.data;
  const currentStep = STEPS.findIndex(s => s.key === b.phase);
  const shownColumns = COLUMNS.filter(([key]) => readings.some(r => r[key] != null));
  const recent = [...readings].reverse().slice(0, 30);

  async function movePhase(next) {
    const previous = b.phase;
    try {
      await api.updateBatch(b.id, { phase: next });
      const undo = async () => {
        try {
          await api.updateBatch(b.id, { phase: previous });
          onChanged({ text: 'Phase change undone' });
        } catch (e) {
          notify({ text: e.message, error: true });
        }
      };
      onChanged({ text: `Moved to ${phaseOf(next).label.toLowerCase()}`, action: { label: 'Undo', run: undo } });
    } catch (e) {
      notify({ text: e.message, error: true });
    }
  }

  return (
    <div className="view batch">
      <header className="view-head batch-head">
        <div>
          <h1>{b.vintage} {b.varietal}</h1>
          <p className="batch-sub">
            <span>{[b.vineyard, b.block].filter(Boolean).join(', ') || 'Vineyard not set'}</span>
            {b.facility && <span>{b.facility}</span>}
            {b.vessel && <span>{b.vessel}</span>}
            {b.volume_l && <span className="num">{fmt(b.volume_l, 0)} L ({fmt(b.volume_l / L_PER_GAL, 0)} gal)</span>}
          </p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn btn-primary" onClick={() => onLog(b.id)}>Log a reading</button>
          <button type="button" className="btn" onClick={() => onAsk(b.id)}><Icon.brain size={18} /> Ask Brain</button>
        </div>
      </header>

      <ol className="stepper" aria-label="Phase">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < currentStep ? 'done' : i === currentStep ? 'current' : ''}>
            <button type="button" onClick={() => (i === currentStep ? null : movePhase(s.key))}
              aria-current={i === currentStep ? 'step' : undefined}
              title={i === currentStep ? `Currently ${s.label.toLowerCase()}` : `Move to ${s.label.toLowerCase()}`}>
              <span className="step-mark">{s.seal}</span>
              <span className="step-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <KeyFigures batch={b} metrics={metrics} />

      {alerts.length > 0 && (
        <section className="section">
          <h2>Needs you</h2>
          <AlertList alerts={alerts} />
        </section>
      )}

      {(curve.length > 0 || priorCurves.length > 0) && (
        <section className="section">
          <div className="section-head">
            <h2>Fermentation curve</h2>
            <label className="toggle">
              <input type="checkbox" checked={showTemps} onChange={e => setShowTemps(e.target.checked)} /> Temperatures
            </label>
          </div>
          <FermentChart curve={curve} priors={priorCurves} vintage={b.vintage} showTemps={showTemps} />
          {priorCurves.length === 0 && (
            <p className="footnote">Next vintage, give this block the same lineage and its curve will appear here for comparison.</p>
          )}
        </section>
      )}

      <section className="section">
        <h2>Readings</h2>
        {recent.length === 0 ? <p className="empty">No readings yet. Log the first one from the crush pad.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>When</th>{shownColumns.map(([k, label]) => <th key={k} className="r">{label}</th>)}<th>Note</th></tr></thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id}>
                    <td className="nowrap">{stampLabel(r.taken_at)}</td>
                    {shownColumns.map(([k, , d]) => <td key={k} className="r num">{d == null ? (r[k] ?? '—') : fmt(r[k], d)}</td>)}
                    <td className="note-cell">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Additions</h2>
        {additions.length === 0 ? <p className="empty">No additions logged. SO₂, nutrients, yeast and bacteria go here, with the reason.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>When</th><th>What</th><th>Product</th><th className="r">Amount</th><th className="r">SO₂ ppm</th><th>Why</th></tr></thead>
              <tbody>
                {[...additions].reverse().map(a => (
                  <tr key={a.id}>
                    <td className="nowrap">{stampLabel(a.added_at)}</td>
                    <td>{KIND_LABEL[a.kind]}</td>
                    <td>{a.product}</td>
                    <td className="r num">{a.amount != null ? `${fmt(a.amount, a.amount % 1 ? 1 : 0)} ${a.unit ?? ''}` : '—'}</td>
                    <td className="r num">{a.so2_ppm != null ? fmt(a.so2_ppm, 0) : ''}</td>
                    <td>{[a.reason?.replace('_', ' '), a.note].filter(Boolean).join('. ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="two-col">
        <section className="section">
          <h2>Decisions</h2>
          {decisions.length === 0 ? <p className="empty">Save a Brain answer as a decision and it lands here, dated, for next vintage.</p> : (
            <ul className="notes">
              {decisions.map(d => (
                <li key={d.id}>
                  <span className="note-date">{dateLabel(d.decided_at)}{d.source === 'brain' ? ', from Brain' : ''}</span>
                  <p>{d.decision}</p>
                  {d.rationale && <p className="note-why">{d.rationale}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="section">
          <h2>Journal notes</h2>
          {journal.length === 0 ? <p className="empty">Link journal entries to this batch to see them here.</p> : (
            <ul className="notes">
              {journal.slice(0, 8).map(j => (
                <li key={j.id}><span className="note-date">{dateLabel(j.entry_date)}</span><p>{j.body}</p></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="section">
        <h2>At harvest</h2>
        <dl className="spec">
          <div><dt>Picked</dt><dd>{b.harvest_date ? dateLabel(b.harvest_date, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</dd></div>
          <div><dt>Tons</dt><dd className="num">{fmt(b.tons, 2)}</dd></div>
          <div><dt>Brix</dt><dd className="num">{fmt(b.brix_at_pick)}</dd></div>
          <div><dt>pH</dt><dd className="num">{fmt(b.ph_at_pick, 2)}</dd></div>
          <div><dt>TA</dt><dd className="num">{fmt(b.ta_at_pick)} g/L</dd></div>
          <div><dt>YAN</dt><dd className="num">{fmt(b.yan_at_pick, 0)} mg/L</dd></div>
          <div><dt>Whole cluster</dt><dd className="num">{b.whole_cluster_pct != null ? `${fmt(b.whole_cluster_pct, 0)}%` : '—'}</dd></div>
          <div><dt>Yeast</dt><dd>{b.yeast ?? '—'}</dd></div>
          <div><dt>ML strain</dt><dd>{b.ml_strain ?? '—'}</dd></div>
          <div><dt>Lineage</dt><dd>{b.lineage ?? '—'}</dd></div>
        </dl>
      </section>
    </div>
  );
}
