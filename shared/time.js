// Local wall-clock timestamps, the format every reading and addition is stored in: 'YYYY-MM-DDTHH:MM'.
// Shared by the server and the browser so both stamp times the same way.

const pad = n => String(n).padStart(2, '0');

export const localStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const localDate = (d = new Date()) => localStamp(d).slice(0, 10);

const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

/**
 * Checks a 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM[:SS]' string names a real calendar moment.
 * Returns { date, time } with time null for a bare date, or null when it isn't valid.
 */
export function parseStamp(s) {
  const m = typeof s === 'string' ? s.trim().match(STAMP) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const probe = new Date(Number(y), Number(mo) - 1, Number(d));
  if (probe.getMonth() !== Number(mo) - 1 || probe.getDate() !== Number(d)) return null;
  if (h != null && (Number(h) > 23 || Number(mi) > 59)) return null;
  return { date: `${y}-${mo}-${d}`, time: h != null ? `${h}:${mi}` : null };
}
