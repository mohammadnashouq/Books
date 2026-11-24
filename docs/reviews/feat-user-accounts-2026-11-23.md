# Review diagrams: `feat/user-accounts`

**Range:** `1e2b2b9..feat/user-accounts` (`1e2b2b9` is the tip of `feat/production-ready`, the base branch of this PR).

**Goal:** turn the browser-only Books app into a small client/server app: accounts with just a username and password, each writer's books stored in SQLite, everyone can read every book, only owners can edit, and the old in-browser library can be imported on first login, without giving up the earlier guarantees (honest save status, no silent data loss).

## Legend

```mermaid
flowchart LR
  N[New in this branch]:::new
  C[Changed by this branch]:::changed
  U[Untouched, context only]:::untouched
  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  classDef changed fill:#fff1c2,stroke:#b58100,stroke-width:2px,color:#4a3500
  classDef untouched fill:#eeeeee,stroke:#8c8c8c,color:#333333
```

## Files changed

| Status | Files |
|---|---|
| New | `server/{index,app,db,repo,auth,validate}.js`, `server/app.test.js`, `src/lib/api.js`, `src/store/{AuthContext.jsx,sync.js,sync.test.js}`, `src/pages/{AuthPage,BrowsePage,ReaderPage}.jsx`, `src/components/ConflictNotices.jsx`, `src/styles/{auth,reader}.css`, `src/test/server.js`, `Dockerfile`, `.dockerignore`, this document |
| Changed | `src/store/{BooksContext.jsx,reducer.js,storage.js,storage.test.js}`, `src/{App,main}.jsx`, `src/App.test.jsx`, `src/pages/{LibraryPage,EditorPage,CommentsPage}.jsx`, `src/components/{AppLayout,StorageBanner,BackupPanel,BookFormDialog,CommentItem,CommentsPanel}.jsx`, `src/test/setup.js`, `vite.config.js`, `eslint.config.js`, `package.json`, `package-lock.json`, `.nvmrc`, `.gitignore`, `README.md` |
| Deleted | `public/_redirects`, `public/_headers`, `vercel.json` (static hosting can't run the API) |
| Untouched | `src/store/merge.js`, `src/components/{BookCard,Toast,ErrorBoundary,Icon,ProgressBar,StatusChip}.jsx`, `src/data/*`, `src/lib/{utils,backup}.js`, `.github/workflows/ci.yml` |

## 1. Architecture

The app is now one Node process: Express serves the API under `/api` and, in production, the built frontend. Data lives in a SQLite file. The browser keeps a per-account copy in `localStorage` as a safety net, not as the source of truth.

```mermaid
flowchart LR
  subgraph Browser
    direction TB
    UI[Pages and components]:::changed
    Auth[AuthContext]:::new
    Books[BooksProvider + sync engine]:::changed
    Api[lib/api.js]:::new
    LS[(localStorage: per-account copy, old library)]:::untouched
  end
  subgraph Server["Node server (one process)"]
    direction TB
    App[app.js: routes, CSRF header check, rate limits, security headers]:::new
    Repo[repo.js: all SQL]:::new
    Val[validate.js]:::new
    AuthLib[auth.js: scrypt, tokens]:::new
    Static[Built frontend from dist/]:::new
  end
  DB[(SQLite file: users, sessions, books, chapters, comments)]:::new
  Proxy[HTTPS reverse proxy]:::untouched
  Docker[Dockerfile + volume /data]:::new

  UI --> Auth
  UI --> Books
  Auth --> Api
  Books --> Api
  Books <--> LS
  Api -- "fetch /api, cookie" --> Proxy --> App
  App --> Val
  App --> AuthLib
  App --> Repo --> DB
  App --> Static
  Docker -. packages .-> Server

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  classDef changed fill:#fff1c2,stroke:#b58100,stroke-width:2px,color:#4a3500
  classDef untouched fill:#eeeeee,stroke:#8c8c8c,color:#333333
```

## 2. Components

Pages only talk to `useAuth()` and `useBooks()`. All network access goes through `lib/api.js`, and all SQL through `server/repo.js`. The pure modules (`sync.js`, `reducer.js`, `storage.js`, `merge.js`) carry the logic that the tests exercise most.

```mermaid
flowchart TB
  main[main.jsx]:::changed --> AP[AuthProvider]:::new
  AP --> BP[BooksProvider]:::changed
  BP --> App[App.jsx]:::changed
  App --> SB[StorageBanner]:::changed
  App --> CN[ConflictNotices]:::new
  App --> AL[AppLayout]:::changed
  AL --> LP[LibraryPage]:::changed
  AL --> BR[BrowsePage]:::new
  AL --> RP[ReaderPage]:::new
  AL --> AU[AuthPage]:::new
  AL --> CP[CommentsPage]:::changed
  App --> EP[EditorPage]:::changed
  LP --> BK[BackupPanel]:::changed

  BP --> SY[store/sync.js]:::new
  BP --> RD[store/reducer.js]:::changed
  BP --> ST[store/storage.js]:::changed
  RD --> MG[store/merge.js]:::untouched
  SY --> ST
  ST --> MG
  AP --> API[lib/api.js]:::new
  BR --> API
  RP --> API

  subgraph server
    SA[app.js]:::new --> SR[repo.js]:::new
    SA --> SV[validate.js]:::new
    SA --> SAU[auth.js]:::new
    SR --> SD[db.js]:::new
    SI[index.js]:::new --> SA
  end
  API -. HTTP .-> SA
  SV --> CONST[data/constants.js]:::untouched

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  classDef changed fill:#fff1c2,stroke:#b58100,stroke-width:2px,color:#4a3500
  classDef untouched fill:#eeeeee,stroke:#8c8c8c,color:#333333
```

## 3. Modules

The sync state kept per account in the browser is the heart of the change: `synced[id]` (hash of the book as the server last confirmed it) and `revisions[id]` (that server revision). A book is dirty when its hash differs; an id in `synced` with no book is an unsent delete.

```mermaid
classDiagram
  class UserBooksProvider {
    <<changed>>
    +books
    +saveStatus : saved | pending | error
    +saveError : offline | signed-out | rejected
    +cachedLocally
    +losers : conflict versions
    +legacy : pre-accounts library
    -synced ref
    -revisions ref
    -lastCacheJson ref
    +sync()
    +writeCache()
    +importLegacy()
    +forgetLocalCopy()
  }
  class sync_js {
    <<new>>
    +hashBook(book)
    +pendingChanges(books, synced)
    +reconcile(cache, serverBooks)
    +parseCache() serializeCache()
    +cacheKey(userId)
  }
  class AuthProvider {
    <<new>>
    +user
    +offline
    +expired
    +signIn(mode, username, password)
    +signOut(beforeClear)
  }
  class api_js {
    <<new>>
    +me() register() login() logout()
    +listBooks() getBook(id)
    +myBooks() saveBook(book, baseRevision) deleteBook(id, baseRevision)
  }
  class server_app {
    <<new>>
    +POST /api/auth/register|login|logout
    +GET /api/auth/me
    +GET /api/books, /api/books/:id
    +GET|PUT|DELETE /api/me/books/:id
  }
  class server_repo {
    <<new>>
    +createUser() findUserByKey()
    +createSession() userForSession() deleteSession()
    +listPublicBooks() getBook(id, viewer)
    +listOwnBooks() saveBook(user, book, baseRevision) deleteBook()
  }
  UserBooksProvider ..> sync_js : uses
  UserBooksProvider ..> api_js : saves
  AuthProvider ..> api_js : signs in
  api_js ..> server_app : HTTP
  server_app ..> server_repo : SQL

  style UserBooksProvider fill:#fff1c2,stroke:#b58100,stroke-width:2px,color:#4a3500
  style sync_js fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style AuthProvider fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style api_js fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style server_app fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style server_repo fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
```

## 4. Database

Book, chapter and comment ids come from the client (UUIDs). A book id belongs to one owner: a save to someone else's id is refused with 403. `revision` is bumped on every write and is how stale saves are detected. Only a SHA-256 of each session token is stored.

```mermaid
erDiagram
  USERS ||--o{ SESSIONS : has
  USERS ||--o{ BOOKS : owns
  BOOKS ||--|{ CHAPTERS : contains
  BOOKS ||--o{ COMMENTS : has
  CHAPTERS ||--o{ COMMENTS : "chapter_id"
  USERS {
    int id PK
    text username
    text username_key UK "lower-cased"
    text password_hash "scrypt$N$r$p$salt$hash"
  }
  SESSIONS {
    text token_hash PK "sha256 of cookie"
    int user_id FK
    text expires_at "30 days"
  }
  BOOKS {
    text id PK
    int owner_id FK
    text title
    text status
    int goal
    text updated_at "canonical ISO"
    int revision
  }
  CHAPTERS {
    text book_id PK
    text id PK
    int position
    text text
  }
  COMMENTS {
    text book_id PK
    text id PK
    text chapter_id FK
    text author
    int resolved
  }
```

## 5. Sequences

### 5a. Registering and signing in (new)

```mermaid
sequenceDiagram
  actor W as Writer
  participant P as "AuthPage (new)"
  participant A as "AuthProvider (new)"
  participant S as "server/app.js (new)"
  participant D as SQLite
  rect rgb(212,247,212)
    W->>P: username + password (no email)
    P->>A: signIn('register', ...)
    A->>S: POST /api/auth/register + X-Books-Client
    S->>S: rate limit, validate, scrypt hash
    S->>D: INSERT users, INSERT sessions(sha256(token))
    S-->>A: 201 user + Set-Cookie books_session (HttpOnly, SameSite=Lax)
    A-->>P: user
    P-->>W: My books (and the offer to import the old library)
  end
```

### 5b. Saving an edit (changed)

Before, the edit went to `localStorage` only. Now it goes to the per-account browser copy first and then to the server with the revision it was based on.

```mermaid
sequenceDiagram
  actor W as Writer
  participant B as "BooksProvider (changed)"
  participant L as localStorage
  participant S as "Server (new)"
  rect rgb(255,241,194)
    W->>B: types
    Note over B: 400 ms after the last edit
    B->>L: write the per-account copy (skipped if identical)
  end
  rect rgb(212,247,212)
    B->>S: PUT /api/me/books/:id {book, baseRevision}
    alt revision matches
      S-->>B: 200 {revision+1}
      B-->>W: "Saved to your account"
    else changed elsewhere (409, current)
      alt server copy newer than what's on screen
        B->>B: show server copy, keep ours as a conflict version
      else ours newer
        B->>B: keep theirs as a conflict version, resend on top
      end
    else offline / 5xx
      B-->>W: "Not saved to account · kept in this browser", retry with backoff
    else 401
      B-->>W: banner "You've been signed out", work kept in the browser
    end
  end
```

### 5c. Reading as a visitor (new)

```mermaid
sequenceDiagram
  actor V as Visitor
  participant R as "Browse / Reader (new)"
  participant S as "Server (new)"
  rect rgb(212,247,212)
    V->>R: /browse
    R->>S: GET /api/books
    S-->>R: summaries (title, owner, words, chapters)
    V->>R: open a book
    R->>S: GET /api/books/:id
    S-->>R: chapters only (comments and revision only for the owner)
  end
```

## 6. Activities

### 6a. Opening the app signed in (new): reconcile

```mermaid
flowchart TD
  A([Provider mounts]) --> B[Read the per-account copy from localStorage]
  B --> C{Server reachable?}
  C -- no --> C1[Show the copy, status offline, retry with backoff]
  C -- yes --> D[GET /api/me/books]
  D --> E[For each book id]
  E --> F{Edited here since last confirmed?}
  F -- no --> F1[Take the server copy, or drop it if deleted on the server]
  F -- yes --> G{Server changed since then?}
  G -- no --> G1[Keep ours, send it]
  G -- yes --> H{Which edit is newer?}
  H -- ours --> H1[Keep ours, theirs becomes a conflict version]
  H -- theirs --> H2[Take theirs, ours becomes a conflict version]
  F1 --> Z([Send pending changes])
  G1 --> Z
  H1 --> Z
  H2 --> Z

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  class A,B,C,C1,D,E,F,F1,G,G1,H,H1,H2,Z new
```

### 6b. Importing the pre-accounts library (new)

```mermaid
flowchart TD
  A([Signed in, library page]) --> B{Import marker set?}
  B -- yes --> X([Nothing offered])
  B -- no --> C[peekLegacy: read old keys, no writes]
  C --> D{Anything there?}
  D -- no --> X
  D -- "only unreadable data" --> E[Notice: couldn't be read, download original]
  D -- books --> F[Notice: Import N books?]
  F -- Import --> G[Fresh ids, clipped to server limits, added to the library]
  G --> H[Write the import marker]
  H --> I{Room for a copy of the old data?}
  I -- yes --> J[Save copy, remove old keys]
  I -- no --> K[Leave old keys; the marker stops the offer]
  G --> L([Sync sends the books])

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  class A,B,X,C,D,E,F,G,H,I,J,K,L new
```

### 6c. Signing out (new)

```mermaid
flowchart TD
  A([Sign out]) --> B{Unsent changes or conflict versions?}
  B -- yes --> C{Writer confirms?}
  C -- no --> Z([Stay signed in])
  C -- yes --> D
  B -- no --> D[POST /api/auth/logout]
  D --> E{Server ended the session? 204 or 401}
  E -- no --> F([Toast: couldn't sign out, still signed in])
  E -- yes --> G{Everything on the server and no conflict versions?}
  G -- yes --> H[Delete this browser's copy]
  G -- no --> I[Keep it for next sign-in]
  H --> J([Signed out, go to Browse])
  I --> J

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  class A,B,C,Z,D,E,F,G,H,I,J new
```

## Review focus

- **Conflict resolution is per book, newest `updatedAt` wins.** The other version is always kept for download (in the browser copy, shown on every page until dismissed), but there's no field-level merge. `updatedAt` comes from client clocks.
- **The browser copy is a safety net.** Unsent edits survive reloads and offline periods; when everything is on the server, sign-out deletes it.
- **Single process.** SQLite and the in-memory login rate limits assume one server instance; `TRUST_PROXY` must only be set when the port isn't reachable except through the proxy (README).
- **Comments are private.** Readers see chapters only; this is a product decision worth confirming.
- **Not verified:** phone layout in a real browser, the Docker build (Docker wasn't available), and the public catalogue's cost at scale (it reads all chapter text to count words).
- **Verified:** 114 tests (server through supertest; the app against the real server over HTTP), lint, build, deliberate-breakage checks of every review fix, and a manual run in Chrome (register, create, save, read signed out, cookie hidden from scripts).
