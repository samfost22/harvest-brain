// Fermentation-curve helpers shared by the decision engine and the chart, so the Brix the chart marks
// for an earlier vintage is the same number the "behind last vintage" alert quotes.

/** Lineage key for a block across vintages: 'Santa Lucia Highlands', 'Block 3', 'Pinot Noir' -> 'santa-lucia-highlands-block-3-pinot-noir'. */
export const lineageSlug = (...parts) =>
  parts.filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Linear interpolation of Brix at a day along a curve of { day, brix }. A finished (dry) ferment stays dry. */
export function brixAtDay(curve, day) {
  if (!curve.length) return null;
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (day <= first.day) return first.day - day <= 1 ? first.brix : null;
  if (day > last.day) return last.brix <= 0 ? last.brix : null;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (day <= b.day) return a.brix + (b.brix - a.brix) * ((day - a.day) / (b.day - a.day || 1));
  }
  return null;
}
