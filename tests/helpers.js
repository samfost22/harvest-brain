// Starts a throwaway API server on its own port and database.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startServer(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-server-'));
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', HB_DB: path.join(dir, 'test.db'), ANTHROPIC_API_KEY: '' };
  const child = spawn(process.execPath, [path.join(root, 'server/start.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return { base, stop: () => child.kill(), log: () => log };
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 50));
  }
  child.kill();
  throw new Error(`Server did not start:\n${log}`);
}
