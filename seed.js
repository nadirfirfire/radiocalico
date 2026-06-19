// Seed the database with sample tracks so the list view has content during
// prototyping. Run with: node seed.js
const db = require('./db');

const sample = [
  { title: 'Midnight City',        artist: 'M83',             album: 'Hurry Up, We’re Dreaming', duration_sec: 244 },
  { title: 'Redbone',              artist: 'Childish Gambino', album: 'Awaken, My Love!',            duration_sec: 327 },
  { title: 'Dreams',               artist: 'Fleetwood Mac',    album: 'Rumours',                     duration_sec: 257 },
  { title: 'Tame',                 artist: 'Pixies',           album: 'Doolittle',                   duration_sec: 235 },
  { title: 'Just',                 artist: 'Radiohead',        album: 'The Bends',                   duration_sec: 234 },
  { title: 'Electric Feel',        artist: 'MGMT',             album: 'Oracular Spectacular',        duration_sec: 229 },
  { title: 'Harvest Moon',         artist: 'Neil Young',       album: 'Harvest Moon',                duration_sec: 305 },
  { title: 'Teardrop',             artist: 'Massive Attack',   album: 'Mezzanine',                   duration_sec: 329 },
];

const reset = db.transaction(() => {
  db.prepare('DELETE FROM tracks').run();
  const insert = db.prepare(
    `INSERT INTO tracks (title, artist, album, duration_sec, is_current, played_at)
     VALUES (@title, @artist, @album, @duration_sec, @is_current, datetime('now', @offset))`
  );
  // Insert oldest first; the last one becomes the current track.
  sample.forEach((t, i) => {
    const fromEnd = sample.length - 1 - i; // 0 for the newest
    insert.run({
      ...t,
      is_current: fromEnd === 0 ? 1 : 0,
      offset: `-${fromEnd * 4} minutes`,
    });
  });
});

reset();
console.log(`Seeded ${sample.length} tracks. Current: "${sample[sample.length - 1].title}".`);
