import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickEntry } from '../shared/parse.js';

const cases = [
  ['brix 12.4, cap 88, must 82', { brix: 12.4, cap_temp_f: 88, must_temp_f: 82 }],
  ['b 12.4 c 88 m 82', { brix: 12.4, cap_temp_f: 88, must_temp_f: 82 }],
  ['Cap 88 degrees brix 12.4', { cap_temp_f: 88, brix: 12.4 }],
  ['12.4 brix', { brix: 12.4 }],
  ['12,4 brix', { brix: 12.4 }],
  ['Brix minus 1.2', { brix: -1.2 }],
  ['free SO2 24, total SO2 88, pH 3.52', { free_so2: 24, total_so2: 88, ph: 3.52 }],
  ['S02 30 pH 3.4', { free_so2: 30, ph: 3.4 }],
  ['FSO₂ 22', { free_so2: 22 }],
  ['malic 0.4 wine temp 66', { malic: 0.4, must_temp_f: 66 }],
  ['TA 6.1 VA 0.45 YAN 180', { ta: 6.1, va: 0.45, yan: 180 }],
  ['malic spot gone', { ml_chroma: 'absent' }],
  ['Punched down twice, smells great', {}],
];

for (const [input, expected] of cases) {
  test(`parses "${input}"`, () => {
    assert.deepEqual(parseQuickEntry(input).values, expected);
  });
}

test('empty input is safe', () => {
  assert.deepEqual(parseQuickEntry(''), { values: {}, found: [] });
  assert.deepEqual(parseQuickEntry(null), { values: {}, found: [] });
});
