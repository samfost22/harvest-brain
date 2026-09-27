export const PHASES = [
  { key: 'pre_harvest', label: 'Pre-harvest', seal: 'H', group: 'Pre-harvest' },
  { key: 'cold_soak', label: 'Cold soak', seal: 'C', group: 'Fermenting' },
  { key: 'af', label: 'Primary', seal: 'F', group: 'Fermenting' },
  { key: 'pressed', label: 'Pressed', seal: 'P', group: 'Pressed' },
  { key: 'mlf', label: 'Malolactic', seal: 'M', group: 'Malolactic' },
  { key: 'aging', label: 'Aging', seal: 'A', group: 'Aging' },
  { key: 'bottled', label: 'Bottled', seal: 'B', group: 'Bottled' },
];
export const GROUP_ORDER = ['Fermenting', 'Pressed', 'Malolactic', 'Aging', 'Pre-harvest', 'Bottled'];
export const phaseOf = key => PHASES.find(p => p.key === key) ?? PHASES[2];

export const L_PER_GAL = 3.78541;

/** Number with a true minus sign, or an em dash when missing. */
export const fmt = (n, digits = 1) =>
  n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(digits).replace('-', '−');

const pad = n => String(n).padStart(2, '0');
export const nowLocal = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const todayLocal = () => nowLocal().slice(0, 10);
export const shiftDate = (date, days) => {
  const d = new Date(`${date}T12:00`);
  d.setDate(d.getDate() + days);
  return nowLocal(d).slice(0, 10);
};

const asDate = s => new Date(s.length === 10 ? `${s}T12:00` : s);
export const dateLabel = (s, opts = { month: 'short', day: 'numeric' }) => (s ? asDate(s).toLocaleDateString('en-US', opts) : '—');
export const timeLabel = s => (s && s.length > 10 ? asDate(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
export const stampLabel = s => (s ? `${dateLabel(s)}${timeLabel(s) ? `, ${timeLabel(s)}` : ''}` : '—');

export function ago(hours) {
  if (hours == null) return 'never';
  if (hours < 1) return 'just now';
  if (hours < 36) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const batchTitle = b => (b ? `${b.vintage} ${b.varietal}` : '');

/** SQLite datetime('now') values are UTC "YYYY-MM-DD HH:MM:SS"; show them in local time. */
export function utcLabel(s) {
  if (!s) return '';
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
