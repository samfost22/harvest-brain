import { fmt } from '../lib/format.js';
import { brixAtDay } from '../../shared/curve.js';

// Brix by day since inoculation, with earlier vintages of the same block drawn as ghost lines.
const W = 760;
const H = 320;
const PAD = { l: 46, r: 48, t: 18, b: 38 };
const TEMP = [40, 100]; // °F, right axis
const LABEL_GAP = 18;

/** Spread label baselines so none sit closer than LABEL_GAP to each other or to a fixed label. */
function placeLabels(ys, fixedY) {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = [];
  let prev = -Infinity;
  for (const item of order) {
    let yy = Math.max(item.y, prev + LABEL_GAP);
    if (fixedY != null && Math.abs(yy - fixedY) < LABEL_GAP) yy = fixedY + LABEL_GAP;
    out[item.i] = yy;
    prev = yy;
  }
  return out;
}

export default function FermentChart({ curve, priors = [], vintage, showTemps = true }) {
  const all = [...curve, ...priors.flatMap(p => p.curve)];
  if (!all.length) return null;
  const minDay = Math.min(-1, ...all.map(p => p.day));
  const lastDay = curve.length ? curve[curve.length - 1].day : 0;
  const maxDay = Math.min(Math.max(lastDay + 2, ...priors.map(p => Math.min(p.curve.at(-1)?.day ?? 0, 16)), 8), 30);
  const maxBrix = Math.max(26, ...all.map(p => p.brix)) + 1;
  const minBrix = -3;

  const x = d => PAD.l + ((d - minDay) / (maxDay - minDay)) * (W - PAD.l - PAD.r);
  const y = b => PAD.t + ((maxBrix - b) / (maxBrix - minBrix)) * (H - PAD.t - PAD.b);
  const yT = f => PAD.t + ((TEMP[1] - f) / (TEMP[1] - TEMP[0])) * (H - PAD.t - PAD.b);
  const inView = p => p.day >= minDay && p.day <= maxDay;
  const path = (pts, key, scale) => pts.filter(p => p[key] != null && inView(p))
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${scale(p[key]).toFixed(1)}`).join(' ');

  const brixTicks = [];
  for (let b = 0; b <= maxBrix; b += 5) brixTicks.push(b);
  const dayTicks = [];
  for (let d = Math.ceil(minDay / 2) * 2; d <= maxDay; d += 2) dayTicks.push(d);
  const tempTicks = [50, 60, 70, 80, 90];
  const last = curve.filter(inView).at(-1);
  const hasTemps = showTemps && curve.some(p => p.must != null || p.cap != null);

  // Where each earlier vintage stood on the same day as this ferment's latest reading: the gap is the story.
  const marks = last
    ? priors.map((p, i) => ({ vintage: p.vintage, i, brix: brixAtDay(p.curve, last.day) })).filter(m => m.brix != null)
    : [];
  const currentLabelY = last ? y(last.brix) - 8 : null;
  const labelYs = placeLabels(marks.map(m => y(m.brix) + 5), currentLabelY);
  const nearRight = last && x(last.day) > W - PAD.r - 110;
  const anchor = nearRight ? 'end' : 'start';
  const dx = nearRight ? -10 : 10;
  const gapTop = last && marks.length ? Math.min(y(last.brix), ...marks.map(m => y(m.brix))) : null;
  const gapBottom = last && marks.length ? Math.max(y(last.brix), ...marks.map(m => y(m.brix))) : null;
  // Without a current reading to compare against, label earlier vintages at their ends, staggered.
  const endLabels = last ? [] : priors.map(p => p.curve.filter(inView).at(-1)).map((end, i) => (end ? { ...end, vintage: priors[i].vintage } : null));
  const endYs = placeLabels(endLabels.map(e => (e ? y(e.brix) - 6 : 0)), null);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Brix by day since inoculation for ${vintage}${priors.length ? `, compared with ${priors.map(p => p.vintage).join(' and ')}` : ''}`}>
        {brixTicks.map(b => (
          <g key={`b${b}`}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(b)} y2={y(b)} />
            <text className="tick" x={PAD.l - 8} y={y(b) + 4} textAnchor="end">{b}</text>
          </g>
        ))}
        <line className="dry-line" x1={PAD.l} x2={W - PAD.r} y1={y(-1.5)} y2={y(-1.5)} />
        <text className="tick tick-dry" x={W - PAD.r - 4} y={y(-1.5) - 6} textAnchor="end">dry</text>
        {dayTicks.map(d => (
          <text key={`d${d}`} className="tick" x={x(d)} y={H - PAD.b + 18} textAnchor="middle">{d === 0 ? 'inoc.' : d}</text>
        ))}
        <line className="inoc-line" x1={x(0)} x2={x(0)} y1={PAD.t} y2={H - PAD.b} />
        <text className="axis-label" x={PAD.l} y={H - 4}>days since inoculation</text>
        <text className="axis-label" x={12} y={PAD.t + 4} transform={`rotate(-90 12 ${PAD.t + 4})`} textAnchor="end">°Bx</text>

        {hasTemps && (
          <g className="temps">
            {tempTicks.map(t => <text key={`t${t}`} className="tick tick-temp" x={W - PAD.r + 8} y={yT(t) + 4}>{t}°</text>)}
            <path className="line-must" d={path(curve, 'must', yT)} />
            <path className="line-cap" d={path(curve, 'cap', yT)} />
          </g>
        )}

        {priors.map((p, i) => (
          <g key={p.vintage} className={`prior prior-${i}`}>
            <path d={path(p.curve, 'brix', y)} />
            {endLabels[i] && (
              <text className="prior-label" x={x(endLabels[i].day) - 4} y={endYs[i]} textAnchor="end">{p.vintage}</text>
            )}
          </g>
        ))}

        {marks.length > 0 && (
          <g className="gap">
            <line className="gap-line" x1={x(last.day)} x2={x(last.day)} y1={gapTop} y2={gapBottom} />
            {marks.map((m, k) => (
              <g key={m.vintage}>
                <circle className="gap-dot" cx={x(last.day)} cy={y(m.brix)} r={4.5} />
                <text className="prior-label" x={x(last.day) + dx} y={labelYs[k]} textAnchor={anchor}>{m.vintage}: {fmt(m.brix)}</text>
              </g>
            ))}
          </g>
        )}

        {curve.length > 0 && (
          <g className="current">
            <path d={path(curve, 'brix', y)} />
            {curve.filter(inView).map(p => (
              <circle key={p.at} cx={x(p.day)} cy={y(p.brix)} r={2.6}>
                <title>{`Day ${fmt(p.day)}: ${fmt(p.brix)} °Bx${p.must != null ? `, must ${p.must} °F` : ''}${p.cap != null ? `, cap ${p.cap} °F` : ''}`}</title>
              </circle>
            ))}
            {last && (
              <>
                <circle className="current-end" cx={x(last.day)} cy={y(last.brix)} r={5} />
                <text className="current-label" x={x(last.day) + dx} y={currentLabelY} textAnchor={anchor}>{fmt(last.brix)} °Bx</text>
              </>
            )}
          </g>
        )}
      </svg>
      <figcaption className="legend">
        <span className="key key-current">{vintage}</span>
        {priors.map((p, i) => <span key={p.vintage} className={`key key-prior-${i}`}>{p.vintage}, same block</span>)}
        {hasTemps && <><span className="key key-must">Must °F</span><span className="key key-cap">Cap °F</span></>}
      </figcaption>
    </figure>
  );
}
