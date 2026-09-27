import { Component, useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { GROUP_ORDER, fmt, phaseOf } from './lib/format.js';
import { Icon, Seal, Toast } from './components/ui.jsx';
import NewBatchDialog from './components/NewBatchDialog.jsx';
import Today from './views/Today.jsx';
import BatchView from './views/BatchView.jsx';
import LogView from './views/LogView.jsx';
import JournalView from './views/JournalView.jsx';
import BrainView from './views/BrainView.jsx';

const NAV = [
  ['today', 'Today', Icon.today],
  ['batch', 'Batches', Icon.barrel],
  ['log', 'Log', Icon.log],
  ['journal', 'Journal', Icon.journal],
  ['brain', 'Brain', Icon.brain],
];

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) {
      return <div className="view"><p className="empty">This screen hit an error: {this.state.error.message}. Switch views or reload the page.</p></div>;
    }
    return this.props.children;
  }
}

function readTheme() {
  try { return localStorage.getItem('hb-theme') ?? 'day'; } catch { return 'day'; }
}

function BatchRail({ batches, activeId, onOpen }) {
  const groups = GROUP_ORDER.map(g => [g, batches.filter(b => phaseOf(b.phase).group === g)]).filter(([, list]) => list.length);
  return (
    <nav className="rail" aria-label="Batches">
      {groups.map(([group, list]) => (
        <div key={group} className="rail-group">
          <h3>{group}</h3>
          <ul>
            {list.map(b => (
              <li key={b.id}>
                <button type="button" className={`rail-item ${b.id === activeId ? 'is-active' : ''}`} onClick={() => onOpen(b.id)}>
                  <Seal phase={b.phase} size="sm" />
                  <span className="rail-name"><strong>{b.name}</strong><em>{b.sub}</em></span>
                  {b.topSeverity && <span className={`dot dot-${b.topSeverity}`} title={`${b.alertCount} flagged`} />}
                  {(b.phase === 'af' || b.phase === 'cold_soak') && b.metrics.brix != null && <span className="rail-val num">{fmt(b.metrics.brix)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState('today');
  const [batchId, setBatchId] = useState(null);
  const [brainBatchId, setBrainBatchId] = useState(null);
  const [logBatchId, setLogBatchId] = useState(null);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    let ignore = false;
    api.state()
      .then(s => { if (!ignore) { setState(s); setLoadError(null); } })
      .catch(e => { if (!ignore) setLoadError(e.message); });
    return () => { ignore = true; };
  }, [version]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('hb-theme', theme); } catch { /* private mode */ }
  }, [theme]);

  const notify = useCallback(t => setToast(t), []);
  const closeToast = useCallback(() => setToast(null), []);
  const changed = useCallback(t => { setVersion(v => v + 1); if (t) setToast(t); }, []);

  const openBatch = id => { setBatchId(id); setView('batch'); window.scrollTo?.(0, 0); };
  const openLog = id => { setLogBatchId(id ?? batchId ?? null); setView('log'); };
  const openBrain = id => { setBrainBatchId(id ?? null); setView('brain'); };

  if (loadError && !state) {
    return (
      <div className="boot">
        <h1>Harvest Brain can't reach its database</h1>
        <p>{loadError}</p>
        <p>Start it with <code>npm run dev</code> in the project folder, then reload.</p>
      </div>
    );
  }
  if (!state) return <div className="boot"><p className="loading">Opening the cellar…</p></div>;

  const batches = state.batches;
  const selected = batchId ?? batches.find(b => b.phase !== 'bottled')?.id ?? batches[0]?.id ?? null;
  const facilities = [...new Set(batches.map(b => b.facility).filter(Boolean))];

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => setView('today')}>
          <span className="crest" aria-hidden="true">H</span>
          <span className="wordmark">Harvest Brain</span>
        </button>
        <nav className="tabs" aria-label="Sections">
          {NAV.map(([key, label, I]) => (
            <button key={key} type="button" className={`tab ${view === key ? 'is-active' : ''}`}
              aria-current={view === key ? 'page' : undefined}
              onClick={() => (key === 'log' ? openLog(null) : key === 'brain' ? openBrain(brainBatchId) : setView(key))}>
              <I size={19} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <a className="icon-btn" href="/api/export" download title="Download all your data as JSON" aria-label="Export data"><Icon.download /></a>
          <button type="button" className="icon-btn" onClick={() => setTheme(t => (t === 'night' ? 'day' : 'night'))}
            aria-label={theme === 'night' ? 'Switch to day theme' : 'Switch to night theme'} title={theme === 'night' ? 'Day theme' : 'Night theme'}>
            {theme === 'night' ? <Icon.sun /> : <Icon.moon />}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setNewOpen(true)}><Icon.plus size={18} /> <span>New batch</span></button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar"><BatchRail batches={batches} activeId={view === 'batch' ? selected : null} onOpen={openBatch} /></aside>
        <main className="main">
          <ErrorBoundary resetKey={`${view}-${selected}`}>
            {view === 'today' && <Today state={state} onOpenBatch={openBatch} onLog={openLog} />}
            {view === 'batch' && (
              <>
                <div className="mobile-picker">
                  <select value={selected ?? ''} onChange={e => openBatch(Number(e.target.value))} aria-label="Batch">
                    {batches.map(b => <option key={b.id} value={b.id}>{b.name}, {b.sub}</option>)}
                  </select>
                </div>
                {selected ? (
                  <BatchView batchId={selected} version={version} onChanged={changed} onLog={openLog} onAsk={openBrain} notify={notify} />
                ) : <div className="view"><p className="empty">No batches yet. Use New batch to add your first.</p></div>}
              </>
            )}
            {view === 'log' && <LogView key={logBatchId ?? 'none'} batches={batches} defaultBatchId={logBatchId} onSaved={changed} notify={notify} />}
            {view === 'journal' && <JournalView batches={batches} version={version} onSaved={changed} notify={notify} />}
            {view === 'brain' && (
              <BrainView key={brainBatchId ?? 'cellar'} batches={batches} batchId={brainBatchId} engine={state.engine}
                onSelectBatch={setBrainBatchId} onChanged={changed} notify={notify} />
            )}
          </ErrorBoundary>
        </main>
      </div>

      <NewBatchDialog open={newOpen} lineages={state.lineages} facilities={facilities} notify={notify}
        onClose={() => setNewOpen(false)}
        onCreated={b => { setNewOpen(false); changed({ text: `Created ${b.vintage} ${b.varietal}` }); openBatch(b.id); }} />
      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}
