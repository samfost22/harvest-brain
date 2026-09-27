# Harvest Brain

Local-first cellar journal and fermentation decision engine. Node 22.13+ (24 recommended), no build step on the server.

## Commands

- `npm run check`: lint, all tests, production build. Run it before every commit; CI runs the same on Node 22 and 24.
- `npm test`: node:test suites, run one file at a time (`--test-concurrency=1`). Single suite: `node --test tests/api.test.js`.
- `npm run dev`: API on 8787 plus Vite on 5173.

## Layout

- `server/`: plain `node:http` API (`api.js`), `node:sqlite` access (`db.js`), decision engine (`analysis.js`), Brain (`brain.js`, Claude via `@anthropic-ai/sdk` with a rules fallback), demo seed.
- `shared/`: pure functions imported by both server and browser: chemistry, alert thresholds (`rules.js`), quick-entry parser, curve and time helpers. Keep it free of Node and DOM APIs.
- `src/`: React 19 app, no router or state library; `App.jsx` owns view state and passes `onChanged` to trigger refetches.

## Conventions

- Timestamps are local wall-clock text, `YYYY-MM-DDTHH:MM`; bare dates are `YYYY-MM-DD` and read as noon. Validate with `parseStamp` from `shared/time.js`.
- Every alert threshold lives in `shared/rules.js`. Don't hard-code a number in the engine.
- Schema changes: append a function to `MIGRATIONS` in `server/db.js`. Never edit `schema.sql` or a shipped migration, since users' data files upgrade in place.
- API errors are plain-language messages meant for the UI. Throw `HttpError(status, message)`; SQLite constraint failures map to 400 automatically.
- Writes require `content-type: application/json` and a local Host header. That is the app's only protection, since there's no login, so keep both checks.
- The Brain must keep working offline: every Claude path falls back to `offlineAnswer`. Tests use a local stand-in for the Claude API (`tests/brain.test.js`); never call the real API from tests.
- Match the existing style: dense, 2-space, single quotes, plain-language copy written for someone standing in a cellar.

## Tests

- `tests/helpers.js` `startServer(env)` spawns a real server on a free port with a throwaway database.
- `tests/ui.test.js` builds the app with Vite and clicks through it in jsdom; any React warning fails it.
- `tests/engine.test.js` seeds the demo at a fixed date (Sep 26, 2026, 2 pm) so alert expectations are stable.
