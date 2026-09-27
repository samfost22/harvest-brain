// Starts the local API (and serves the built app in production).
//   npm run dev  -> API on :8787 + Vite on :5173
//   npm start    -> everything on :8787 after `npm run build`
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // No .env file: fine. Brain answers from the built-in rules.
}

const { getDb, closeDb, count, DB_PATH } = await import('./db.js');
const { handleApi } = await import('./api.js');
const { seedDemo } = await import('./seed.js');
const { engineName } = await import('./brain.js');

getDb();
if (!process.env.HB_NO_SEED && count('batches') === 0) {
  seedDemo();
  console.log('Empty cellar: seeded the demo. Run `npm run fresh` to start clean.');
}

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const dist = path.join(root, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function serveStatic(req, res) {
  if (!fs.existsSync(dist)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Harvest Brain API is running. For the app, use `npm run dev` and open http://localhost:5173, or run `npm run build` first.');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }
  let file = path.resolve(dist, `.${pathname}`);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  const type = MIME[path.extname(file)] ?? 'application/octet-stream';
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  fs.createReadStream(file).pipe(res);
}

const server = http
  .createServer((req, res) => (req.url.startsWith('/api/') ? handleApi(req, res) : serveStatic(req, res)))
  .listen(PORT, HOST, () => {
    console.log(`Harvest Brain API  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${server.address().port}`);
    console.log(`Database           ${DB_PATH}`);
    console.log(`Brain engine       ${engineName() === 'rules' ? 'built-in rules (add ANTHROPIC_API_KEY to .env for Claude)' : engineName()}`);
  });

// Close the database on Ctrl-C (and on each `node --watch` restart) so SQLite folds its write-ahead log
// back into data/harvest-brain.db and the file on disk is complete.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close();
    closeDb();
    process.exit(0);
  });
}
