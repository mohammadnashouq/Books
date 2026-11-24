# Books

A colorful, responsive web app for writing books: create an account, write
chapter by chapter, leave notes on the text, and share your books for anyone
to read.

Built with [React](https://react.dev), [Vite](https://vite.dev) and
[React Router](https://reactrouter.com) in the browser, and a small
[Express](https://expressjs.com) server storing everything in
[SQLite](https://sqlite.org) (Node's built-in `node:sqlite`, so there's no
database server to install). Works on phones, tablets and laptops.

## Getting started

You need [Node.js](https://nodejs.org) 22.22 or newer (CI uses the version in
`.nvmrc`).

```bash
npm install
npm run dev
```

`npm run dev` starts both the API server (port 3001) and Vite (usually
http://localhost:5173), which forwards `/api` to the server. The database is
created at `data/books.sqlite` on first run.

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | API server + Vite dev server with hot reload              |
| `npm run dev:server` | Only the API server, restarting on changes                |
| `npm run build`      | Build the frontend into `dist/`                           |
| `npm start`          | Run the server (serves `dist/` when `NODE_ENV=production`) |
| `npm run preview`    | Build, then serve the built app and the API on port 3001  |
| `npm run lint`       | Check the code with ESLint                                |
| `npm test`           | Run all tests once (Vitest + Testing Library + supertest) |
| `npm run check`      | Lint, test and build: what CI runs                        |

## Features

- **Accounts** – register with just a username and a password, no email.
  Usernames are 3–32 letters, numbers, dots, dashes or underscores, and are
  case-insensitive; passwords need at least 8 characters.
- **Browse and read** – everyone, signed in or not, can browse all books and
  read them chapter by chapter.
- **My books** – signed-in writers create, edit and delete their own books.
  Only the owner can change a book. Comments are private notes: only the
  owner sees them, while readers see the chapters.
- **Editor** – chapters, live word counts and autosave with an honest status:
  "Saving…", "Saved to your account", or "Not saved".
- **Comments, undo, backup** – comment on a chapter (select text to quote it),
  undo deletes, and download or import the whole library as JSON.
- **Import from before accounts** – if this browser holds a library from the
  earlier, browser-only version, signing in offers to import it into the
  account. A copy of the old data stays in the browser.

### No email means no password reset

There is no way to recover an account whose password is forgotten. The sign-up
page says so; tell writers to use a password manager and to download a backup
from the library page now and then.

## How saving works

- Edits are sent to the server about half a second after typing stops, one
  book at a time. Each book carries a **revision** number, so a save made from
  an out-of-date copy is refused instead of overwriting newer work.
- If two devices or tabs changed the same book, the most recently edited
  version is kept and the other is offered for download on the library page.
- Every edit is also kept in the browser (`localStorage`, one copy per
  account). If the server can't be reached, or the session ends, a banner says
  so, the work stays in the browser, and it's sent when the connection is back
  or you sign in again, even after closing the tab.
- Signing out with unsent work asks first. When everything is on the server,
  signing out removes the browser copy, so nothing is left on a shared computer.

## Security

- Passwords are hashed with scrypt (random salt per password); only the hash is
  stored. Login answers the same way for an unknown user and a wrong password,
  and is rate-limited per address and username.
- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure`
  in production); the database stores only a SHA-256 of each token. Sessions
  last 30 days and are deleted on sign-out.
- Every request that changes data must carry an `X-Books-Client` header, which
  other sites can't add, so cross-site request forgery is blocked.
- Books are validated on the server (fields, sizes, chapter and comment
  references) before anything is written.
- Responses carry a strict Content-Security-Policy and other security headers.

## Deploying

The app is one Node process that serves the API and the built frontend, with a
SQLite file on disk. Run it behind an HTTPS reverse proxy (Caddy, nginx, or your
platform's), because production cookies are `Secure`.

**With Docker**

```bash
docker build -t books .
docker run -d -p 127.0.0.1:3001:3001 -v books-data:/data -e TRUST_PROXY=1 books
```

The database lives in the `books-data` volume at `/data/books.sqlite`, so it
survives redeploys. The port is published on `127.0.0.1` only, so the reverse
proxy on the same machine is the only way in.

**Without Docker**

```bash
npm ci
npm run build
NODE_ENV=production HOST=127.0.0.1 DATABASE_PATH=/var/lib/books/books.sqlite TRUST_PROXY=1 npm start
```

| Variable        | Default               | Meaning                                                  |
| --------------- | --------------------- | -------------------------------------------------------- |
| `PORT`          | `3001`                | Port to listen on                                        |
| `HOST`          | `127.0.0.1`           | Address to bind (`0.0.0.0` in a container)               |
| `DATABASE_PATH` | `./data/books.sqlite` | SQLite file                                              |
| `NODE_ENV`      |                       | `production`: Secure cookies, HSTS, serve `dist/`        |
| `TRUST_PROXY`   | off                   | `1` behind one reverse proxy, so rate limits see real client addresses |

**Only set `TRUST_PROXY` when the server can't be reached except through the
proxy** (bound to `127.0.0.1`, or a private network the proxy alone can reach).
It makes the server believe the `X-Forwarded-For` header; anyone who can
connect directly could fake that header on every request and get around the
login rate limit.

It runs as a single instance: the SQLite file and the in-memory login rate
limits aren't shared between processes.

**Backups.** Back up the database file regularly. While the server is running,
use SQLite's online backup, for example
`sqlite3 /data/books.sqlite ".backup '/backups/books-$(date +%F).sqlite'"`,
rather than copying the file (it runs in WAL mode).

Static hosts (Netlify, Vercel, GitHub Pages) can't run the API on their own; the
browser-only version of the app is on the `feat/production-ready` branch.

## Project structure

```
server/
  index.js                 Start-up: env vars, database, HTTP server
  app.js                   Express app: auth, books API, security headers, static files
  db.js                    SQLite schema and migrations
  repo.js                  All SQL: users, sessions, books, chapters, comments
  auth.js                  Password hashing, session tokens, username/password rules
  validate.js              Server-side book validation
src/
  main.jsx                 App entry: fonts, error boundary, router, providers
  App.jsx                  Routes and the save-problem banner
  lib/api.js               API client
  store/
    AuthContext.jsx        Who is signed in
    BooksContext.jsx       The signed-in user's books: editing, syncing, import
    sync.js                Change detection and reconciling with the server (pure)
    reducer.js             All library changes (pure)
    storage.js             Reading, validating and migrating browser data (pure)
    merge.js               Merging another tab's copy (pure)
  pages/                   My books, Browse, Reader, Editor, Comments, Sign in
  components/              Layout, cards, dialog, comments, toast, backup, icons
  styles/                  Global tokens and page styles
  test/                    Test setup and a real in-memory server for tests
```

Tests sit next to the code they cover (`*.test.js[x]`). The app tests start the
real server with an in-memory database and talk to it over HTTP.
