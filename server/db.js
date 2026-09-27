// SQLite through Node's built-in node:sqlite: no native build step, one file on disk you own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localStamp } from '../shared/time.js';

// node:sqlite prints a one-time "experimental" warning on load. It's solid for a local app, so hide it.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) =>
  String(warning?.message ?? warning).includes('SQLite') ? undefined : emitWarning.call(process, warning, ...rest);
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = emitWarning;

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.HB_DB || path.join(here, '..', 'data', 'harvest-brain.db');

// Schema versions, tracked in SQLite's user_version. schema.sql is version 1. To change the schema,
// append a function here; never edit one that has shipped. Each runs once, in order, in a transaction,
// so a data file from any earlier release upgrades itself on the next start.
const MIGRATIONS = [
  d => d.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8')),
];
export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(d) {
  const current = d.prepare('PRAGMA user_version').get().user_version;
  if (current > SCHEMA_VERSION) {
    throw new Error(`${DB_PATH} was written by a newer Harvest Brain (schema ${current}, this app knows ${SCHEMA_VERSION}). Update the app before opening it.`);
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    d.exec('BEGIN');
    try {
      MIGRATIONS[v](d);
      d.exec(`PRAGMA user_version = ${v + 1}`);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  }
}

let db;
export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
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

/**
 * Writes a consistent copy of the whole cellar to data/backups/ and returns its path. Safe while the
 * app is running: VACUUM INTO reads one snapshot, including anything still in the write-ahead log.
 */
export function backup(label = 'backup') {
  const dir = path.join(path.dirname(DB_PATH), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const when = localStamp().replace(/[:T]/g, '-');
  let file = path.join(dir, `harvest-brain-${when}-${label}.db`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `harvest-brain-${when}-${label}-${n}.db`);
  getDb().exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  return file;
}
