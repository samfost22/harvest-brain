import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon, MicButton } from '../components/ui.jsx';
import { dateLabel, fmt, shiftDate, timeLabel, todayLocal } from '../lib/format.js';

const WEATHER = [['fog', 'Fog'], ['sun', 'Sun'], ['heat', 'Heat'], ['wind', 'Wind'], ['rain', 'Rain'], ['smoke', 'Smoke']];

function readingSummary(r) {
  const parts = [];
  if (r.brix != null) parts.push(`${fmt(r.brix)} °Bx`);
  if (r.must_temp_f != null) parts.push(`must ${fmt(r.must_temp_f, 0)} °F`);
  if (r.cap_temp_f != null) parts.push(`cap ${fmt(r.cap_temp_f, 0)} °F`);
  if (r.free_so2 != null) parts.push(`free SO₂ ${fmt(r.free_so2, 0)}`);
  if (r.ph != null) parts.push(`pH ${fmt(r.ph, 2)}`);
  if (r.malic != null) parts.push(`malic ${fmt(r.malic, 2)}`);
  if (r.va != null) parts.push(`VA ${fmt(r.va, 2)}`);
  return parts.join(', ');
}

function Entry({ entry }) {
  return (
    <li className="entry">
      <div className="entry-meta">
        {entry.batch_name && <span className="entry-batch">{entry.batch_name}</span>}
        {entry.weather && entry.weather.split(',').map(w => <span key={w} className={`chip chip-static chip-${w}`}>{w}</span>)}
      </div>
      <p>{entry.body}</p>
    </li>
  );
}

export default function JournalView({ batches, version, onSaved, notify }) {
  const [date, setDate] = useState(todayLocal());
  const [data, setData] = useState(null);
  const [body, setBody] = useState('');
  const [weather, setWeather] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    api.journal(date).then(d => { if (!ignore) setData(d); }).catch(e => notify({ text: e.message, error: true }));
    return () => { ignore = true; };
  }, [date, version, notify]);

  const toggleWeather = w => setWeather(list => (list.includes(w) ? list.filter(x => x !== w) : [...list, w]));
  const isToday = date === todayLocal();

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.addJournal({ entryDate: date, batchId: batchId || null, body, weather });
      setBody('');
      setWeather([]);
      onSaved({ text: 'Journal entry saved' });
    } catch (err) {
      notify({ text: err.message, error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view journal">
      <header className="view-head journal-head">
        <button type="button" className="icon-btn" onClick={() => setDate(d => shiftDate(d, -1))} aria-label="Previous day"><Icon.left /></button>
        <div>
          <h1>{dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
          {!isToday && <button type="button" className="link" onClick={() => setDate(todayLocal())}>Back to today</button>}
        </div>
        <button type="button" className="icon-btn" onClick={() => setDate(d => shiftDate(d, 1))} aria-label="Next day" disabled={isToday}><Icon.right /></button>
      </header>

      <form className="composer" onSubmit={save}>
        <div className="chips" role="group" aria-label="Weather">
          {WEATHER.map(([k, label]) => (
            <button key={k} type="button" className={`chip chip-${k} ${weather.includes(k) ? 'is-on' : ''}`}
              aria-pressed={weather.includes(k)} onClick={() => toggleWeather(k)}>{label}</button>
          ))}
        </div>
        <div className="with-mic">
          <textarea className="page" rows={5} value={body} onChange={e => setBody(e.target.value)}
            placeholder="What happened today? Picks, tastings, weather, decisions." />
          <MicButton onText={t => setBody(b => (b ? `${b} ${t}` : t))} label="Dictate an entry" />
        </div>
        <div className="composer-foot">
          <label className="field">
            <span>About</span>
            <select value={batchId} onChange={e => setBatchId(e.target.value)}>
              <option value="">The whole cellar</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.name}, {b.sub}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={saving || !body.trim()}>{saving ? 'Saving…' : 'Save entry'}</button>
        </div>
      </form>

      {data && (
        <>
          {data.readings.length > 0 && (
            <section className="section">
              <h2>Logged this day</h2>
              <ul className="day-readings">
                {data.readings.map(r => (
                  <li key={r.id}><span className="num">{timeLabel(r.taken_at)}</span><strong>{r.batch_name}</strong><span>{readingSummary(r) || r.note}</span></li>
                ))}
              </ul>
            </section>
          )}
          <section className="section">
            <h2>{isToday ? 'Today' : 'This day'}</h2>
            {data.entries.length ? <ul className="entries">{data.entries.map(e => <Entry key={e.id} entry={e} />)}</ul>
              : <p className="empty">No entry yet. A line a day is enough; next vintage you'll be glad you wrote it.</p>}
          </section>
          {data.recent.length > 0 && (
            <section className="section">
              <h2>Earlier</h2>
              <ul className="entries">
                {data.recent.map(e => (
                  <li key={e.id} className="entry">
                    <button type="button" className="link entry-date" onClick={() => setDate(e.entry_date)}>{dateLabel(e.entry_date, { weekday: 'short', month: 'short', day: 'numeric' })}</button>
                    <div className="entry-meta">
                      {e.batch_name && <span className="entry-batch">{e.batch_name}</span>}
                      {e.weather && e.weather.split(',').map(w => <span key={w} className={`chip chip-static chip-${w}`}>{w}</span>)}
                    </div>
                    <p>{e.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
