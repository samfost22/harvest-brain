# Harvest Brain

A local-first cellar journal and fermentation decision engine for winemakers.

Log readings by voice or one typed line. See what needs you today. Compare this ferment against the same block in earlier vintages, day by day. Ask questions answered from your own records.

Your data is one SQLite file on your own machine: `data/harvest-brain.db`.

## Run it

Needs Node 22.13 or newer; Node 24 LTS is recommended (`.nvmrc` pins it for nvm and fnm). Check with `node --version`.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The first start loads a demo cellar dated to today, so the harvest always looks live.

| Command | What it does |
|---|---|
| `npm run dev` | API on port 8787 plus the app on 5173; reloads when you save a file |
| `npm run dev:lan` | Same, reachable from a phone on the same Wi-Fi (see below) |
| `npm run build`, then `npm start` | One server on 8787 serving the built app |
| `npm run seed` | Wipe and reload the demo cellar, dated to today (saves a backup of what was there first) |
| `npm run fresh` | Wipe to an empty cellar for your own batches (saves a backup first) |
| `npm run backup` | Copy the whole cellar to `data/backups/`; safe while the app is running |
| `npm test` | 64 tests: chemistry, parser, decision engine, API, database, Brain against a stand-in Claude API, and a headless click-through of every screen |
| `npm run lint` | ESLint, including React's hooks rules |
| `npm run check` | Lint, test and build: what CI runs on every push |

## Claude (optional)

Without a key, Brain answers from the built-in rules: vintage comparisons, stuck ferments, SO₂ additions, nutrients, MLF, spoilage, and press timing.

For open-ended answers, add a key:

```bash
cp .env.example .env
# then set ANTHROPIC_API_KEY=... in .env (HB_MODEL defaults to claude-sonnet-5)
```

When you ask about a batch, Brain sends Claude that batch's readings, additions, journal notes, decisions and earlier vintages, plus a one-line summary of the other active batches. Nothing else leaves your machine. Those records are cached between follow-up questions, so a conversation about one batch costs less after the first question. If Claude is overloaded Brain retries once; if the call still fails, Brain answers from the rules and says why.

## How it works

**Lineage.** Every batch can carry a lineage: the same block and varietal across vintages, such as `slh-block-3-pinot-noir`. Give each year's lot the same lineage and the batch chart overlays the earlier vintages, marks where each one stood on the same day, and raises an alert when this year falls behind.

**Logging.** Type or say "brix 12.4, cap 88, must 82" and the fields fill in. Short forms work too: "b 12.4 c 88 m 82". Logging a yeast addition marks inoculation. Logging ML bacteria starts malolactic, unless the ferment still has sugar (above 2 °Bx): that's co-inoculation, and the batch stays in primary so its fermentation alerts keep running.

**Decisions.** Save any Brain answer as a dated decision on the batch, so next vintage knows what you did and why.

**Your data.** The download icon in the top bar (or `/api/export`) gives every record as one JSON file. To back up the database itself, run `npm run backup`: it writes a complete copy to `data/backups/`, even while the app is running. Don't copy `data/harvest-brain.db` by hand while the app runs; recent changes may still be in the `-wal` file beside it.

**Upgrades.** The database records its schema version. A newer release upgrades an older data file in place the first time it starts, and an older release refuses to open a file written by a newer one rather than damage it.

## Alert rules

Every threshold lives in `shared/rules.js`. They are common cellar rules of thumb, not lab standards. Tune them to your wines.

| Alert | Default trigger |
|---|---|
| Behind last vintage | Sugar drop at least 15% less than the same block's prior vintage at the same day; 25% or more is "act now" |
| Slowing | Under 1.0 °Bx/day for reds (0.5 for whites and rosé) while above 5 °Bx |
| Stuck | Under 0.3 °Bx/day over about 48 hours while above dry |
| Cap temperature | Cap at 90 °F or more, or 10 °F or more above the must; 95 °F is "act now" |
| Nutrients | YAN at pick below about 150 mg/L plus 25 per °Bx above 21: first feeding due, second at one-third sugar, skip DAP past half |
| Malolactic | Wine under 64 °F; malic down less than 0.2 g/L in 10 days; done at 0.1 g/L or when the paper spot is gone; SO₂ added during MLF |
| SO₂ while aging | Molecular below 0.5 mg/L for reds or 0.8 for whites and rosé, with the ppm and grams of KMBS for the lot's volume; a check every 30 days |
| Spoilage | VA at 0.6 g/L to watch, 0.9 to act; Brett words in the journal (barnyard, band-aid, medicinal, mousy); pH 3.65 or higher with low molecular SO₂ |
| Stale readings | Nothing logged for 30 hours during primary |

Molecular SO₂ = free SO₂ ÷ (1 + 10^(pH − 1.81)). KMBS is 57.6% SO₂ by weight. Re-test free SO₂ 24 hours after an addition; some of it binds, more in reds.

## Using it from your phone

Run `npm run dev:lan`, then open `http://<your computer's IP>:5173` (or `http://<computer-name>.local:5173`) on the phone. There is no login, so do this only on a network you trust.

The app answers only to localhost, IP addresses and `.local` names, and only accepts JSON writes. That stops a web page you visit from reading or writing your cellar through your browser. If you reach it by another name, such as a Tailscale host, add that name to `HB_ALLOWED_HOSTS` in `.env`.

Browsers only allow the microphone on secure pages, so over plain Wi-Fi the mic buttons are hidden on the phone; typing the quick line still works. On the computer at localhost, voice works. Voice recognition runs through the browser's speech service (Google in Chrome, Apple in Safari).

## Layout

```
server/   node:http API, SQLite access and schema versions, decision engine (analysis.js), Brain, demo seed, backup
shared/   chemistry, alert rules, quick-entry parser, curve and time helpers (used by both server and app)
src/      React app: Today, Batch, Log, Journal, Brain
tests/    node:test suites, including a jsdom click-through of every screen
```

## Known limits and next steps

- One user, no login, °F and US units only.
- Next: photo import of handwritten lab sheets (Claude vision), dismiss and snooze for alerts, Tilt/RAPT/iSpindel import, an MCP server so Claude Desktop can query the cellar, HTTPS so voice works on a phone, and optional sync (libSQL/Turso or Supabase).
