-- Harvest Brain schema. One SQLite file you own: data/harvest-brain.db

CREATE TABLE IF NOT EXISTS batches (
  id                INTEGER PRIMARY KEY,
  vintage           INTEGER NOT NULL,
  varietal          TEXT NOT NULL,
  color             TEXT NOT NULL DEFAULT 'red' CHECK (color IN ('red', 'white', 'rose')),
  vineyard          TEXT,
  block             TEXT,
  lineage           TEXT,   -- same block + varietal across vintages, e.g. 'slh-block-3-pinot-noir'
  facility          TEXT,   -- where it's made: home cellar, custom crush, winery
  vessel            TEXT,
  volume_l          REAL,
  phase             TEXT NOT NULL DEFAULT 'af'
                    CHECK (phase IN ('pre_harvest', 'cold_soak', 'af', 'pressed', 'mlf', 'aging', 'bottled')),
  harvest_date      TEXT,
  tons              REAL,
  brix_at_pick      REAL,
  ph_at_pick        REAL,
  ta_at_pick        REAL,
  yan_at_pick       REAL,
  whole_cluster_pct REAL,
  yeast             TEXT,
  inoculated_at     TEXT,
  pressed_at        TEXT,
  ml_strain         TEXT,
  ml_inoculated_at  TEXT,
  ml_completed_at   TEXT,
  bottled_at        TEXT,
  notes             TEXT,
  archived          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_batches_lineage ON batches (lineage, vintage);

-- Timestamps are local wall-clock time: 'YYYY-MM-DDTHH:MM'
CREATE TABLE IF NOT EXISTS readings (
  id          INTEGER PRIMARY KEY,
  batch_id    INTEGER NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  taken_at    TEXT NOT NULL,
  brix        REAL,
  must_temp_f REAL,   -- must or wine temperature
  cap_temp_f  REAL,   -- cap temperature (reds on skins)
  ph          REAL,
  ta          REAL,   -- g/L
  free_so2    REAL,   -- mg/L
  total_so2   REAL,
  malic       REAL,   -- g/L
  ml_chroma   TEXT CHECK (ml_chroma IS NULL OR ml_chroma IN ('present', 'faint', 'absent')),
  yan         REAL,   -- mg N/L
  va          REAL,   -- g/L acetic
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_readings_batch ON readings (batch_id, taken_at);

CREATE TABLE IF NOT EXISTS additions (
  id          INTEGER PRIMARY KEY,
  batch_id    INTEGER NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  added_at    TEXT NOT NULL,
  kind        TEXT NOT NULL
              CHECK (kind IN ('so2', 'nutrient', 'yeast', 'ml_bacteria', 'acid', 'tannin', 'enzyme', 'water', 'other')),
  product     TEXT,
  amount      REAL,
  unit        TEXT,
  so2_ppm     REAL,   -- SO2 additions: ppm added
  reason      TEXT,   -- crush | post_ferment | post_mlf | racking | topping | pre_bottling | stuck | other
  ph_at_add   REAL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_additions_batch ON additions (batch_id, added_at);

CREATE TABLE IF NOT EXISTS journal (
  id          INTEGER PRIMARY KEY,
  entry_date  TEXT NOT NULL,   -- 'YYYY-MM-DD'
  batch_id    INTEGER REFERENCES batches (id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  weather     TEXT,            -- comma list: fog,sun,heat,wind,rain,smoke
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal (entry_date);

CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY,
  batch_id    INTEGER REFERENCES batches (id) ON DELETE CASCADE,
  decided_at  TEXT NOT NULL,
  decision    TEXT NOT NULL,
  rationale   TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',   -- manual | brain
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS brain_messages (
  id          INTEGER PRIMARY KEY,
  batch_id    INTEGER REFERENCES batches (id) ON DELETE CASCADE,   -- NULL = whole-cellar thread
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  engine      TEXT,   -- 'claude:<model>' or 'rules'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
