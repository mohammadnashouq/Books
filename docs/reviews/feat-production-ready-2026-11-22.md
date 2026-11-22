# Review diagrams: `feat/production-ready`

**Range:** `797a495..feat/production-ready` (`797a495` is the unchanged baseline import of the app; everything below is the hardening work on top of it). Base branch for the PR: `main`.

**Goal:** make the Books app safe to ship: honest save status, tabs that don't overwrite each other, validated and migrated storage, crash recovery, backup export/import, undo, lint/tests/CI, hosting config, self-hosted fonts and Escape handling.

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
| New | `src/store/storage.js`, `src/store/merge.js`, `src/store/reducer.js`, `src/lib/backup.js`, `src/components/{BackupPanel,ErrorBoundary,StorageBanner,Toast}.jsx`, `src/styles/feedback.css`, tests (`src/App.test.jsx`, `src/store/*.test.js`, `src/lib/utils.test.js`, `src/test/setup.js`), `eslint.config.js`, `.github/workflows/ci.yml`, `.nvmrc`, `public/_redirects`, `public/_headers`, `vercel.json`, this document |
| Changed | `src/store/BooksContext.jsx`, `src/main.jsx`, `src/App.jsx`, `src/pages/{EditorPage,LibraryPage}.jsx`, `src/components/{CommentsPanel,CommentItem,BookFormDialog,Icon}.jsx`, `src/styles/{global,editor,library}.css`, `index.html`, `vite.config.js`, `package.json`, `package-lock.json`, `README.md` |
| Untouched | `src/pages/{CommentsPage,NotFoundPage}.jsx`, `src/components/{AppLayout,BookCard,ProgressBar,StatusChip}.jsx`, `src/data/*`, `src/lib/utils.js`, other styles |

## 1. Architecture

There's still no server: the app is static files, and the library lives in the browser's `localStorage`. The branch adds a storage layer between React state and `localStorage`, an error boundary around everything, and build/hosting/CI around the app. Look at where `storage` events from other tabs come in.

```mermaid
flowchart LR
  subgraph Browser["Browser tab"]
    direction TB
    EB[ErrorBoundary]:::new
    subgraph ReactApp["React app"]
      Prov[BooksProvider]:::changed
      Pages[Pages: Library, Editor]:::changed
      UI[Banner, BackupPanel, Toast]:::new
      Other[CommentsPage, AppLayout, cards]:::untouched
    end
    subgraph Data["Data layer (pure)"]
      St[storage.js]:::new
      Mg[merge.js]:::new
      Rd[reducer.js]:::new
    end
    LS[(localStorage)]:::untouched
  end
  Tab2[Other tabs, incl. v0.1 tabs]:::untouched
  Host[Static host: Netlify, Cloudflare, Vercel, nginx]:::changed
  CI[GitHub Actions CI]:::new
  Fonts[Bundled Fontsource fonts]:::new

  EB --> ReactApp
  Pages --> Prov
  UI --> Prov
  Other --> Prov
  Prov --> Rd
  Rd --> Mg
  Prov --> St
  St --> Mg
  St <--> LS
  Tab2 -- "storage event" --> Prov
  Tab2 <--> LS
  Host -- "index.html for every path, headers" --> Browser
  Fonts --> ReactApp
  CI -- "lint, test, build" --> Host

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  classDef changed fill:#fff1c2,stroke:#b58100,stroke-width:2px,color:#4a3500
  classDef untouched fill:#eeeeee,stroke:#8c8c8c,color:#333333
```

## 2. Components and dependencies

`BooksProvider` used to own the reducer and write `localStorage` itself on every change. The reducer, the load/save/validate code and the merge are now separate pure modules, with tests next to them. The UI components only talk to the provider through `useBooks()`/`useToast()`; only `ErrorBoundary` reads storage directly, on purpose, so it works when React state is broken.

```mermaid
flowchart TB
  main[main.jsx]:::changed
  App[App.jsx]:::changed
  EB[ErrorBoundary.jsx]:::new
  TP[Toast.jsx: ToastProvider, useToast]:::new
  BP[BooksContext.jsx: BooksProvider, useBooks]:::changed
  SB[StorageBanner.jsx]:::new
  BK[BackupPanel.jsx]:::new
  LP[LibraryPage.jsx]:::changed
  EP[EditorPage.jsx]:::changed
  CP[CommentsPanel.jsx]:::changed
  CI[CommentItem.jsx]:::changed
  BFD[BookFormDialog.jsx]:::changed
  RD[store/reducer.js]:::new
  MG[store/merge.js]:::new
  ST[store/storage.js]:::new
  BU[lib/backup.js]:::new
  UT[lib/utils.js]:::untouched
  CO[data/constants.js]:::untouched

  main --> EB
  main --> BP
  main --> TP
  main --> App
  App --> SB
  App --> LP
  App --> EP
  LP --> BK
  EP --> CP
  EP --> BFD
  CP --> CI
  SB --> BP
  BK --> BP
  BK --> TP
  EP --> TP
  EP --> BP
  BP --> RD
  BP --> ST
  RD --> MG
  ST --> MG
  ST --> CO
  SB --> BU
  BK --> BU
  EB --> ST
  EB --> BU
  BU --> ST
  BK --> UT

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  classDef changed fill:#fff1c2,stroke:#b58100,stroke-width:2px,color:#4a3500
  classDef untouched fill:#eeeeee,stroke:#8c8c8c,color:#333333
```

## 3. Modules and their members

These are modules, not classes, except `ErrorBoundary`. The diagram shows each one's exports and the refs and state `BooksProvider` keeps for saving and syncing. The key invariant: `base` is the books array last written, and unedited books keep their object identity, so `books === base` means "nothing to save" and the merge can use reference checks.

```mermaid
classDiagram
  class BooksProvider {
    <<changed>>
    +books
    +saveStatus : saved | pending | error
    +problem : unavailable | corrupt | partial
    -savedJson ref
    -base ref
    -legacyPending ref
    -timer ref
    +flush()
    +retrySave()
    +dismissProblem()
    +restoreBook() restoreChapter() restoreComment()
    +importBooks()
  }
  class storage_js {
    <<new>>
    +STORAGE_KEY = books-app:v2
    +LEGACY_KEY = books-app:v1
    +normalizeBook(raw)
    +normalizeLibrary(list)
    +parseLibraryJson(text)
    +loadLibrary(storage, createSamples)
    +mergeLegacy(storage, books, raw)
    +saveLibrary(storage, json)
    +preserveRaw(storage, raw)
    +exportLibrary(books)
    +dumpRawStorage(storage)
  }
  class merge_js {
    <<new>>
    +mergeLibraries(base, local, remote)
  }
  class reducer_js {
    <<new>>
    +reducer(books, action)
    restore actions
    library/import
    library/merge
  }
  class ErrorBoundary {
    <<new>>
    +state.error
    +getDerivedStateFromError()
    +downloadData()
  }
  class ToastProvider {
    <<new>>
    +showToast(message, actionLabel, onAction)
    +dismiss()
  }
  class backup_js {
    <<new>>
    +downloadText()
    +backupFileName()
    +backupIsDue()
    +readFileText()
  }
  BooksProvider ..> reducer_js : uses
  BooksProvider ..> storage_js : load, save, parse
  reducer_js ..> merge_js : library/merge
  storage_js ..> merge_js : mergeLegacy
  ErrorBoundary ..> storage_js : dumpRawStorage
  ErrorBoundary ..> backup_js : downloadText

  style BooksProvider fill:#fff1c2,stroke:#b58100,stroke-width:2px,color:#4a3500
  style storage_js fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style merge_js fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style reducer_js fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style ErrorBoundary fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style ToastProvider fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  style backup_js fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
```

## 4. Stored data

The storage format now carries a version. v1 (a bare array under `books-app:v1`) is read and migrated. Recovery copies of anything unreadable sit under their own keys; nothing deletes them yet (see Review focus).

```mermaid
erDiagram
  STORAGE_V2 ||--|{ BOOK : "books (books-app:v2, {version: 2, books})"
  BOOK ||--|{ CHAPTER : chapters
  BOOK ||--o{ COMMENT : comments
  CHAPTER ||--o{ COMMENT : "chapterId"
  STORAGE_V2 {
    int version
  }
  BOOK {
    string id
    string title
    string status
    int goal
    string color
    string updatedAt "merge uses this"
  }
  CHAPTER {
    string id
    string title
    string text
  }
  COMMENT {
    string id
    string chapterId
    string text
    bool resolved
  }
  RECOVERY_COPY {
    string key "books-app:recovery:<time>-<rand>"
    string raw "original text, unparsed"
  }
  LEGACY_V1 {
    string key "books-app:v1, removed after migrating"
  }
```

## 5. Sequences

### 5a. Typing and saving (changed)

The old code wrote the whole library on every keystroke and showed a timer-based "All changes saved" whatever happened. Now the write happens 400 ms after the last edit (or at once when the page hides), and the status shown is the result of that write.

```mermaid
sequenceDiagram
  actor U as Writer
  participant E as "EditorPage (changed)"
  participant P as "BooksProvider (changed)"
  participant S as "storage.js (new)"
  participant L as localStorage
  rect rgb(255,241,194)
    U->>E: types
    E->>P: updateChapter()
    P-->>E: saveStatus = pending ("Saving…")
    Note over P: timer restarts on each edit (400 ms)
  end
  rect rgb(212,247,212)
    P->>S: saveLibrary(serializeLibrary(books))
    S->>L: setItem(books-app:v2)
    alt write succeeds
      L-->>S: ok
      S-->>P: ok
      P-->>E: saved ("Saved in this browser")
    else full or blocked
      L-->>S: throws QuotaExceededError
      S-->>P: not ok
      P-->>E: error ("Not saved" + red banner, close-tab warning)
    end
  end
```

### 5b. Another tab saves (new)

Tabs used to overwrite each other's work. Now a `storage` event makes this tab merge the other tab's library book by book. A write from a tab still running v0.1 (the `books-app:v1` key) is merged with no common base: newest edit wins, nothing is dropped.

```mermaid
sequenceDiagram
  participant T2 as "Other tab"
  participant L as localStorage
  participant P as "BooksProvider (changed)"
  participant R as "reducer + merge.js (new)"
  rect rgb(212,247,212)
    T2->>L: setItem(books-app:v2 or v1)
    L-->>P: storage event (key, newValue)
    P->>P: parseLibraryJson(newValue)
    alt key is books-app:v2
      P->>R: library/merge(base, local, remote)
      Note over P: base and savedJson = remote
    else key is books-app:v1 (old version tab)
      P->>R: library/merge([], local, remote)
      Note over P: legacyPending: save v2, then remove v1
    end
    R-->>P: merged books
    P->>L: save after 400 ms if different from what's stored
  end
```

### 5c. Delete with undo (new)

Comments delete straight away; books and chapters still confirm first. Each shows a toast with Undo that puts the item back where it was.

```mermaid
sequenceDiagram
  actor U as Writer
  participant E as "EditorPage (changed)"
  participant P as "BooksProvider (changed)"
  participant T as "ToastProvider (new)"
  rect rgb(212,247,212)
    U->>E: Delete chapter (confirm)
    E->>P: deleteChapter()
    E->>T: showToast("Deleted …", Undo)
    U->>T: Undo (within 8 s)
    T->>E: onAction
    E->>P: restoreChapter(chapter, index, its comments)
  end
```

## 6. Activities

### 6a. Loading the library (new)

Before, anything that wasn't an array fell back to sample books, and a malformed book crashed the whole app to a blank page. Now each book is checked and repaired, unreadable data is kept, and a v1 key left by an old tab is merged.

```mermaid
flowchart TD
  A([App starts]) --> B{localStorage usable?}
  B -- no --> B1[Sample books, problem: unavailable; saves will show Not saved]
  B -- yes --> C{books-app:v2 present?}
  C -- no --> D{books-app:v1 present?}
  D -- no --> D1[Sample books, first run]
  D -- yes --> E[Parse v1, legacyPending]
  C -- yes --> F[Parse v2]
  F --> G{v1 also present? old tab wrote it}
  G -- yes --> G1[Copy v1 aside, merge it in, legacyPending]
  G -- no --> H
  G1 --> H
  E --> H{Parsed?}
  H -- "not JSON or no books list" --> I[Copy raw aside, start empty, warning banner]
  I --> I1{Copy written?}
  I1 -- no --> I2[Pause saving until the user downloads and presses Continue]
  I1 -- yes --> Z
  H -- yes --> J{Any book, chapter or comment dropped?}
  J -- yes --> J1[Copy raw aside, warning banner: N items]
  J -- no --> Z
  J1 --> Z([Render; save repaired or migrated data])
  I2 --> Z

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  class A,B,B1,C,D,D1,E,F,G,G1,H,I,I1,I2,J,J1,Z new
```

### 6b. Merging one book (new)

`mergeLibraries` runs this for every book id in base, local or remote.

```mermaid
flowchart TD
  S([book id]) --> L{Changed locally? local !== base}
  L -- no --> R1[Take remote, absent means deleted there]
  L -- yes --> M{Changed remotely? remote differs from base}
  M -- no --> K1[Keep local]
  M -- yes --> N{Either side deleted it?}
  N -- yes --> K2[Keep the side that still has it: an edit beats a delete]
  N -- no --> O{local.updatedAt >= remote.updatedAt}
  O -- yes --> K1
  O -- no --> R2[Take remote]

  classDef new fill:#d4f7d4,stroke:#1a7f37,stroke-width:2px,color:#0b3d17
  class S,L,R1,M,K1,N,K2,O,R2 new
```

### 6c. Save status (new)

```mermaid
stateDiagram-v2
  [*] --> saved: loaded and already stored
  [*] --> pending: first run, migration or repair
  saved --> pending: edit
  pending --> pending: another edit restarts the timer
  pending --> saved: write ok (timer, page hidden, or unmount)
  pending --> error: write throws
  error --> error: further edits
  error --> saved: Try again or next write ok
```

## Review focus

- **Merge tie and conflict rule.** When two tabs edit the *same* book at the same time, the newer `updatedAt` wins and the other tab's edits to that book are lost. Tabs sync within ~400 ms, so the window is small, but it's not a field-level merge.
- **v0.1 tabs** never see the new version's changes. Their writes are merged in (newest wins per book), so a stale old tab editing a book the new version also edited can override it. Reloading the old tab fixes it.
- **Recovery copies are never pruned.** Each load that finds damaged data, or a v1 key rewritten by an old tab, adds a full copy under `books-app:recovery:*`. In dev StrictMode, `loadLibrary` runs twice and makes two copies. After the banner is dismissed, these copies can only be downloaded from the crash screen.
- **Hosting headers** were written for Netlify/Cloudflare (`public/_headers`) and Vercel (`vercel.json`) but not tested on a real host. The CSP allows `'unsafe-inline'` styles because React sets inline `style` attributes.
- **Node versions:** the app builds on Node 20.19, but the test tools (Vitest 5, jsdom 31) need Node 22.22+. CI pins Node 22 via `.nvmrc`.
- **Verified:** lint clean, 67 tests passing (deliberately breaking six of the fixes each made a test fail), production build, and a manual check in Chrome: two real tabs, a forced storage failure and retry, a damaged book, and phone width at 390 px.
