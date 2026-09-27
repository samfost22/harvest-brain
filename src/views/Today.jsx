import { AlertList, Seal } from '../components/ui.jsx';
import { ago, fmt, phaseOf } from '../lib/format.js';

function keyReading(b) {
  const m = b.metrics;
  if (b.phase === 'af' || b.phase === 'cold_soak') {
    return { value: `${fmt(m.brix)} °Bx`, sub: m.ratePerDay != null ? `${fmt(m.ratePerDay)} °Bx/day` : 'rate after 2 readings' };
  }
  if (b.phase === 'mlf') return { value: `${fmt(m.malic, 2)} g/L malic`, sub: m.mustF != null ? `${fmt(m.mustF, 0)} °F` : '' };
  if (b.phase === 'aging' || b.phase === 'pressed') {
    return { value: m.molecular != null ? `${fmt(m.molecular, 2)} mg/L` : 'No SO₂ yet', sub: m.molecular != null ? 'molecular SO₂' : '' };
  }
  return { value: '', sub: '' };
}

export default function Today({ state, onOpenBatch, onLog }) {
  const { today, alerts, batches } = state;
  const active = batches.filter(b => b.phase !== 'bottled');
  const counts = ['af', 'cold_soak', 'pressed', 'mlf', 'aging']
    .map(k => [phaseOf(k).label.toLowerCase(), active.filter(b => b.phase === k).length])
    .filter(([, n]) => n)
    .map(([label, n]) => `${n} in ${label}`);
  const urgent = alerts.filter(a => a.severity === 'act').length;

  return (
    <div className="view today">
      <header className="view-head">
        <h1>{today.label}</h1>
        <p className="lede">
          {today.harvestDay ? `Harvest day ${today.harvestDay}. ` : ''}
          {active.length ? `${counts.join(', ')}.` : 'No active batches yet.'}
          {urgent ? ` ${urgent} ${urgent === 1 ? 'thing needs' : 'things need'} you now.` : ''}
        </p>
      </header>

      <section className="section">
        <div className="section-head">
          <h2>Needs you</h2>
          <button type="button" className="btn btn-primary" onClick={() => onLog()}>Log a reading</button>
        </div>
        <AlertList alerts={alerts} showBatch onOpenBatch={onOpenBatch}
          empty="Nothing needs you right now. Log today's readings to keep the curves honest." />
      </section>

      <section className="section">
        <h2>In the cellar</h2>
        {active.length === 0 ? (
          <p className="empty">Add your first batch with New batch. Log readings as you take them and alerts will start here.</p>
        ) : (
          <div className="table-wrap">
            <table className="cellar-table">
              <thead>
                <tr><th>Batch</th><th>Phase</th><th className="r">Now</th><th className="r">Last reading</th></tr>
              </thead>
              <tbody>
                {active.map(b => {
                  const k = keyReading(b);
                  return (
                    <tr key={b.id} onClick={() => onOpenBatch(b.id)} tabIndex={0}
                      onKeyDown={e => (e.key === 'Enter' ? onOpenBatch(b.id) : null)}>
                      <td>
                        <span className="cell-batch">
                          <Seal phase={b.phase} size="sm" />
                          <span><strong>{b.name}</strong><em>{b.sub}</em></span>
                        </span>
                      </td>
                      <td>{phaseOf(b.phase).label}{b.phase === 'af' && b.metrics.afDay != null ? `, day ${Math.floor(b.metrics.afDay)}` : ''}</td>
                      <td className="r num"><span className="cell-value">{k.value}</span><em>{k.sub}</em></td>
                      <td className="r">
                        {ago(b.metrics.hoursSinceReading)}
                        {b.alertCount > 0 && <em className={`sev-${b.topSeverity}`}>{b.alertCount} flagged</em>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
