// Backend tests for the ratings system: HTTP API behavior, the one-vote-per-IP
// guarantee, aggregates, validation, and the IP-derived voter id.
//
// Env must be set BEFORE requiring db.js / server.js so the singleton DB opens
// in-memory and the app trusts X-Forwarded-For (lets us simulate distinct IPs).
process.env.DATABASE_PATH = ':memory:';
process.env.TRUST_PROXY = 'true';

const request = require('supertest');
const app = require('../../server');
const db = require('../../db');

const insertTrack = db.prepare(
  `INSERT INTO tracks (title, artist, album, is_current) VALUES (?, ?, ?, ?)`
);

// IP helpers — distinct X-Forwarded-For values map to distinct voters.
const IP_A = '11.11.11.11';
const IP_B = '22.22.22.22';
const asIp = (req, ip) => req.set('X-Forwarded-For', ip);

let currentId;

beforeEach(() => {
  db.exec('DELETE FROM ratings; DELETE FROM tracks;');
  // One current track + one in history.
  insertTrack.run('Old Song', 'Old Artist', 'Old Album', 0);
  const info = insertTrack.run('Current Song', 'Current Artist', 'Current Album', 1);
  currentId = info.lastInsertRowid;
});

afterAll(() => db.close());

describe('rating aggregates on track responses', () => {
  test('now-playing starts with zero up/down', async () => {
    const res = await request(app).get('/api/now-playing');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: currentId, thumbs_up: 0, thumbs_down: 0 });
  });

  test('tracks endpoint returns history with aggregate counts', async () => {
    const res = await request(app).get('/api/tracks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // History excludes the current track.
    expect(res.body.every((t) => t.id !== currentId)).toBe(true);
    expect(res.body[0]).toHaveProperty('thumbs_up', 0);
    expect(res.body[0]).toHaveProperty('thumbs_down', 0);
  });
});

describe('casting votes', () => {
  test('a thumbs up is recorded and reflected in totals', async () => {
    const res = await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ track_id: currentId, thumbs_up: 1, thumbs_down: 0, mine: 1 });

    const np = await request(app).get('/api/now-playing');
    expect(np.body).toMatchObject({ thumbs_up: 1, thumbs_down: 0 });
  });

  test('same IP voting up twice is NOT double-counted', async () => {
    await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 1 });
    const res = await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 1 });
    expect(res.body).toEqual({ track_id: currentId, thumbs_up: 1, thumbs_down: 0, mine: 1 });
  });

  test('same IP can change its vote (up -> down) without adding a second', async () => {
    await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 1 });
    const res = await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: -1 });
    expect(res.body).toEqual({ track_id: currentId, thumbs_up: 0, thumbs_down: 1, mine: -1 });
  });

  test('a vote can be retracted with value 0', async () => {
    await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 1 });
    const res = await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 0 });
    expect(res.body).toEqual({ track_id: currentId, thumbs_up: 0, thumbs_down: 0, mine: 0 });
  });

  test('different IPs are counted independently', async () => {
    await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 1 });
    const res = await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_B).send({ value: 1 });
    expect(res.body).toMatchObject({ thumbs_up: 2, thumbs_down: 0 });
  });
});

describe('my-ratings (per voter, keyed by IP)', () => {
  test('returns only the requesting IP\'s votes', async () => {
    await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 1 });
    await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_B).send({ value: -1 });

    const mineA = await asIp(request(app).get('/api/my-ratings'), IP_A);
    expect(mineA.body).toEqual({ [currentId]: 1 });

    const mineB = await asIp(request(app).get('/api/my-ratings'), IP_B);
    expect(mineB.body).toEqual({ [currentId]: -1 });
  });
});

describe('validation & errors', () => {
  test('rejects an out-of-range value with 400', async () => {
    const res = await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({ value: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('rejects a missing value with 400', async () => {
    const res = await asIp(request(app).post(`/api/tracks/${currentId}/ratings`), IP_A).send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 for a non-existent track', async () => {
    const res = await asIp(request(app).post('/api/tracks/999999/ratings'), IP_A).send({ value: 1 });
    expect(res.status).toBe(404);
  });

  test('returns 404 for a non-numeric track id', async () => {
    const res = await asIp(request(app).post('/api/tracks/abc/ratings'), IP_A).send({ value: 1 });
    expect(res.status).toBe(404);
  });
});

describe('listenerIdFor (IP-derived, hashed identity)', () => {
  const { listenerIdFor } = app;

  test('is stable for the same IP and differs across IPs', () => {
    const a1 = listenerIdFor({ ip: '1.2.3.4' });
    const a2 = listenerIdFor({ ip: '1.2.3.4' });
    const b = listenerIdFor({ ip: '5.6.7.8' });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  test('is hashed (prefixed, never contains the raw IP)', () => {
    const id = listenerIdFor({ ip: '1.2.3.4' });
    expect(id).toMatch(/^ip:[0-9a-f]+$/);
    expect(id).not.toContain('1.2.3.4');
  });

  test('falls back to the socket address when req.ip is absent', () => {
    const id = listenerIdFor({ socket: { remoteAddress: '9.9.9.9' } });
    expect(id).toMatch(/^ip:[0-9a-f]+$/);
  });
});
