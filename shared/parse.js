// Turns a spoken or typed line into readings:
//   "brix 12.4, cap 88, must 82, pH 3.52"  ->  { brix: 12.4, cap_temp_f: 88, must_temp_f: 82, ph: 3.52 }
// Short forms work too: "b 12.4 c 88 m 82". Order doesn't matter.

const N = '(-?\\d+(?:\\.\\d+)?)';
const SO2 = '(?:so2|so 2|s o 2|sulfur|sulphur)';

// Order matters: specific patterns run first and consume their text.
const PATTERNS = [
  ['total_so2', new RegExp(`\\b(?:total ${SO2}|tso2|t so2)\\s*[:=]?\\s*${N}`)],
  ['free_so2', new RegExp(`\\b(?:free ${SO2}|fso2|f so2)\\s*[:=]?\\s*${N}`)],
  ['free_so2', new RegExp(`\\b${SO2}\\s*[:=]?\\s*${N}`)],
  ['brix', new RegExp(`\\b(?:brix|bx|b)\\s*[:=]?\\s*${N}`)],
  ['brix', new RegExp(`${N}\\s*°?\\s*(?:brix|bx)\\b`)],
  ['cap_temp_f', new RegExp(`\\b(?:cap(?: temp(?:erature)?)?|c)\\s*[:=]?\\s*${N}`)],
  ['must_temp_f', new RegExp(`\\b(?:must|tank|juice|wine)(?: temp(?:erature)?)?\\s*[:=]?\\s*${N}`)],
  ['must_temp_f', new RegExp(`\\b(?:temp(?:erature)?|m)\\s*[:=]?\\s*${N}`)],
  ['ph', new RegExp(`\\bph\\s*[:=]?\\s*${N}`)],
  ['ta', new RegExp(`\\b(?:ta|titratable acidity)\\s*[:=]?\\s*${N}`)],
  ['malic', new RegExp(`\\bmalic(?: acid)?\\s*[:=]?\\s*${N}`)],
  ['va', new RegExp(`\\b(?:va|volatile acidity)\\s*[:=]?\\s*${N}`)],
  ['yan', new RegExp(`\\byan\\s*[:=]?\\s*${N}`)],
];

const CHROMA = [
  ['absent', /\bmalic(?: spot)? (?:gone|absent|clear|done)\b|\bspot (?:gone|absent)\b/],
  ['faint', /\bmalic(?: spot)? faint\b|\bfaint (?:malic )?spot\b/],
  ['present', /\bmalic(?: spot)? (?:present|still there|strong)\b/],
];

function normalize(text) {
  return ` ${text} `
    .toLowerCase()
    .replace(/₂/g, '2')
    .replace(/\bs0\s*2\b/g, 'so2')                 // "S02" typed with a zero
    .replace(/\b(?:minus|negative)\s+(?=\d)/g, '-')
    .replace(/(\d)\s*(?:°\s*f|degrees(?: f(?:ahrenheit)?)?)\b/g, '$1')
    .replace(/(\d),(\d)/g, '$1.$2')                 // "12,4" -> "12.4"
    .replace(/[;,]/g, ' ')
    .replace(/\s+/g, ' ');
}

export function parseQuickEntry(text) {
  if (!text || !text.trim()) return { values: {}, found: [] };
  let s = normalize(text);
  const values = {};
  const found = [];
  for (const [key, re] of PATTERNS) {
    if (values[key] != null) continue;
    const m = s.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    values[key] = n;
    found.push(key);
    s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length);
  }
  for (const [value, re] of CHROMA) {
    if (re.test(s)) { values.ml_chroma = value; found.push('ml_chroma'); break; }
  }
  return { values, found };
}
