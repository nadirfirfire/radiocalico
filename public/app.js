// Front-end for Radio Calico: drives the live audio player and keeps the
// "now playing" panel + history in sync with whichever station is selected.

// === Stream config =========================================================
// Each station has a `url`. HLS (.m3u8) streams set `hls: true` and use hls.js
// on browsers without native HLS support. `tracksFromApi: true` means the
// now-playing metadata comes from this app's /api (only Radio Calico); other
// stations just show the station name as "now playing".
const STATIONS = [
  {
    id: 'calico',
    name: 'Radio Calico',
    // Lossless 24-bit / 48 kHz HLS stream (from RadioCalicoStyle/stream_URL.txt).
    url: 'https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8',
    hls: true,
    lossless: true,
    tracksFromApi: true,
  },
  {
    id: 'quran',
    name: 'Kuwait Quran Radio',
    url: 'https://radio.mp3islam.com/listen/quran_radio/radio.mp3',
    tracksFromApi: false,
  },
  {
    id: 'marina',
    name: 'Marina FM (Kuwait)',
    url: 'https://ffs3.gulfsat.com/MARINA-FM-904/playlist.m3u8',
    hls: true, // HLS stream — needs hls.js on non-Safari browsers
    tracksFromApi: false,
  },
];
// ===========================================================================

// A vote is tied to the listener's machine/network on the server (derived from
// their IP), so it counts once regardless of browser. The client sends no id.
let myRatings = {}; // { trackId: 1 | -1 } — this machine's own votes

const artEl        = document.getElementById('art');
const artImg       = document.getElementById('art-img');
const artistEl     = document.getElementById('np-artist');
const titleEl      = document.getElementById('np-title');
const albumEl      = document.getElementById('np-album');
const qualityEl    = document.getElementById('np-quality');
const rateRow      = document.getElementById('rate-row');
const npRating     = document.getElementById('np-rating');
const listEl       = document.getElementById('track-list');

const audio        = document.getElementById('audio');
const playBtn      = document.getElementById('play-btn');
const playIcon     = document.getElementById('play-icon');
const stationSelect= document.getElementById('station-select');
const volume       = document.getElementById('volume');
const statusText   = document.getElementById('status-text');
const timeEl       = document.getElementById('time');

let currentStation = STATIONS[0];
let latestApiTrack = null; // most recent /api/now-playing result
let hls = null;            // active hls.js instance, if any

// === Helpers ===============================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Format seconds as m:ss for the player bar's elapsed time.
function fmtTime(secs) {
  if (!isFinite(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Thumbs up/down control for a track. `mine` is this listener's vote (1/-1/0);
// the active button is highlighted. Counts are the totals across all listeners.
function ratingHtml(track) {
  const mine = myRatings[track.id] || 0;
  const up = track.thumbs_up || 0;
  const down = track.thumbs_down || 0;
  return `
    <button class="rate-btn up ${mine === 1 ? 'active' : ''}" data-rate data-value="1"
            aria-pressed="${mine === 1}" aria-label="Thumbs up" title="Thumbs up">
      <span class="rate-icon">👍</span><span class="rate-count">${up}</span>
    </button>
    <button class="rate-btn down ${mine === -1 ? 'active' : ''}" data-rate data-value="-1"
            aria-pressed="${mine === -1}" aria-label="Thumbs down" title="Thumbs down">
      <span class="rate-icon">👎</span><span class="rate-count">${down}</span>
    </button>`;
}

function setIcon(state) {
  playBtn.classList.toggle('loading', state === 'loading');
  if (state === 'loading')      playIcon.textContent = '◐';
  else if (state === 'playing') playIcon.textContent = '⏸';
  else                          playIcon.textContent = '▶';
}

// === Now playing ===========================================================
// What the panel shows depends on the selected station: Radio Calico shows the
// real track from the API; the other stations just show the station name.
function renderNowPlaying() {
  // Layout (per mockup): artist is the dominant heading, song title in teal,
  // album in bold, then the source/stream quality lines.
  if (currentStation.tracksFromApi && latestApiTrack) {
    const t = latestApiTrack;
    artistEl.textContent = t.artist || currentStation.name;
    titleEl.textContent  = t.title || '';
    albumEl.textContent  = t.album || '';
    if (t.artwork_url) {
      artImg.src = t.artwork_url;
      artImg.alt = `${t.title || ''} cover art`;
      artEl.classList.add('has-art');
    } else {
      artEl.classList.remove('has-art');
    }
    // Quality lines + ratings only for the lossless library station.
    qualityEl.hidden = !currentStation.lossless;
    npRating.dataset.track = t.id;
    npRating.innerHTML = ratingHtml(t);
    rateRow.hidden = false;
    return;
  }

  // Non-API station, or Radio Calico with no track queued yet.
  artEl.classList.remove('has-art');
  artistEl.textContent = currentStation.name;
  titleEl.textContent  = audio.paused ? 'Press play to tune in' : 'Live broadcast';
  albumEl.textContent  = '';
  qualityEl.hidden = true;
  rateRow.hidden = true; // nothing in the library to rate for live-only stations
}

function renderHistory(tracks) {
  // History is only meaningful for the API-backed station (Radio Calico).
  if (!currentStation.tracksFromApi) {
    listEl.innerHTML = `<li class="empty">Live stream — no track history for ${escapeHtml(currentStation.name)}.</li>`;
    return;
  }
  if (!tracks || !tracks.length) {
    listEl.innerHTML = '<li class="empty">No history yet.</li>';
    return;
  }
  listEl.innerHTML = tracks.map((t) => `
    <li>
      <span class="pt-text"><strong>${escapeHtml(t.artist)}:</strong> ${escapeHtml(t.title)}</span>
      <span class="rating" data-track="${t.id}">${ratingHtml(t)}</span>
    </li>`).join('');
}

let lastHistory = [];

async function refresh() {
  try {
    const [np, history, mine] = await Promise.all([
      fetch('/api/now-playing').then((r) => r.json()),
      fetch('/api/tracks?limit=20').then((r) => r.json()),
      fetch('/api/my-ratings').then((r) => r.json()),
    ]);
    latestApiTrack = np;
    lastHistory = history;
    myRatings = mine || {};
    renderNowPlaying();
    renderHistory(history);
  } catch (err) {
    console.error('Failed to refresh metadata:', err);
  }
}

// Cast a vote. Clicking your current vote again retracts it (value 0). A
// listener only ever has one vote per song — enforced on the server too.
async function rate(trackId, value) {
  const send = myRatings[trackId] === value ? 0 : value;
  try {
    const res = await fetch(`/api/tracks/${trackId}/ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: send }),
    });
    if (!res.ok) throw new Error(`rate failed: ${res.status}`);
    const data = await res.json();
    myRatings[trackId] = data.mine;
    // Reflect new totals + my vote everywhere this track appears.
    if (latestApiTrack && latestApiTrack.id === trackId) {
      latestApiTrack.thumbs_up = data.thumbs_up;
      latestApiTrack.thumbs_down = data.thumbs_down;
    }
    const h = lastHistory.find((t) => t.id === trackId);
    if (h) { h.thumbs_up = data.thumbs_up; h.thumbs_down = data.thumbs_down; }
    renderNowPlaying();
    renderHistory(lastHistory);
  } catch (err) {
    console.error('Failed to rate track:', err);
  }
}

// Delegated handler: rating buttons live in re-rendered now-playing + history.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rate]');
  if (!btn) return;
  const wrap = btn.closest('.rating');
  const trackId = parseInt(wrap?.dataset.track, 10);
  const value = parseInt(btn.dataset.value, 10);
  if (Number.isInteger(trackId)) rate(trackId, value);
});

refresh();
setInterval(refresh, 15000); // poll every 15s

// === Playback ==============================================================
function teardownHls() {
  if (hls) { hls.destroy(); hls = null; }
}

function onPlayError(err) {
  console.error('Playback failed:', err);
  setIcon('paused');
  statusText.textContent = 'Unable to play stream';
}

// (Re)set the source each time so we rejoin the live edge rather than resuming
// a stale buffer. HLS streams use hls.js unless the browser plays HLS natively.
function play() {
  teardownHls();
  setIcon('loading');
  statusText.textContent = 'Connecting…';

  const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl');
  if (currentStation.hls && !nativeHls && window.Hls && window.Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(currentStation.url);
    hls.attachMedia(audio);
    hls.on(Hls.Events.MANIFEST_PARSED, () => audio.play().catch(onPlayError));
    hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) onPlayError(data); });
  } else {
    // Direct MP3/AAC, or HLS on a browser that supports it natively (Safari).
    audio.src = currentStation.url;
    audio.play().catch(onPlayError);
  }
}

function stop() {
  teardownHls();
  audio.pause();
  audio.removeAttribute('src');
  audio.load(); // drop the buffer so the next play rejoins live
}

playBtn.addEventListener('click', () => {
  if (audio.paused) play();
  else stop();
});

// Build the station dropdown from STATIONS (single source of truth).
STATIONS.forEach((s) => {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.name;
  stationSelect.appendChild(opt);
});

// Switching station: update the panel, and if we're playing, hop streams live.
stationSelect.addEventListener('change', () => {
  currentStation = STATIONS.find((s) => s.id === stationSelect.value) || STATIONS[0];
  renderNowPlaying();
  renderHistory(lastHistory);
  if (!audio.paused || audio.src || hls) play();
});

// Volume
audio.volume = parseFloat(volume.value);
volume.addEventListener('input', () => { audio.volume = parseFloat(volume.value); });

// Audio element events keep the UI in sync.
audio.addEventListener('playing', () => {
  setIcon('playing');
  playBtn.setAttribute('aria-pressed', 'true');
  statusText.textContent = '';
  renderNowPlaying();
});
audio.addEventListener('waiting', () => setIcon('loading'));
audio.addEventListener('timeupdate', () => { timeEl.textContent = fmtTime(audio.currentTime); });
audio.addEventListener('pause', () => {
  setIcon('paused');
  playBtn.setAttribute('aria-pressed', 'false');
  timeEl.textContent = '0:00';
  statusText.textContent = '';
  renderNowPlaying();
});
audio.addEventListener('error', () => {
  if (!audio.src && !hls) return; // ignore the reset we trigger on stop
  setIcon('paused');
  statusText.textContent = 'Stream unavailable';
});

// Initial paint.
renderNowPlaying();
