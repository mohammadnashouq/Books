# Books

A colorful, responsive web app for writing my books: see the whole library,
write chapter by chapter, and leave comments on the text.

Built with [React](https://react.dev), [Vite](https://vite.dev) and
[React Router](https://reactrouter.com). Works on phones, tablets and laptops.

## Getting started

You need [Node.js](https://nodejs.org) 20.19 or newer to build and run the
app, and Node 22.22 or newer to run the tests (Vitest and jsdom need it). CI
uses the version in `.nvmrc`.

```bash
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173).

| Command              | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `npm run dev`        | Start the dev server with hot reload           |
| `npm run build`      | Build the production site into `dist/`         |
| `npm run preview`    | Serve the production build locally             |
| `npm run lint`       | Check the code with ESLint                     |
| `npm test`           | Run the tests once (Vitest + Testing Library)  |
| `npm run test:watch` | Re-run tests as files change                   |
| `npm run check`      | Lint, test and build: what CI runs             |

## Features

- **Library** – every book as a colored cover card with status, progress
  toward its word goal and open comments. Search, filter by status and sort.
- **New book / Book settings** – title, genre, status, word goal and cover color.
- **Editor** – chapters list, chapter title and text, live word counts and
  autosave with an honest save indicator ("Saving…", "Saved in this browser",
  or "Not saved").
- **Comments** – comment on a chapter; select text first to quote it. Resolve,
  reopen or delete comments. The Comments page lists open comments across all
  books.
- **Undo** – deleting a book, chapter or comment shows an Undo button for a few
  seconds.
- **Backup** – download the whole library as a `.json` file and import it
  again (on this or another device) from the Backup panel on the library page.
  The panel reminds you when your last backup is more than a week old.
- **Responsive** – top navigation on larger screens, bottom tab bar on phones;
  the editor shows chapters and comments side by side on wide screens and as a
  dropdown and slide-over panel (Escape closes it) on smaller ones.

## Where your writing is stored

There is no server: the library lives in the browser's `localStorage`, under
the key `books-app:v2`. That means:

- **Back up regularly.** Clearing site data, some "cleanup" tools, or a
  different browser/device means an empty library. Use **Download backup**.
- **Saving is checked.** Edits are written about half a second after you stop
  typing, and straight away when the tab is hidden or closed. If the browser
  refuses the write (storage full or blocked), the editor says "Not saved", a
  red banner offers a backup download, and closing the tab asks for
  confirmation.
- **Several tabs are fine.** Tabs merge each other's saves book by book. If
  two tabs edit the same book at once, the most recent edit wins.
- **Damaged data is never thrown away.** Stored data is validated on load and
  repaired where possible. Anything unreadable is copied to a
  `books-app:recovery:<time>` key and a banner offers to download it. If even
  that copy can't be written, saving pauses until you've downloaded it.
- **Older data is upgraded.** Libraries saved by version 0.1 (`books-app:v1`)
  are moved to the new format automatically.
- If the app ever crashes, the error screen has a **Download my data** button
  that works without the app.

The app also asks the browser to keep its storage persistent, so it isn't
cleared automatically when the disk runs low.

## Deploying

`npm run build` produces a static site in `dist/`. Because the app uses normal
URLs like `/books/<id>`, the host must serve `index.html` for any path that
isn't a file:

- **Netlify / Cloudflare Pages** – handled by `public/_redirects`; security
  headers and caching are in `public/_headers`.
- **Vercel** – handled by `vercel.json` (rewrites and the same headers).
- **nginx** – `try_files $uri /index.html;`, and copy the headers from
  `public/_headers`.
- **GitHub Pages** – has no rewrites; copy `dist/index.html` to `dist/404.html`
  after building.

Files in `dist/assets/` have content hashes in their names, so they can be
cached forever; `index.html` should not be cached.

Fonts (Inter, Literata, Bricolage Grotesque) are bundled from
[Fontsource](https://fontsource.org), so the app makes no third-party requests.

## Project structure

```
src/
  main.jsx                 App entry: fonts, error boundary, router, providers
  App.jsx                  Routes and the storage warning banner
  store/
    BooksContext.jsx       Library state, actions, saving and tab sync
    reducer.js             All library changes (pure)
    storage.js             Load / validate / migrate / save (pure)
    merge.js               Merging another tab's save (pure)
  data/                    Constants and sample books
  lib/                     Word counts, dates, ids, backup files
  components/              Layout, cards, dialog, comments, toast, backup, icons
  pages/                   Library, Editor, Comments, Not found
  styles/                  Global tokens and page styles
  test/setup.js            Test setup
```

Tests sit next to the code they cover (`*.test.js[x]`).
