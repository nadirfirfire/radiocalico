# Radio Calico — Project Guide (CLAUDE.md)

This file is the **basis for development** and a **reproduction blueprint**: it
describes what the project is, how it is built, and enough detail to recreate it
from scratch. Keep it up to date when the architecture, schema, API, or file
layout changes.

---

## 1. What this is

Radio Calico is a local prototype for a **lossless internet-radio website**. It
plays a live HLS audio stream, shows now-playing metadata + recently-played
history, lets listeners give each song a 👍/👎 rating, and includes a small
Users CRUD admin page. The look-and-feel follows the Radio Calico brand guide.

**Tech stack**
- **Runtime:** Node.js 22+ (CommonJS)
- **Web server / API:** [Express](https://expressjs.com/) 5 (`server.js`)
- **Database:** [SQLite](https://www.sqlite.org/) via
  [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — a single file
  (`data.db`), synchronous API, no separate DB server
- **Front-end:** plain static HTML/CSS/JS served from `public/` (no build step,
  no framework). HLS playback uses [hls.js](https://github.com/video-dev/hls.js)
  loaded from a CDN.
- **Dev reload:** [nodemon](https://github.com/remy/nodemon)

There is **no framework, bundler, or transpiler** — keep it that way unless
there's a strong reason. Front-end JS talks to the JSON API with `fetch`.

---

## 2. File structure

```
radiocalico/
├── CLAUDE.md            # This guide (development basis + reproduction blueprint)
├── README.md            # Short quickstart, points here
├── package.json         # Scripts + dependencies
├── package-lock.json
├── .npmrc               # Zscaler-safe CA bundle (see §9)
├── .gitignore           # Ignores node_modules/ and data.db*
├── server.js            # Express app: static hosting + JSON API + rating logic
├── db.js                # SQLite connection, pragmas, schema (CREATE TABLE IF NOT EXISTS)
├── seed.js              # Inserts sample tracks for local development
├── data.db              # SQLite database file (git-ignored, created on first run)
└── public/              # Static front-end (served at /)
    ├── index.html       # Home / player page (now-playing, rating, previous tracks)
    ├── app.js           # Home front-end: player, stations, ratings, 15s polling
    ├── styles.css       # All styling (brand palette); shared with the users page
    ├── logo.png         # Brand logo (copied from the style-guide assets)
    └── users/
        ├── index.html   # Users admin page markup
        └── users.js     # Users CRUD front-end
```

The brand assets and style guide live **outside** the repo at
`C:\nfirfire-assurant\AI\repo\RadioCalicoStyle` (see §7).

---

## 3. Run / develop

```sh
npm install        # first time (see §9 if behind Zscaler)
npm start          # production-style: node server.js
npm run dev        # auto-reload on changes via nodemon
node seed.js       # populate sample tracks so the page has content
```

Then open <http://localhost:3000>.

**Environment variables**
| Var          | Default | Purpose                                                                                 |
| ------------ | ------- | --------------------------------------------------------------------------------------- |
| `PORT`       | `3000`  | HTTP port (`PORT=4000 npm start`)                                                        |
| `TRUST_PROXY`| _unset_ | Express `trust proxy` setting. Set to `true` (or a hop count / subnet) **only** when running behind a trusted reverse proxy so `req.ip` is the real client IP. Accepts `true`/`false`/number/subnet string. Leave unset for direct/local runs. |

**Reset the database:** stop the server and delete `data.db`, `data.db-shm`,
`data.db-wal`. They are recreated on next start (schema) / `node seed.js` (data).

---

## 4. Database schema (`db.js`)

Pragmas: `journal_mode = WAL`, `foreign_keys = ON`. Schema is applied with
`CREATE TABLE IF NOT EXISTS` on every startup, so adding a table = edit `db.js`
and restart.

```sql
-- Track history: what is playing now (is_current = 1) and what played before.
CREATE TABLE tracks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  artist       TEXT NOT NULL,
  album        TEXT,
  artwork_url  TEXT,
  duration_sec INTEGER,
  is_current   INTEGER NOT NULL DEFAULT 0,
  played_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Song ratings: one thumbs up (+1) / down (-1) per listener per track.
-- The UNIQUE constraint is what stops a listener rating the same song twice.
CREATE TABLE ratings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  listener_id TEXT NOT NULL,
  value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (track_id, listener_id)
);
```

Only one track has `is_current = 1` at a time — `POST /api/tracks` clears the
old current and inserts the new one inside a transaction.

---

## 5. HTTP API (`server.js`)

All responses are JSON. Track responses include aggregate
`thumbs_up` / `thumbs_down` totals (across all listeners) via a `LEFT JOIN` on
`ratings`.

| Method | Route                       | Body / Query                                            | Description |
| ------ | --------------------------- | ------------------------------------------------------- | ----------- |
| GET    | `/api/health`               | —                                                       | `{ ok, time }` health check |
| GET    | `/api/now-playing`          | —                                                       | Current track (with rating totals) or `null` |
| GET    | `/api/tracks`               | `?limit=` (default 20, max 100)                         | Recently played, newest first (with rating totals) |
| POST   | `/api/tracks`               | `{title, artist, album?, artwork_url?, duration_sec?}`  | Set the now-playing track; promotes it to current and moves the previous one to history |
| GET    | `/api/my-ratings`           | — (voter derived from IP)                               | This machine's votes as `{ trackId: 1 \| -1 }` |
| POST   | `/api/tracks/:id/ratings`   | `{ value }` where value ∈ `1` (up), `-1` (down), `0` (retract) | Cast/change/retract a rating; returns `{ track_id, thumbs_up, thumbs_down, mine }` |
| GET    | `/api/users`                | —                                                       | List users, newest first |
| POST   | `/api/users`                | `{first_name, last_name, email}`                        | Create user (email required, validated, unique case-insensitive) |
| PUT    | `/api/users/:id`            | `{first_name, last_name, email}`                        | Update user |
| DELETE | `/api/users/:id`            | —                                                       | Delete user |

Prepared statements are compiled once at module load and reused. Unique-email
collisions return `409`; validation errors return `400`.

---

## 6. Song ratings & voter identity (key design decision)

Listeners rate the **current song** and any song in the **previous-tracks** list
with 👍/👎. Totals across all listeners are shown next to each.

**One vote per listener, enforced two ways:**
1. The DB `UNIQUE(track_id, listener_id)` constraint — a listener can never have
   more than one row per track. Re-voting is an upsert
   (`ON CONFLICT ... DO UPDATE`), so changing 👍↔👎 updates the single row;
   value `0` deletes it (retract). They are never counted twice.
2. The `listener_id` is **derived server-side from the client IP**, not from the
   browser: `listenerIdFor(req)` hashes `req.ip` (SHA-256, truncated, prefixed
   `ip:`). The client sends **no id**. This makes a vote count once per
   machine/network **regardless of which browser** is used.

**Known limitation (documented intentionally):** IP ≈ network location, not a
single physical machine. Devices behind one NAT/router/VPN share a public IP and
therefore share one vote; the same device on different networks gets different
IPs. True per-machine identity isn't available to a web page. If stricter
uniqueness is needed, the path is a lightweight login keyed to an account.

Raw IPs are never stored — only the hash.

---

## 7. Front-end: player, stations, layout

**Stations** are the single source of truth in the `STATIONS` array at the top
of `public/app.js`; the nav dropdown is built from it. Fields:
- `url` — stream URL.
- `hls: true` — `.m3u8` HLS stream; played via hls.js unless the browser plays
  HLS natively (Safari). Direct MP3/AAC (Icecast) URLs play natively.
- `lossless: true` — shows the source/stream quality lines + enables rating.
- `tracksFromApi: true` — now-playing metadata comes from this app's API (only
  Radio Calico). Other stations just display the station name; their rating row
  and history are hidden (no per-song metadata to rate).

| Station            | Stream                                                       | Flags |
| ------------------ | ------------------------------------------------------------ | ----- |
| Radio Calico       | `https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8`        | `hls`, `lossless`, `tracksFromApi` |
| Kuwait Quran Radio | `https://radio.mp3islam.com/listen/quran_radio/radio.mp3`    | (direct MP3) |
| Marina FM (Kuwait) | `https://ffs3.gulfsat.com/MARINA-FM-904/playlist.m3u8`       | `hls` |

> The Radio Calico stream URL comes from
> `C:\nfirfire-assurant\AI\repo\RadioCalicoStyle\stream_URL.txt`.

The page polls `/api/now-playing`, `/api/tracks`, and `/api/my-ratings` every
**15 seconds** to stay current. Switching stations hot-swaps the stream live.

**Layout** follows `RadioCalicoLayout.png`: charcoal nav with the logo centered
between "Radio" and "Calico"; two-column now-playing (album art left; artist as
the dominant heading, song title in teal, album bold, quality lines, a "Rate
this track:" row, and a dark pill player bar); a mint "Previous tracks:" panel in
`Artist: Song` format; a cream footer.

---

## 8. Brand / style guide

The brand assets live at `C:\nfirfire-assurant\AI\repo\RadioCalicoStyle`:
- `RadioCalico_Style_Guide.txt` — palette, typography, components, voice.
- `RadioCalicoLayout.png` — the canonical page layout (authoritative when it
  conflicts with the text guide — e.g. the layout shows a **charcoal** nav, not
  the teal one the text describes; we follow the layout).
- `RadioCalicoLogoTM.png` — logo (copied into `public/logo.png`).
- `stream_URL.txt` — the live stream URL.

**Palette** (CSS custom properties in `styles.css`):
| Token       | Hex       | Use |
| ----------- | --------- | --- |
| `--mint`    | `#D8F2D5` | Backgrounds, previous-tracks panel |
| `--forest`  | `#1F4E23` | Headings, primary buttons, active 👍 |
| `--teal`    | `#38A29D` | Song title, accents, focus rings, sliders |
| `--orange`  | `#EFA63C` | Play button, call-to-action |
| `--charcoal`| `#231F20` | Nav bar, body text, player bar, active 👎 |
| `--cream`   | `#F5EADA` | Cards, footer |
| `--white`   | `#FFFFFF` | Text on dark, backgrounds |

**Typography:** Montserrat (headings, 500/600/700) + Open Sans (body) from
Google Fonts. Fallback stack defined in `styles.css`.

`styles.css` is shared by the home page and the users page; both use the same
palette. Keep the users-page classes (`site-header`, `card`, `user-form`,
`field`, `user-table`, `link-btn`, `form-msg`, etc.) working when editing CSS.

---

## 9. Corporate network note (Zscaler)

This machine is behind Zscaler TLS inspection. The user-level `~/.npmrc` sets
`cafile` to the Zscaler root **alone**, which replaces npm's bundled public roots
and breaks installs from the public registry. The project-local `.npmrc` points
`cafile` at a **combined** bundle (public roots + Zscaler root) at
`C:\Users\op5805\.zscaler\combined-ca.pem`, which works both on the open internet
and behind the proxy. Regenerate it if it goes missing:

```sh
node -e "const tls=require('tls'),fs=require('fs');fs.writeFileSync('C:/Users/op5805/.zscaler/combined-ca.pem', tls.rootCertificates.join('\n')+'\n'+fs.readFileSync('C:/Users/op5805/.zscaler/ZscalerRootCertificate-2048-SHA256.crt','utf8').trim()+'\n')"
```

---

## 10. Reproduce from scratch

To recreate this project in an empty folder:

1. **Scaffold**
   ```sh
   npm init -y
   npm pkg set type=commonjs main=server.js
   npm pkg set scripts.start="node server.js" scripts.dev="nodemon server.js"
   npm install better-sqlite3@^12 express@^5
   npm install --save-dev nodemon@^3
   ```
   (If behind Zscaler, set up `.npmrc` per §9 first.)

2. **`db.js`** — open `data.db`, set the WAL + foreign-key pragmas, and run the
   schema from §4 (`tracks`, `users`, `ratings`). Export the `db` instance.

3. **`server.js`** — Express app that:
   - `express.json()` + serves `public/` statically.
   - Honors `PORT` and optional `TRUST_PROXY` (§3).
   - Implements every endpoint in §5 with prepared statements; track queries
     `LEFT JOIN ratings` for `thumbs_up`/`thumbs_down`.
   - Defines `listenerIdFor(req)` = `'ip:' + sha256(req.ip)` (§6); the ratings
     endpoints derive the voter from it and upsert on `(track_id, listener_id)`.

4. **`public/`** — build the front-end per §7 and §8:
   - `index.html` — layout from `RadioCalicoLayout.png`; load Google Fonts + the
     hls.js CDN script + `app.js`.
   - `app.js` — `STATIONS` array, hls.js/native playback, 15s polling of the
     three endpoints, the rating control (delegated click handler, toggle/retract
     logic), and station hot-swap.
   - `styles.css` — palette tokens + brand styling for both pages.
   - `users/index.html` + `users/users.js` — users CRUD against `/api/users`.
   - Copy `RadioCalicoLogoTM.png` → `public/logo.png`.

5. **`seed.js`** — insert a handful of sample tracks (oldest first; the last
   becomes `is_current = 1`) so the UI has content.

6. **`.gitignore`** — `node_modules/`, `data.db`, `data.db-shm`, `data.db-wal`.

7. Run `node seed.js` then `npm start`, open <http://localhost:3000>.

---

## 11. Conventions

- Keep the no-build, vanilla-JS front-end. Talk to the API with `fetch`.
- Always `escapeHtml()` user/track values interpolated into HTML (helpers exist
  in `app.js` and `users.js`).
- Add new tables/columns in `db.js`; reuse prepared statements in `server.js`.
- Validate and normalize input server-side; return `400` (bad input), `404`
  (missing), `409` (unique conflict).
- When changing CSS, verify **both** the home page and `/users/` still render.
- Stations are configured only in the `STATIONS` array — don't hard-code stream
  URLs elsewhere.
