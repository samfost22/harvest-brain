import { useEffect, useRef, useState } from 'react';
import { phaseOf } from '../lib/format.js';

// ── Icons (stroke icons drawn for this app) ────────────────────────────
const Svg = ({ children, size = 20, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
);
export const Icon = {
  today: p => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></Svg>,
  barrel: p => <Svg {...p}><ellipse cx="12" cy="12" rx="7" ry="9" /><path d="M5.3 8h13.4M5.3 16h13.4M12 3v18" /></Svg>,
  log: p => <Svg {...p}><path d="M9 3h6l-1 6 4 9a2 2 0 0 1-1.8 3H7.8A2 2 0 0 1 6 18l4-9z" /><path d="M8 14h8" /></Svg>,
  journal: p => <Svg {...p}><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6" /></Svg>,
  brain: p => <Svg {...p}><path d="M12 4a4 4 0 0 0-7 3 4 4 0 0 0 0 7 4 4 0 0 0 7 3z" /><path d="M12 4a4 4 0 0 1 7 3 4 4 0 0 1 0 7 4 4 0 0 1-7 3" /><path d="M12 4v16" /></Svg>,
  mic: p => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>,
  stop: p => <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>,
  plus: p => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  close: p => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  moon: p => <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Svg>,
  sun: p => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></Svg>,
  left: p => <Svg {...p}><path d="M15 5l-7 7 7 7" /></Svg>,
  right: p => <Svg {...p}><path d="M9 5l7 7-7 7" /></Svg>,
  pin: p => <Svg {...p}><path d="M12 17v4M8 3h8l-1 6 3 3v2H6v-2l3-3z" /></Svg>,
  download: p => <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>,
};

// ── Phase seal ─────────────────────────────────────────────────────────
export function Seal({ phase, size = 'md' }) {
  const p = phaseOf(phase);
  return <span className={`seal seal-${size} seal-${phase}`} title={p.label} aria-hidden="true">{p.seal}</span>;
}

// ── Alerts ─────────────────────────────────────────────────────────────
const SEVERITY_LABEL = { act: 'Act now', watch: 'Watch', info: 'Note' };

export function AlertList({ alerts, showBatch = false, onOpenBatch, empty }) {
  if (!alerts.length) return empty ? <p className="empty">{empty}</p> : null;
  return (
    <ul className="alerts">
      {alerts.map(a => (
        <li key={a.id} className={`alert alert-${a.severity}`}>
          <div className="alert-head">
            <span className="alert-sev">{SEVERITY_LABEL[a.severity]}</span>
            {showBatch && (
              <button type="button" className="link" onClick={() => onOpenBatch?.(a.batchId)}>{a.batchName}</button>
            )}
          </div>
          <p className="alert-title">{a.title}</p>
          <p className="alert-detail">{a.detail}</p>
          <p className="alert-action">{a.action}</p>
        </li>
      ))}
    </ul>
  );
}

// ── Stats ──────────────────────────────────────────────────────────────
export function Stat({ label, value, unit, tone, hint }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <span className="stat-value num">{value}{unit && <span className="stat-unit">{unit}</span>}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

// ── Markdown-lite for Brain answers: paragraphs, bullets, numbered lists, **bold** ──
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}
export function Rich({ text }) {
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of text.split('\n')) {
    const bullet = raw.match(/^\s*[-•*]\s+(.*)/);
    const numbered = raw.match(/^\s*\d+[.)]\s+(.*)/);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (list?.type !== type) { flush(); list = { type, items: [] }; }
      list.items.push((bullet ?? numbered)[1]);
      continue;
    }
    flush();
    const line = raw.replace(/^#{1,6}\s+/, '');
    if (line.trim()) blocks.push({ type: raw.startsWith('#') ? 'h' : 'p', text: line });
  }
  flush();
  return (
    <div className="rich">
      {blocks.map((b, i) => {
        if (b.type === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
        if (b.type === 'ol') return <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
        if (b.type === 'h') return <p key={i}><strong>{b.text}</strong></p>;
        return <p key={i}>{inline(b.text)}</p>;
      })}
    </div>
  );
}

// ── Voice: browser speech recognition (Chrome, Edge, Safari) ───────────
export function useSpeech(onText) {
  const [listening, setListening] = useState(false);
  const recognizer = useRef(null);
  const handler = useRef(onText);
  useEffect(() => { handler.current = onText; });
  useEffect(() => () => recognizer.current?.abort?.(), []);
  // Microphone access needs a secure page (https or localhost); elsewhere the button would silently fail.
  const Recognition = typeof window !== 'undefined' && window.isSecureContext
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

  function start() {
    if (!Recognition || listening) return;
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = e => handler.current(Array.from(e.results).map(r => r[0].transcript).join(' '));
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognizer.current = rec;
    rec.start();
    setListening(true);
  }
  const stop = () => recognizer.current?.stop();
  return { supported: Boolean(Recognition), listening, start, stop };
}

export function MicButton({ onText, label = 'Dictate' }) {
  const speech = useSpeech(onText);
  if (!speech.supported) return null;
  return (
    <button type="button" className={`icon-btn mic ${speech.listening ? 'is-listening' : ''}`}
      onClick={speech.listening ? speech.stop : speech.start}
      aria-label={speech.listening ? 'Stop listening' : label} title={speech.listening ? 'Stop listening' : label}>
      {speech.listening ? <Icon.stop /> : <Icon.mic />}
    </button>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────
export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, toast.action ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">
      <span>{toast.text}</span>
      {toast.action && (
        <button type="button" className="link" onClick={() => { toast.action.run(); onClose(); }}>{toast.action.label}</button>
      )}
    </div>
  );
}
