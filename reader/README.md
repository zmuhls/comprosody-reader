# comprosody reader

A small authenticated EPUB reader built with Express, EPUB.js, and PostgreSQL. It includes a compact library, directories, reading preferences, highlights, notes, explicit bookmarks, automatic resume, EPUB downloads, a hideable Rubi margin companion, and optional browser-assisted PDF-to-EPUB ingestion.

The public snapshot intentionally contains no books, source PDFs, conversion pipeline, generated browser bundles, private catalog, evaluation data, or credentials. `catalog.json` starts as an empty array.

The application code is open source under the MIT License. Books and other content you add are not covered by that software license.

## run locally

```sh
npm ci
npm run build
READINGS_USERNAME=reader \
READINGS_PASSWORD='choose-a-password' \
SESSION_SECRET='choose-a-random-secret-at-least-32-characters' \
npm start
```

The local fallback writes account state to `data/reader-state.json`. Set `DATABASE_URL` to use PostgreSQL.

## add a private EPUB

Keep EPUB files outside the public repository. Place a private deployment copy in `output/` or point `BOOKS_PATH` at another private directory. Add only metadata to a private deployment catalog:

```json
[
  {
    "book": "example-reading",
    "title": "Example Reading",
    "author": "Example Author",
    "words": 12000,
    "sections": 8
  }
]
```

Set `CATALOG_PATH` if the deployment catalog lives outside this directory. Book slugs may contain lowercase letters, numbers, and hyphens.

## account state

The verified session determines a one-way account identifier on the server. Reading position, highlights, and notes are stored by account and book in `reader_account_state`. Explicit bookmarks use per-item rows in `reader_bookmark_items`; a deleted id remains a tombstone so a stale offline save cannot resurrect it. Existing `reader_bookmarks` lists are imported lazily and remain read-only.

The browser receives an HMAC-opaque account scope only after bookmark hydration succeeds. Its versioned outbox is isolated by that scope and book, retains only dirty item operations while offline, and never replaces a whole bookmark list. Each book allows 500 active bookmarks and 5,000 permanent item records.

## ingestion

The ingest panel reads PDF bytes only in the browser with PDF.js. It submits extracted text and entered metadata to the server; it does not upload the PDF file. The server runs three conservative GLM-5.2 remediation passes and returns a temporary EPUB download. Set `OLLAMA_API_KEY` only as a server-side environment variable to enable this feature.

## railway

When this project is kept in the repository’s `reader/` subtree, set the Railway service root directory to `/reader`.

Required production variables:

```text
READINGS_USERNAME
READINGS_PASSWORD
SESSION_SECRET
DATABASE_URL
```

Optional variables:

```text
READINGS_EMAIL
CATALOG_PATH
BOOKS_PATH
OLLAMA_API_KEY
```

Railway runs `npm run build` and `npm start`. The included ignore policy blocks PDFs, EPUBs, spreadsheets, CSV exports, local data, reports, and secrets from a source-code deployment. Stage private EPUB release artifacts separately if the deployment serves them from its filesystem.
