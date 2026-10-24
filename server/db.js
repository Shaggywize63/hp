'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// Storage locations default to ./data and ./uploads, but can be pointed at a
// persistent directory via env (e.g. on Hostinger Web Apps / managed hosts) so
// the database and uploaded videos survive redeploys.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '..', 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
  org           TEXT NOT NULL DEFAULT 'HP',      -- 'HP' | 'Arc WW' | 'Kinematic'
  can_upload    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    INTEGER
);

CREATE TABLE IF NOT EXISTS videos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code_name     TEXT NOT NULL,
  product_name  TEXT,
  country       TEXT,
  bg_colour     TEXT,
  ratio         TEXT,
  processor     TEXT,
  ksp1          TEXT, ksp2 TEXT, ksp3 TEXT,
  warranty      TEXT, ms_office TEXT, promo TEXT,
  briefing_date TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | under_review | completed | finalized
  created_by    INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id      INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                  -- 'working' | 'final'
  version_label TEXT,
  stored_name   TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime          TEXT,
  size          INTEGER,
  uploaded_by   INTEGER,
  uploaded_name TEXT,
  uploaded_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author_id   INTEGER,
  author_name TEXT,
  party       TEXT NOT NULL,                    -- 'HP' | 'Arc WW' | 'Kinematic'
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    INTEGER,
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_video   ON assets(video_id);
CREATE INDEX IF NOT EXISTS idx_feedback_video ON feedback(video_id);
CREATE INDEX IF NOT EXISTS idx_logs_video     ON logs(video_id);
`);

const nowIso = () => new Date().toISOString();

// ---- Seed master admin -----------------------------------------------------
const MASTER_EMAIL = 's@kinematicapp.com';
const MASTER_PASSWORD = 'Manvik@1221';

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(MASTER_EMAIL);
  if (existing) return;
  db.prepare(
    `INSERT INTO users (email, name, password_hash, role, org, can_upload, active, created_at)
     VALUES (?, ?, ?, 'admin', 'Kinematic', 1, 1, ?)`
  ).run(MASTER_EMAIL, 'Master Admin', bcrypt.hashSync(MASTER_PASSWORD, 10), nowIso());
  console.log(`[seed] master admin created: ${MASTER_EMAIL}`);
}

// ---- Seed screensaver projects from the master sheet -----------------------
function parseSheetDate(s) {
  // sheet dates look like "15.09.2026" -> ISO date string
  if (!s) return '';
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return String(s).trim();
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function seedVideos() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM videos').get().c;
  if (count > 0) return;
  let seed = [];
  try {
    seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8'));
  } catch (e) {
    console.warn('[seed] seed-data.json not found, skipping video seed');
    return;
  }
  const insert = db.prepare(
    `INSERT INTO videos
       (code_name, product_name, country, bg_colour, ratio, processor,
        ksp1, ksp2, ksp3, warranty, ms_office, promo, briefing_date,
        status, created_by, created_at, updated_at)
     VALUES
       (@code_name, @product_name, @country, @bg_colour, @ratio, @processor,
        @ksp1, @ksp2, @ksp3, @warranty, @ms_office, @promo, @briefing_date,
        'pending', NULL, @created_at, @updated_at)`
  );
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      // a code name cell can contain two codes on separate lines
      const codeName = String(r.code_name || '').split('\n').map((s) => s.trim()).filter(Boolean).join(' / ');
      insert.run({
        code_name: codeName,
        product_name: r.product_name || '',
        country: r.country || '',
        bg_colour: r.bg_colour || '',
        ratio: r.ratio || '',
        processor: r.processor || '',
        ksp1: r.ksp1 || '',
        ksp2: r.ksp2 || '',
        ksp3: r.ksp3 || '',
        warranty: r.warranty || '',
        ms_office: r.ms_office || '',
        promo: r.promo || '',
        briefing_date: parseSheetDate(r.briefing_date),
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  });
  tx(seed);
  console.log(`[seed] ${seed.length} screensaver projects imported from master sheet`);
}

seedAdmin();
seedVideos();

module.exports = { db, nowIso, UPLOAD_DIR, MASTER_EMAIL };
