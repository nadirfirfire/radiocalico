// Shared, dependency-free rating/format helpers used by the front-end (app.js)
// and exercised directly by the unit tests. UMD wrapper: exposes a global
// `RadioCalicoRating` in the browser and `module.exports` under Node/Jest.
(function (root, factory) {
  const api = factory();
  /* istanbul ignore next -- UMD export boilerplate */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  /* istanbul ignore next -- UMD global boilerplate */
  if (root) root.RadioCalicoRating = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Escape a value for safe interpolation into HTML.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
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

  // Decide the vote to send given the listener's current vote and the button
  // they clicked: clicking the active vote again retracts it (0); otherwise the
  // clicked value wins. This is what enforces "one vote, togg{leable}" on the client.
  function nextVote(current, clicked) {
    return (current || 0) === clicked ? 0 : clicked;
  }

  // Thumbs up/down control markup for a track. `mine` is this listener's vote
  // (1 / -1 / 0); the active button is highlighted. Counts are totals across all
  // listeners. Returns an HTML string (counts are numeric, so no escaping needed).
  function ratingHtml(track, mine) {
    mine = mine || 0;
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

  return { escapeHtml, fmtTime, nextVote, ratingHtml };
});
