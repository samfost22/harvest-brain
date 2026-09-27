// Clicks through every screen in a headless DOM with React's development warnings on.
// Any render crash, failed request, or React warning fails the test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.NODE_ENV = 'development';
const { build } = await import('vite');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-ui-'));
await build({ root, mode: 'development', logLevel: 'silent', build: { outDir, minify: false, emptyOutDir: true } });
const bundle = fs.readdirSync(path.join(outDir, 'assets')).find(f => f.endsWith('.js'));

const server = await startServer(8792);
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html data-theme="day"><body><div id="root"></div></body></html>', { url: `${server.base}/`, pretendToBeVisual: true });
const { window } = dom;
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) {
    try { globalThis[key] = window[key]; } catch { /* read-only */ }
  }
}
const nodeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => nodeFetch(new URL(input, server.base), init);

const errors = [];
const consoleError = console.error;
console.error = (...args) => errors.push(args.map(String).join(' '));
after(() => {
  console.error = consoleError;
  server.stop();
  window.close();
});

await import(pathToFileURL(path.join(outDir, 'assets', bundle)).href);

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const enabled = el => (el && !el.disabled ? el : null);
const byText = (sel, re) => $$(sel).find(el => re.test(el.textContent.trim()));
async function waitFor(check, label, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = check();
    if (v) return v;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${label}. Errors: ${errors.join(' | ')}\nPage: ${document.body.textContent.slice(0, 800)}`);
}
function setValue(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype
    : el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event(el instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

test('Today shows what needs attention and the cellar table', async () => {
  await waitFor(() => byText('h2', /^Needs you$/), 'Today');
  assert.ok(byText('.alert-title', /behind \d{4} at day/));
  assert.equal($$('.cellar-table tbody tr').length, 6);
});

test('Batch view draws this vintage against earlier vintages of the block', async () => {
  byText('.tab', /Batches/).click();
  await waitFor(() => $('.chart svg .current path'), 'chart');
  assert.equal($$('.chart .prior').length, 2);
  assert.match($('.stepper .current').textContent, /Primary/);
  assert.ok($$('.data-table tbody tr').length > 5);
  byText('.rail-item', /Grenache Rosé/).click();
  await waitFor(() => byText('h1', /Grenache Rosé/), 'rosé page');
  assert.ok(byText('.stat-label', /Molecular SO₂/));
  assert.ok(byText('.alert-title', /Molecular SO₂ 0\.40/));
});

test('Log fills fields from one spoken or typed line, calculates SO₂, and saves', async () => {
  byText('.tab', /^Log$/).click();
  const quick = await waitFor(() => $('.quick input'), 'quick entry');
  // Log opens on the batch you were viewing (the rosé); switch to the fermenting Pinot.
  setValue(byText('.log-top .field', /^Batch/).querySelector('select'), '1');
  await waitFor(() => /primary/i.test($('.fields legend').textContent), 'primary fields');
  setValue(quick, 'brix 10.2 cap 91 must 84');
  await waitFor(() => /Filled Brix, Cap temp, Must temp/.test($('.quick-status').textContent), 'filled status');
  assert.equal(byText('.field-big', /^Brix/).querySelector('input').value, '10.2');
  byText('button.link', /SO₂ calculator/).click();
  await waitFor(() => $('.calc-out'), 'calculator result');
  byText('button', /^Save entry$/).click();
  await waitFor(() => byText('h2', /^Saved to \d{4} Pinot Noir$/), 'save confirmation');
});

test('Journal saves an entry and shows the day\'s readings beside it', async () => {
  byText('.tab', /Journal/).click();
  const page = await waitFor(() => $('textarea.page'), 'journal composer');
  byText('.chip', /^Fog$/).click();
  setValue(page, 'Fog burned off by ten. Picked the Grenache.');
  byText('button', /^Save entry$/).click();
  await waitFor(() => byText('.entry p', /Fog burned off by ten/), 'saved entry');
  assert.ok(byText('.day-readings li', /Pinot Noir/));
});

test('Brain answers from the records and saves a decision', async () => {
  byText('.tab', /Brain/).click();
  (await waitFor(() => enabled(byText('.chip', /What needs attention today/)), 'cellar suggestions')).click();
  await waitFor(() => byText('.msg-assistant', /In priority order/), 'cellar answer');
  setValue(byText('.brain-head .field', /Asking about/).querySelector('select'), '1');
  (await waitFor(() => enabled(byText('.chip', /Compare this ferment/)), 'batch suggestions')).click();
  await waitFor(() => byText('.msg-assistant', /behind/), 'comparison answer');
  assert.equal($$('.msg').length, 2, 'only this batch\'s thread is on screen');
  byText('button.link', /Save as decision/).click();
  await waitFor(() => $('.pin-form'), 'decision form');
  byText('button', /^Save decision$/).click();
  await waitFor(() => byText('.toast', /Decision saved to \d{4} Pinot Noir/), 'decision toast');
});

test('Night theme toggles', async () => {
  $('button[aria-label="Switch to night theme"]').click();
  await waitFor(() => document.documentElement.dataset.theme === 'night', 'night theme');
});

test('New batch links to a lineage and opens the new batch', async () => {
  byText('button', /New batch/).click();
  const dialog = await waitFor(() => $('dialog.dialog[open]') ?? $('dialog.dialog'), 'dialog');
  setValue(byText('.dialog .field', /^Varietal/).querySelector('input'), 'Grenache');
  setValue(byText('.dialog .field', /^Vineyard/).querySelector('input'), 'Arroyo Seco');
  setValue(byText('.dialog .field', /^Block/).querySelector('input'), 'Block 11');
  await waitFor(() => /New lineage: arroyo-seco-block-11-grenache/.test(dialog.textContent), 'lineage hint');
  byText('.dialog button', /^Create batch$/).click();
  await waitFor(() => byText('h1', /^\d{4} Grenache$/), 'new batch page');
});

test('no React warnings, runtime errors, or error screens', () => {
  const real = errors.filter(e => !/Not implemented/.test(e));
  assert.deepEqual(real, []);
  assert.doesNotMatch(document.body.textContent, /hit an error/);
});
