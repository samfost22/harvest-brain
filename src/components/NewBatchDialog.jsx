import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from './ui.jsx';
import { L_PER_GAL, PHASES, todayLocal } from '../lib/format.js';
import { lineageSlug } from '../../shared/curve.js';

export default function NewBatchDialog({ open, lineages, facilities, onClose, onCreated, notify }) {
  const dialog = useRef(null);
  const [form, setForm] = useState(() => blank());
  const [volumeUnit, setVolumeUnit] = useState('L');
  const [saving, setSaving] = useState(false);

  function blank() {
    return { vintage: String(new Date().getFullYear()), varietal: '', color: 'red', vineyard: '', block: '', lineage: '',
      facility: '', vessel: '', volume: '', phase: 'cold_soak', harvest_date: todayLocal(), tons: '', brix_at_pick: '',
      ph_at_pick: '', ta_at_pick: '', yan_at_pick: '', whole_cluster_pct: '', yeast: '' };
  }

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setForm(blank());
      try { d.showModal(); } catch { d.setAttribute('open', ''); }
    }
    if (!open && d.open) {
      try { d.close(); } catch { d.removeAttribute('open'); }
    }
  }, [open]);

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const autoLineage = lineageSlug(form.vineyard, form.block, form.varietal);
  const lineage = form.lineage || autoLineage;
  const matchesExisting = lineages.includes(lineage);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const volume = form.volume === '' ? null : volumeUnit === 'L' ? Number(form.volume) : Number(form.volume) * L_PER_GAL;
      const { volume: _v, ...rest } = form;
      const created = await api.createBatch({ ...rest, lineage, volume_l: volume });
      onCreated(created.batch);
    } catch (err) {
      notify({ text: err.message, error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit}>
        <header className="dialog-head">
          <h2>New batch</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon.close /></button>
        </header>
        <div className="dialog-body">
          <div className="field-grid">
            <label className="field"><span>Vintage</span><input required inputMode="numeric" value={form.vintage} onChange={set('vintage')} /></label>
            <label className="field"><span>Varietal</span><input required value={form.varietal} onChange={set('varietal')} placeholder="Pinot Noir" /></label>
            <label className="field"><span>Style</span>
              <select value={form.color} onChange={set('color')}><option value="red">Red</option><option value="white">White</option><option value="rose">Rosé</option></select>
            </label>
            <label className="field"><span>Phase</span>
              <select value={form.phase} onChange={set('phase')}>{PHASES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            </label>
            <label className="field"><span>Vineyard</span><input value={form.vineyard} onChange={set('vineyard')} placeholder="Santa Lucia Highlands" /></label>
            <label className="field"><span>Block</span><input value={form.block} onChange={set('block')} placeholder="Block 3" /></label>
          </div>

          <label className="field">
            <span>Lineage, to compare with other vintages of this block</span>
            <input list="lineages" value={form.lineage} onChange={set('lineage')} placeholder={autoLineage || 'vineyard-block-varietal'} />
            <datalist id="lineages">{lineages.map(l => <option key={l} value={l} />)}</datalist>
            <em className="field-hint">{lineage ? (matchesExisting ? 'Matches earlier vintages on file. Their curves will show on this batch.' : `New lineage: ${lineage}`) : 'Fill in vineyard, block and varietal.'}</em>
          </label>

          <div className="field-grid">
            <label className="field"><span>Where it's made</span>
              <input list="facilities" value={form.facility} onChange={set('facility')} placeholder="Home cellar" />
              <datalist id="facilities">{facilities.map(f => <option key={f} value={f} />)}</datalist>
            </label>
            <label className="field"><span>Vessel</span><input value={form.vessel} onChange={set('vessel')} placeholder="Open-top fermenter, 1 T" /></label>
            <label className="field field-unit"><span>Volume</span>
              <div className="with-unit">
                <input inputMode="decimal" value={form.volume} onChange={set('volume')} />
                <select value={volumeUnit} onChange={e => setVolumeUnit(e.target.value)} aria-label="Volume unit"><option>L</option><option>gal</option></select>
              </div>
            </label>
            <label className="field"><span>Picked</span><input type="date" value={form.harvest_date} onChange={set('harvest_date')} /></label>
            <label className="field"><span>Tons</span><input inputMode="decimal" value={form.tons} onChange={set('tons')} /></label>
            <label className="field"><span>Whole cluster %</span><input inputMode="decimal" value={form.whole_cluster_pct} onChange={set('whole_cluster_pct')} /></label>
          </div>

          <fieldset className="fields">
            <legend>At the crush pad</legend>
            <div className="field-grid">
              <label className="field"><span>Brix</span><input inputMode="decimal" value={form.brix_at_pick} onChange={set('brix_at_pick')} /></label>
              <label className="field"><span>pH</span><input inputMode="decimal" value={form.ph_at_pick} onChange={set('ph_at_pick')} /></label>
              <label className="field"><span>TA, g/L</span><input inputMode="decimal" value={form.ta_at_pick} onChange={set('ta_at_pick')} /></label>
              <label className="field"><span>YAN, mg/L</span><input inputMode="decimal" value={form.yan_at_pick} onChange={set('yan_at_pick')} /></label>
              <label className="field"><span>Yeast, if chosen</span><input value={form.yeast} onChange={set('yeast')} placeholder="RC212" /></label>
            </div>
          </fieldset>
        </div>
        <footer className="dialog-foot">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create batch'}</button>
        </footer>
      </form>
    </dialog>
  );
}
