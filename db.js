// SQLite database setup using better-sqlite3 (synchronous, fast, zero external server).
const Database = require('better-sqlite3');
const path = require('path');

// The database lives in a single file next to the app. Delete it to reset.
// DATABASE_PATH overrides the location (tests use ':memory:' for an isolated,
// throwaway database that never touches the real data.db).
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');
const db = new Database(dbPath);

// Recommended pragmas for local dev: WAL mode for better concurrency, enforce FKs.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema. The heart of a radio station site is its track history: what is playing
// now and what played recently. Add more tables (shows, schedule, etc.) here.
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    artist       TEXT NOT NULL,
    album        TEXT,
    artwork_url  TEXT,
    duration_sec INTEGER,
    is_current   INTEGER NOT NULL DEFAULT 0,
    played_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tracks_played_at ON tracks (played_at DESC);

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Song ratings: one thumbs up (+1) / down (-1) per listener per track.
  -- The UNIQUE constraint is what stops a listener rating the same song twice;
  -- listener_id is an anonymous id the browser stores in localStorage.
  CREATE TABLE IF NOT EXISTS ratings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    listener_id TEXT NOT NULL,
    value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (track_id, listener_id)
  );

  CREATE INDEX IF NOT EXISTS idx_ratings_track ON ratings (track_id);
`);

module.exports = db;
