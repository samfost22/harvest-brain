// Starts a throwaway API server on a free port with its own database.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-server-'));
  const child = spawn(process.execPath, [path.join(root, 'server/start.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', HB_DB: path.join(dir, 'test.db'), ANTHROPIC_API_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${log}`)), 10_000);
    const onData = d => {
      log += d;
      const m = log.match(/Harvest Brain API\s+http:\/\/[^\s]+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited with ${code}:\n${log}`)); });
  });
  return { base: `http://127.0.0.1:${port}`, dir, stop: () => child.kill(), log: () => log };
}
