# comprosody reader

A small authenticated EPUB reader built with Express, EPUB.js, and PostgreSQL. It includes a compact library, directories, reading preferences, highlights, notes, explicit bookmarks, automatic resume, EPUB downloads, resizable tool panels, a movable Rubi margin companion, and optional browser-assisted PDF-to-EPUB ingestion.

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

The password is stored as a salted scrypt hash. Sessions carry the credential revision, so password reset or one-time registration invalidates every older session without removing reading state. Configure `READINGS_RECOVERY_KEY` to expose the reset form and `READINGS_ACCESS_CODE` to expose one-time registration. Keep both values server-side and rotate a recovery key after using it.

## ingestion

The ingest panel first checks an authenticated readiness endpoint and keeps conversion disabled unless the server confirms GLM-5.2, the three remediation cycles, browser extraction, no PDF upload, and the current extracted-text limit. Submit performs a fresh, deduplicated preflight before PDF.js loads, so an unconfigured server fails closed without parsing the selected PDF.

PDF bytes are read only in the browser with PDF.js. The client submits extracted text and entered metadata to the server; it does not upload the PDF file. The server runs three conservative GLM-5.2 remediation passes and returns a temporary EPUB download. Set `OLLAMA_API_KEY` only as a server-side environment variable to enable this feature.

## install on iphone

On iPhone, sign in and tap `download epub`, then open the downloaded file in Books or save it in Files. To install the web reader itself, use Safari’s Share menu and Add to Home Screen. The install metadata includes a neutral Rubi icon and launches at the signed-in library or, when the session has expired, the sign-in page.

The app intentionally has no service worker. Home Screen installation works online, while authenticated EPUBs, profiles, bookmarks, highlights, and annotations remain `private, no-store` and are never copied into browser Cache Storage.

## railway

When this project is kept in the repository’s `reader/` subtree, set the Railway service root directory to `/reader`.

Required production variables:

```text
READINGS_USERNAME
SESSION_SECRET
DATABASE_URL
```

For the first deployment only, set `READINGS_ALLOW_PASSWORD_BOOTSTRAP=1` together with `READINGS_PASSWORD`. After the credential record exists, remove both bootstrap variables; later restarts read the hash from PostgreSQL.

Optional variables:

```text
READINGS_EMAIL
READINGS_RECOVERY_KEY
READINGS_ACCESS_CODE
CATALOG_PATH
BOOKS_PATH
OLLAMA_API_KEY
```

Railway runs `npm run build` and `npm start`. The included ignore policy blocks PDFs, EPUBs, spreadsheets, CSV exports, local data, reports, and secrets from a source-code deployment. Stage private EPUB release artifacts separately if the deployment serves them from its filesystem.
