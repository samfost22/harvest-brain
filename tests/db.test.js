// Schema versions, backups, and the safety copy before a wipe. Each case runs in its own process
// because the database module opens one file per process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hb-db-')), 'cellar.db');
const node = (file, args, dbPath) =>
  execFileSync(process.execPath, [path.join(root, file), ...args], { env: { ...process.env, HB_DB: dbPath }, encoding: 'utf8', stdio: 'pipe' });
const script = (code, dbPath) =>
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: { ...process.env, HB_DB: dbPath }, encoding: 'utf8', stdio: 'pipe' });
const { DatabaseSync } = await import('node:sqlite');

test('a new database is created at the current schema version', () => {
  const db = tmp();
  const out = script("import { getDb, SCHEMA_VERSION } from './server/db.js'; console.log(getDb().prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);", db);
  const [version, expected] = out.trim().split(' ').map(Number);
  assert.equal(version, expected);
  assert.ok(version >= 1);
});

test('a data file from v0.7 (no schema version) upgrades in place and keeps its records', () => {
  const db = tmp();
  const legacy = new DatabaseSync(db);
  legacy.exec(fs.readFileSync(path.join(root, 'server/schema.sql'), 'utf8'));
  legacy.exec("INSERT INTO batches (vintage, varietal) VALUES (2025, 'Syrah')");
  legacy.close();
  const out = script("import { getDb, count } from './server/db.js'; console.log(getDb().prepare('PRAGMA user_version').get().user_version, count('batches'));", db);
  assert.deepEqual(out.trim().split(' ').map(Number), [1, 1]);
});

test('a data file from a newer release is refused rather than touched', () => {
  const db = tmp();
  const newer = new DatabaseSync(db);
  newer.exec('PRAGMA user_version = 999');
  newer.close();
  assert.throws(() => script("import { getDb } from './server/db.js'; getDb();", db), /written by a newer Harvest Brain/);
});

test('npm run backup writes a complete copy; seeding over a cellar saves one first', () => {
  const db = tmp();
  node('server/seed.js', ['--reset'], db);
  assert.equal(fs.existsSync(path.join(path.dirname(db), 'backups')), false, 'no copy of an empty cellar');

  const out = node('server/backup.js', [], db);
  const file = out.match(/to (.+\.db)/)[1];
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM batches').get().n, 7);
  assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM readings').get().n > 50);
  copy.close();

  const wiped = node('server/seed.js', ['--empty'], db);
  assert.match(wiped, /Saved a copy of the current cellar first: .+before-wipe\.db/);
  assert.equal(fs.readdirSync(path.join(path.dirname(db), 'backups')).length, 2);
});
