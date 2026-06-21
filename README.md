# Radio Calico — Local Prototype

A local prototype for a lossless internet-radio website: live HLS playback,
now-playing + recently-played history, per-song 👍/👎 ratings, and a small Users
admin page. Node.js + Express + SQLite (better-sqlite3), with a no-build vanilla
front-end.

## Quickstart

```sh
npm install        # first time (see CLAUDE.md §9 if behind Zscaler)
node seed.js       # populate sample tracks
npm start          # or: npm run dev  (auto-reload via nodemon)
```

Open <http://localhost:3000>. Override the port with `PORT=4000 npm start`.

## Continuous integration

Pull requests are automatically reviewed by Claude, and mentioning `@claude` in
an issue or PR comment runs Claude in context. See [CLAUDE.md §12](./CLAUDE.md)
for the workflows and required `CLAUDE_CODE_OAUTH_TOKEN` secret.

## Full documentation

**[CLAUDE.md](./CLAUDE.md) is the project's development guide and reproduction
blueprint** — architecture, file structure, database schema, the HTTP API, the
rating / voter-identity design, stations & player, the brand/style guide, the
Zscaler npm note, and step-by-step instructions to rebuild the project from
scratch. Start there.
