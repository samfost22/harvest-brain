// SQLite through Node's built-in node:sqlite: no native build step, one file on disk you own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite prints a one-time "experimental" warning on load. It's solid for a local app, so hide it.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) =>
  String(warning?.message ?? warning).includes('SQLite') ? undefined : emitWarning.call(process, warning, ...rest);
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = emitWarning;

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.HB_DB || path.join(here, '..', 'data', 'harvest-brain.db');

let db;
export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

// node:sqlite rejects undefined and booleans; normalize params. Rows come back null-prototype; copy them.
const clean = params => params.map(v => (v === undefined || v === '' ? null : typeof v === 'boolean' ? Number(v) : v));
export const all = (sql, ...p) => getDb().prepare(sql).all(...clean(p)).map(r => ({ ...r }));
export const get = (sql, ...p) => {
  const row = getDb().prepare(sql).get(...clean(p));
  return row ? { ...row } : null;
};
export const run = (sql, ...p) => getDb().prepare(sql).run(...clean(p));
export const count = table => get(`SELECT COUNT(*) AS n FROM ${table}`).n;

export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export function closeDb() {
  db?.close();
  db = undefined;
}
