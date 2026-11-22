# Books

A colorful, responsive web app for writing my books: see the whole library,
write chapter by chapter, and leave comments on the text.

Built with [React](https://react.dev), [Vite](https://vite.dev) and
[React Router](https://reactrouter.com). Works on phones, tablets and laptops.

## Getting started

You need [Node.js](https://nodejs.org) 20.19 or newer.

```bash
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173).

| Command           | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start the dev server with hot reload          |
| `npm run build`   | Build the production site into `dist/`        |
| `npm run preview` | Serve the production build locally            |

## Features

- **Library** – every book as a colored cover card with status, progress
  toward its word goal and open comments. Search, filter by status and sort.
- **New book / Book settings** – title, genre, status, word goal and cover color.
- **Editor** – chapters list, chapter title and text, live word counts and
  autosave.
- **Comments** – comment on a chapter; select text first to quote it. Resolve,
  reopen or delete comments. The Comments page lists open comments across all
  books.
- **Responsive** – top navigation on larger screens, bottom tab bar on phones;
  the editor shows chapters and comments side by side on wide screens and as a
  dropdown and slide-over panel on smaller ones.

Data is saved in the browser (`localStorage`), so there is no server yet. The
first run loads a few sample books you can edit or delete.

## Project structure

```
src/
  main.jsx              App entry: router + data provider
  App.jsx               Routes
  store/BooksContext.jsx  Book data, actions and persistence
  data/                 Constants and sample books
  lib/utils.js          Word counts, dates, ids
  components/           Layout, cards, dialog, comments, icons
  pages/                Library, Editor, Comments, Not found
  styles/               Global tokens and page styles
```
