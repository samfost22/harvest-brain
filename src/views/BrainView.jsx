import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon, MicButton, Rich } from '../components/ui.jsx';
import { phaseOf, utcLabel } from '../lib/format.js';

const SUGGESTIONS = {
  cellar: ['What needs attention today?', 'Which batch should I check first?'],
  af: ['Compare this ferment to last vintage', 'Is this ferment stuck?', 'Where are we on nutrients?', 'When should I press?'],
  cold_soak: ['Where are we on nutrients?', 'Compare this ferment to last vintage'],
  mlf: ['Is MLF progressing?', 'What should I do about the temperature?'],
  aging: ['How much SO₂ do I need?', 'Any spoilage risk?'],
  pressed: ['Should I start MLF now?', 'How much SO₂ do I need?'],
  bottled: ['Summarize this vintage for next year'],
  pre_harvest: ['What YAN do I need at this Brix?'],
};

let pendingId = 0; // keys for questions shown before the server has saved them

/** First sentence-ish of an answer, cleaned of markdown, as a starting point for a decision. */
const draftDecision = text => text.replace(/\*\*/g, '').split('\n').map(l => l.replace(/^\s*[-•*]\s+|^\d+[.)]\s+/, '')).find(l => l.trim()) ?? '';

export default function BrainView({ batches, batchId, engine, onSelectBatch, onChanged, notify }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [thinking, setThinking] = useState(false);
  const [loaded, setLoaded] = useState(false); // the parent keys this view by batch, so each thread starts fresh
  const [pinning, setPinning] = useState(null); // { id, text, rationale }
  const endRef = useRef(null);
  const batch = batches.find(b => b.id === batchId);

  useEffect(() => {
    let ignore = false;
    api.brain(batchId)
      .then(d => { if (!ignore) { setMessages(d.messages); setLoaded(true); } })
      .catch(e => notify({ text: e.message, error: true }));
    return () => { ignore = true; };
  }, [batchId, notify]);

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [messages, thinking]);

  async function ask(text) {
    const q = text.trim();
    if (!q || thinking || !loaded) return;
    setQuestion('');
    setThinking(true);
    const optimistic = { id: `tmp-${++pendingId}`, role: 'user', content: q, created_at: null };
    setMessages(list => [...list, optimistic]);
    try {
      const { message } = await api.ask(batchId, q);
      setMessages(list => [...list.filter(m => m.id !== optimistic.id), { ...optimistic, id: `u-${message.id}` }, message]);
    } catch (err) {
      setMessages(list => list.filter(m => m.id !== optimistic.id));
      setQuestion(q);
      notify({ text: err.message, error: true });
    } finally {
      setThinking(false);
    }
  }

  async function saveDecision() {
    try {
      await api.decide({ batchId, decision: pinning.text, rationale: pinning.rationale, source: 'brain' });
      setPinning(null);
      onChanged({ text: batch ? `Decision saved to ${batch.name}` : 'Decision saved' });
    } catch (err) {
      notify({ text: err.message, error: true });
    }
  }

  const suggestions = SUGGESTIONS[batch ? batch.phase : 'cellar'] ?? [];
  const usingClaude = engine?.startsWith('claude');
  const busy = thinking || !loaded;

  return (
    <div className="view brain">
      <header className="view-head brain-head">
        <div>
          <h1>Brain</h1>
          <p className="lede">
            {usingClaude ? `Answers from your records with Claude (${engine.slice(7)}).` : 'Answering from the built-in enology rules. Add ANTHROPIC_API_KEY to .env for open-ended answers.'}
          </p>
        </div>
        <label className="field">
          <span>Asking about</span>
          <select value={batchId ?? ''} onChange={e => onSelectBatch(e.target.value ? Number(e.target.value) : null)}>
            <option value="">The whole cellar</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}, {b.sub} ({phaseOf(b.phase).label.toLowerCase()})</option>)}
          </select>
        </label>
      </header>

      <div className="thread" aria-live="polite">
        {!loaded && <p className="loading">Opening this thread…</p>}
        {loaded && messages.length === 0 && !thinking && (
          <p className="empty">
            {batch ? `Ask anything about ${batch.name}. Answers cite your readings and past vintages of this block.` : 'Ask about the whole cellar, or pick a batch above.'}
          </p>
        )}
        {messages.map((m, i) => (
          <article key={m.id} className={`msg msg-${m.role}`}>
            {m.role === 'user' ? <p>{m.content}</p> : <Rich text={m.content} />}
            {m.role === 'assistant' && (
              <div className="msg-foot">
                <span>{m.engine === 'rules' ? 'Built-in rules' : m.engine?.replace('claude:', 'Claude, ')}{m.created_at ? `, ${utcLabel(m.created_at)}` : ''}</span>
                {batchId && (
                  <button type="button" className="link" onClick={() => setPinning({ id: m.id, text: draftDecision(m.content), rationale: messages[i - 1]?.content ?? '' })}>
                    <Icon.pin size={16} /> Save as decision
                  </button>
                )}
              </div>
            )}
            {pinning?.id === m.id && (
              <div className="pin-form">
                <label className="field"><span>Decision</span><textarea rows={2} value={pinning.text} onChange={e => setPinning(p => ({ ...p, text: e.target.value }))} /></label>
                <div className="row-actions">
                  <button type="button" className="btn btn-primary" onClick={saveDecision} disabled={!pinning.text.trim()}>Save decision</button>
                  <button type="button" className="link" onClick={() => setPinning(null)}>Cancel</button>
                </div>
              </div>
            )}
          </article>
        ))}
        {thinking && <p className="msg msg-assistant thinking">Reading your records…</p>}
        <div ref={endRef} />
      </div>

      <div className="suggestions">
        {suggestions.map(s => <button key={s} type="button" className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>)}
      </div>

      <form className="ask" onSubmit={e => { e.preventDefault(); ask(question); }}>
        <div className="with-mic">
          <textarea rows={2} value={question} onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question); } }}
            placeholder={batch ? `Ask about ${batch.name}` : 'Ask about the cellar'} aria-label="Question" />
          <MicButton onText={t => setQuestion(q => (q ? `${q} ${t}` : t))} label="Dictate a question" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>Ask</button>
      </form>
    </div>
  );
}
