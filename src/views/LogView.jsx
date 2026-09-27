import { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { AlertList, Icon, MicButton } from '../components/ui.jsx';
import { parseQuickEntry } from '../../shared/parse.js';
import { so2Plan } from '../../shared/chemistry.js';
import { RULES } from '../../shared/rules.js';
import { L_PER_GAL, fmt, nowLocal, phaseOf } from '../lib/format.js';

const FIELDS = {
  brix: { label: 'Brix', unit: '°Bx', },
  must_temp_f: { label: 'Must temp', unit: '°F', },
  cap_temp_f: { label: 'Cap temp', unit: '°F', },
  ph: { label: 'pH', unit: '', },
  ta: { label: 'TA', unit: 'g/L', },
  free_so2: { label: 'Free SO₂', unit: 'mg/L', },
  total_so2: { label: 'Total SO₂', unit: 'mg/L', },
  malic: { label: 'Malic', unit: 'g/L', },
  yan: { label: 'YAN', unit: 'mg/L', },
  va: { label: 'VA', unit: 'g/L', },
};
const PRIMARY = {
  pre_harvest: ['brix', 'ph', 'ta', 'yan'],
  cold_soak: ['brix', 'must_temp_f'],
  af: ['brix', 'must_temp_f', 'cap_temp_f'],
  pressed: ['brix', 'must_temp_f', 'ph'],
  mlf: ['malic', 'must_temp_f', 'ph'],
  aging: ['free_so2', 'ph', 'total_so2', 'va'],
  bottled: ['free_so2', 'ph'],
};
const KINDS = [['so2', 'SO₂'], ['nutrient', 'Nutrient'], ['yeast', 'Yeast'], ['ml_bacteria', 'ML bacteria'], ['acid', 'Acid'], ['tannin', 'Tannin'], ['enzyme', 'Enzyme'], ['water', 'Water'], ['other', 'Other']];
const PRODUCTS = {
  so2: ['KMBS', 'Effervescent SO₂ tablet', 'SO₂ solution'],
  nutrient: ['Fermaid O', 'Fermaid K', 'Go-Ferm Protect', 'DAP', 'Yeast hulls'],
  yeast: ['RC212', 'D254', 'BM4X4', 'CY3079', 'EC-1118', 'QA23', 'Native'],
  ml_bacteria: ['VP41', 'CH16', 'Beta', 'Native'],
  acid: ['Tartaric acid', 'Malic acid', 'Citric acid'],
  tannin: ['FT Rouge', 'Tannin Complex'],
  enzyme: ['Lallzyme EX-V', 'Scottzyme Color Pro'],
};
const SO2_REASONS = [['crush', 'At crush'], ['post_ferment', 'After primary'], ['post_mlf', 'After MLF'], ['racking', 'Racking'], ['topping', 'Topping'], ['pre_bottling', 'Before bottling'], ['other', 'Other']];
const emptyReading = () => Object.fromEntries(Object.keys(FIELDS).map(k => [k, '']));
const newAddition = kind => ({ kind, product: PRODUCTS[kind]?.[0] ?? '', amount: '', unit: 'g', so2_ppm: '', reason: kind === 'so2' ? 'racking' : '' });

function So2Calculator({ batch, defaults, onUse }) {
  const [pH, setPH] = useState(defaults.ph ?? '');
  const [free, setFree] = useState(defaults.freeSO2 ?? '');
  const [volume, setVolume] = useState(batch?.volume_l ? fmt(batch.volume_l, 0) : '');
  const [unit, setUnit] = useState('L');
  const [target, setTarget] = useState(RULES.molecularSO2Target[batch?.color ?? 'red']);
  const liters = volume === '' ? null : unit === 'L' ? Number(volume) : Number(volume) * L_PER_GAL;
  const plan = pH === '' ? null : so2Plan({ freeSO2: Number(free || 0), pH: Number(pH), volumeL: liters, targetMolecular: Number(target) });

  return (
    <div className="calc">
      <div className="calc-inputs">
        <label className="field"><span>pH</span><input inputMode="decimal" value={pH} onChange={e => setPH(e.target.value)} /></label>
        <label className="field"><span>Free SO₂ now, mg/L</span><input inputMode="decimal" value={free} onChange={e => setFree(e.target.value)} /></label>
        <label className="field field-unit">
          <span>Volume</span>
          <div className="with-unit">
            <input inputMode="decimal" value={volume} onChange={e => setVolume(e.target.value)} />
            <select value={unit} onChange={e => setUnit(e.target.value)} aria-label="Volume unit"><option>L</option><option>gal</option></select>
          </div>
        </label>
        <label className="field"><span>Target molecular, mg/L</span><input inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} /></label>
      </div>
      {plan ? (
        <div className="calc-out">
          <p><span className="num big">{fmt(plan.molecular, 2)}</span> mg/L molecular now. Reaching {target} needs <span className="num">{fmt(plan.needFree, 0)}</span> mg/L free.</p>
          {plan.addPpm < 1 ? <p>No addition needed.</p> : (
            <p>
              Add <strong className="num">{fmt(plan.addPpm, 0)} ppm</strong>
              {plan.kmbsGrams != null && <>, about <strong className="num">{fmt(plan.kmbsGrams, 1)} g KMBS</strong></>}.
              {' '}Re-test free SO₂ in 24 hours; some will bind.
            </p>
          )}
          {plan.addPpm >= 1 && plan.kmbsGrams != null && (
            <button type="button" className="btn" onClick={() => onUse({ ...newAddition('so2'), amount: fmt(plan.kmbsGrams, 1), so2_ppm: fmt(plan.addPpm, 0) })}>
              Add this as an SO₂ addition
            </button>
          )}
        </div>
      ) : <p className="footnote">Enter pH to calculate.</p>}
    </div>
  );
}

export default function LogView({ batches, defaultBatchId, onSaved, notify }) {
  // Bottled wines stay out of the picker unless you came here from one, so the picker always shows the batch you save to.
  const selectable = batches.filter(b => b.phase !== 'bottled' || b.id === defaultBatchId);
  const [batchId, setBatchId] = useState(defaultBatchId ?? selectable[0]?.id ?? '');
  const [takenAt, setTakenAt] = useState(nowLocal());
  const [quick, setQuick] = useState('');
  const [filled, setFilled] = useState([]);
  const [reading, setReading] = useState(emptyReading);
  const [chroma, setChroma] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [additions, setAdditions] = useState([]);
  const [showCalc, setShowCalc] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const batch = batches.find(b => b.id === Number(batchId));
  const primary = PRIMARY[batch?.phase ?? 'af'];
  const others = Object.keys(FIELDS).filter(k => !primary.includes(k));
  const calcDefaults = useMemo(() => ({ ph: batch?.metrics?.ph != null ? fmt(batch.metrics.ph, 2) : '', freeSO2: batch?.metrics?.freeSO2 ?? '' }), [batch]);

  function applyQuick(text) {
    setQuick(text);
    const { values, found } = parseQuickEntry(text);
    if (!found.length) { setFilled([]); return; }
    setReading(r => ({ ...r, ...Object.fromEntries(Object.entries(values).filter(([k]) => k in FIELDS).map(([k, v]) => [k, String(v)])) }));
    if (values.ml_chroma) setChroma(values.ml_chroma);
    if (found.some(k => others.includes(k))) setShowAll(true);
    setFilled(found.map(k => (k === 'ml_chroma' ? 'Malic spot' : FIELDS[k].label)));
  }

  const setField = key => e => setReading(r => ({ ...r, [key]: e.target.value }));
  const updateAddition = (i, patch) => setAdditions(list => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  async function save(e) {
    e.preventDefault();
    if (!batch) return;
    setSaving(true);
    try {
      const res = await api.saveEntry({ batchId: batch.id, takenAt, reading: { ...reading, ml_chroma: chroma || null }, additions, note, source: quick ? 'quick' : 'manual' });
      setResult({ batchName: batch.name, alerts: res.alerts });
      setReading(emptyReading());
      setChroma('');
      setAdditions([]);
      setNote('');
      setQuick('');
      setFilled([]);
      setShowCalc(false);
      setTakenAt(nowLocal());
      onSaved({ text: `Saved to ${batch.name}` });
    } catch (err) {
      notify({ text: err.message, error: true });
    } finally {
      setSaving(false);
    }
  }

  if (!selectable.length) {
    return <div className="view"><h1>Log a reading</h1><p className="empty">Add a batch first with New batch, then log readings here.</p></div>;
  }

  const renderField = key => (
    <label key={key} className="field field-big">
      <span>{key === 'must_temp_f' && batch?.phase === 'mlf' ? 'Wine temp' : FIELDS[key].label}{FIELDS[key].unit && <em> {FIELDS[key].unit}</em>}</span>
      {/* Brix goes negative when dry: skip the decimal keypad, which has no minus key on iPhone. */}
      <input type="number" inputMode={key === 'brix' ? undefined : 'decimal'} step="any" value={reading[key]} onChange={setField(key)}
        className={filled.includes(FIELDS[key].label) ? 'is-filled' : ''} />
    </label>
  );

  return (
    <form className="view log" onSubmit={save} noValidate>
      <header className="view-head">
        <h1>Log a reading</h1>
        <p className="lede">Say it or type it in one line. Everything is timestamped and lands on the batch curve.</p>
      </header>

      <div className="log-top">
        <label className="field field-big">
          <span>Batch</span>
          <select value={batchId} onChange={e => { setBatchId(Number(e.target.value)); setResult(null); }}>
            {selectable.map(b => <option key={b.id} value={b.id}>{b.name}, {b.sub} ({phaseOf(b.phase).label.toLowerCase()})</option>)}
          </select>
        </label>
        <label className="field field-big">
          <span>When</span>
          <input type="datetime-local" value={takenAt} onChange={e => setTakenAt(e.target.value)} />
        </label>
      </div>

      <div className="quick">
        <label className="field field-big quick-field">
          <span>Quick entry</span>
          <div className="with-mic">
            <input value={quick} onChange={e => applyQuick(e.target.value)} placeholder="brix 12.4, cap 88, must 82" autoComplete="off" />
            <MicButton onText={t => applyQuick(quick ? `${quick} ${t}` : t)} label="Dictate readings" />
          </div>
        </label>
        <p className="quick-status" aria-live="polite">{filled.length ? `Filled ${filled.join(', ')}. Check the numbers, then save.` : ' '}</p>
      </div>

      <fieldset className="fields">
        <legend>Readings for {phaseOf(batch?.phase).label.toLowerCase()}</legend>
        <div className="field-grid">{primary.map(renderField)}</div>
        {batch?.phase === 'mlf' && (
          <label className="field field-big">
            <span>Malic spot on the paper</span>
            <select value={chroma} onChange={e => setChroma(e.target.value)}>
              <option value="">Not run</option><option value="present">Present</option><option value="faint">Faint</option><option value="absent">Gone</option>
            </select>
          </label>
        )}
        <button type="button" className="link" onClick={() => setShowAll(s => !s)}>{showAll ? 'Fewer measurements' : 'More measurements'}</button>
        {showAll && <div className="field-grid">{others.map(renderField)}</div>}
      </fieldset>

      <fieldset className="fields">
        <legend>Additions</legend>
        {additions.map((a, i) => (
          <div key={i} className="addition-row">
            <label className="field"><span>What</span>
              <select value={a.kind} onChange={e => updateAddition(i, newAddition(e.target.value))}>
                {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="field"><span>Product</span>
              <input list={`products-${a.kind}`} value={a.product} onChange={e => updateAddition(i, { product: e.target.value })} />
              <datalist id={`products-${a.kind}`}>{(PRODUCTS[a.kind] ?? []).map(p => <option key={p} value={p} />)}</datalist>
            </label>
            <label className="field field-unit"><span>Amount</span>
              <div className="with-unit">
                <input inputMode="decimal" value={a.amount} onChange={e => updateAddition(i, { amount: e.target.value })} />
                <select value={a.unit} onChange={e => updateAddition(i, { unit: e.target.value })} aria-label="Unit">
                  {['g', 'kg', 'mL', 'L', 'lb', 'oz', 'tablets'].map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </label>
            {a.kind === 'so2' && (
              <>
                <label className="field"><span>SO₂ added, ppm</span><input inputMode="decimal" value={a.so2_ppm} onChange={e => updateAddition(i, { so2_ppm: e.target.value })} /></label>
                <label className="field"><span>Why</span>
                  <select value={a.reason} onChange={e => updateAddition(i, { reason: e.target.value })}>
                    {SO2_REASONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
              </>
            )}
            <button type="button" className="icon-btn" onClick={() => setAdditions(list => list.filter((_, j) => j !== i))} aria-label="Remove addition"><Icon.close /></button>
          </div>
        ))}
        <div className="row-actions">
          <button type="button" className="btn" onClick={() => setAdditions(list => [...list, newAddition(batch?.phase === 'af' ? 'nutrient' : 'so2')])}><Icon.plus size={18} /> Add an addition</button>
          <button type="button" className="link" onClick={() => setShowCalc(s => !s)}>{showCalc ? 'Hide SO₂ calculator' : 'SO₂ calculator'}</button>
        </div>
        {showCalc && <So2Calculator key={batch?.id} batch={batch} defaults={calcDefaults} onUse={a => setAdditions(list => [...list, a])} />}
      </fieldset>

      <label className="field field-big">
        <span>Note</span>
        <div className="with-mic">
          <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Punched down twice, cap looks healthy, smells of violets" />
          <MicButton onText={t => setNote(n => (n ? `${n} ${t}` : t))} label="Dictate a note" />
        </div>
      </label>

      <div className="save-bar">
        <button type="submit" className="btn btn-primary btn-wide" disabled={saving}>{saving ? 'Saving…' : 'Save entry'}</button>
      </div>

      {result && (
        <section className="section saved">
          <h2>Saved to {result.batchName}</h2>
          <AlertList alerts={result.alerts} empty="Nothing flagged on this batch." />
        </section>
      )}
    </form>
  );
}
