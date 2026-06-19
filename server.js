const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// We identify a voter by their network address so a vote counts once per
// machine/network regardless of which browser is used. `trust proxy` controls
// what req.ip resolves to: behind a reverse proxy set this so the *client* IP
// (not the proxy's) is used. Left off by default, req.ip is the unspoofable
// socket address — only enable proxy trust when a trusted proxy is in front.
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  // Accept "true"/"false", a hop count (e.g. "1"), or a subnet string.
  app.set('trust proxy', tp === 'true' ? true : tp === 'false' ? false : /^\d+$/.test(tp) ? Number(tp) : tp);
}

app.use(express.json());
// Serve the front-end from /public
app.use(express.static(path.join(__dirname, 'public')));

// Derive a stable, privacy-preserving voter id from the request's IP address.
// Hashing means we never store raw IPs. Because it's keyed on IP (not on any
// browser/localStorage value), the same machine votes only once across Chrome,
// Firefox, Edge, etc. Caveat: devices behind the same NAT/router/VPN share one
// public IP and therefore share a single vote.
function listenerIdFor(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return 'ip:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

// Prepared statements (compiled once, reused).
// Each track is returned with its total thumbs up/down counts (across all
// listeners), aggregated from the ratings table.
const RATING_COLS = `
  COALESCE(SUM(CASE WHEN r.value = 1 THEN 1 END), 0)  AS thumbs_up,
  COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 END), 0) AS thumbs_down`;
const getCurrent = db.prepare(`
  SELECT t.*, ${RATING_COLS}
  FROM tracks t LEFT JOIN ratings r ON r.track_id = t.id
  WHERE t.is_current = 1
  GROUP BY t.id
  ORDER BY t.played_at DESC LIMIT 1`);
const getRecent = db.prepare(`
  SELECT t.*, ${RATING_COLS}
  FROM tracks t LEFT JOIN ratings r ON r.track_id = t.id
  WHERE t.is_current = 0
  GROUP BY t.id
  ORDER BY t.played_at DESC LIMIT ?`);
const clearCurrent = db.prepare('UPDATE tracks SET is_current = 0 WHERE is_current = 1');
const insertTrack = db.prepare(
  `INSERT INTO tracks (title, artist, album, artwork_url, duration_sec, is_current)
   VALUES (@title, @artist, @album, @artwork_url, @duration_sec, 1)`
);

// Mark a new track as the current one in a single transaction so there is never
// more than one "current" track.
const playTrack = db.transaction((track) => {
  clearCurrent.run();
  const info = insertTrack.run(track);
  return info.lastInsertRowid;
});

// --- API ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// What's playing right now (or null if nothing has been queued yet).
app.get('/api/now-playing', (req, res) => {
  res.json(getCurrent.get() || null);
});

// Recently played tracks (most recent first), excluding the current one.
app.get('/api/tracks', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  res.json(getRecent.all(limit));
});

// Set the now-playing track (e.g. called by the stream/metadata source or admin).
app.post('/api/tracks', (req, res) => {
  const { title, artist, album, artwork_url, duration_sec } = req.body || {};
  if (!title || !artist) {
    return res.status(400).json({ error: 'title and artist are required' });
  }
  const id = playTrack({
    title,
    artist,
    album: album || null,
    artwork_url: artwork_url || null,
    duration_sec: duration_sec || null,
  });
  res.status(201).json(getCurrent.get());
});

// --- Ratings API (thumbs up / down) ---

const trackExists = db.prepare('SELECT 1 FROM tracks WHERE id = ?');
const upsertRating = db.prepare(
  `INSERT INTO ratings (track_id, listener_id, value)
   VALUES (@track_id, @listener_id, @value)
   ON CONFLICT (track_id, listener_id)
   DO UPDATE SET value = excluded.value, created_at = datetime('now')`
);
const removeRating = db.prepare('DELETE FROM ratings WHERE track_id = ? AND listener_id = ?');
const ratingCounts = db.prepare(
  `SELECT COALESCE(SUM(CASE WHEN value = 1 THEN 1 END), 0)  AS thumbs_up,
          COALESCE(SUM(CASE WHEN value = -1 THEN 1 END), 0) AS thumbs_down
   FROM ratings WHERE track_id = ?`
);
const myRatingForTrack = db.prepare('SELECT value FROM ratings WHERE track_id = ? AND listener_id = ?');
const myRatings = db.prepare('SELECT track_id, value FROM ratings WHERE listener_id = ?');

// The voter's own votes (keyed off their IP), as a { trackId: value } map, so
// the UI can show which way they voted — no client-supplied id needed.
app.get('/api/my-ratings', (req, res) => {
  const listenerId = listenerIdFor(req);
  const map = {};
  for (const row of myRatings.all(listenerId)) map[row.track_id] = row.value;
  res.json(map);
});

// Cast / change / retract a rating for a track. Body: { value }.
// value: 1 = thumbs up, -1 = thumbs down, 0 = retract. The voter is identified
// by IP (server-side), and the UNIQUE(track_id, listener_id) constraint means
// that machine is only ever counted once per song; re-voting — even from a
// different browser — updates its single rating rather than adding another.
app.post('/api/tracks/:id/ratings', (req, res) => {
  const trackId = parseInt(req.params.id, 10);
  if (!Number.isInteger(trackId) || !trackExists.get(trackId)) {
    return res.status(404).json({ error: 'Track not found' });
  }
  const listenerId = listenerIdFor(req);
  const { value } = req.body || {};
  if (![1, -1, 0].includes(value)) {
    return res.status(400).json({ error: 'value must be 1 (up), -1 (down) or 0 (retract)' });
  }

  if (value === 0) {
    removeRating.run(trackId, listenerId);
  } else {
    upsertRating.run({ track_id: trackId, listener_id: listenerId, value });
  }

  const counts = ratingCounts.get(trackId);
  const mine = myRatingForTrack.get(trackId, listenerId);
  res.json({ track_id: trackId, ...counts, mine: mine ? mine.value : 0 });
});

// --- Users API (CRUD) ---

const listUsers = db.prepare('SELECT * FROM users ORDER BY created_at DESC, id DESC');
const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUser = db.prepare(
  'INSERT INTO users (first_name, last_name, email) VALUES (@first_name, @last_name, @email)'
);
const updateUser = db.prepare(
  'UPDATE users SET first_name = @first_name, last_name = @last_name, email = @email WHERE id = @id'
);
const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');

// Validate + normalise the incoming user payload; returns { value } or { error }.
function parseUser(body) {
  const first_name = (body.first_name || '').trim();
  const last_name = (body.last_name || '').trim();
  const email = (body.email || '').trim();
  if (!first_name || !last_name || !email) {
    return { error: 'first_name, last_name and email are required' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'email is not valid' };
  }
  return { value: { first_name, last_name, email } };
}

app.get('/api/users', (req, res) => {
  res.json(listUsers.all());
});

app.post('/api/users', (req, res) => {
  const { value, error } = parseUser(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const info = insertUser.run(value);
    res.status(201).json(getUser.get(info.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    throw err;
  }
});

app.put('/api/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!getUser.get(id)) return res.status(404).json({ error: 'User not found' });
  const { value, error } = parseUser(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    updateUser.run({ ...value, id });
    res.json(getUser.get(id));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    throw err;
  }
});

app.delete('/api/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const info = deleteUser.run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
