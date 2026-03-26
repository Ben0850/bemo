# Architecture Patterns: Akten-Modul Integration

**Domain:** Case file management for car rental processes (Autovermietung Bemo)
**Researched:** 2026-03-26
**Source:** Direct codebase analysis of server.js (~2763 lines), db.js (~522 lines), public/js/app.js (~10000 lines)

---

## Current System Architecture

### Overview

Monolithic Express.js SPA. Single server process handles REST API, static file serving, and business logic. SQLite via sql.js (in-memory, persisted to disk on every write). Vanilla JS frontend uses a page-router pattern (`showPage()` + `data-page` attributes), global state variables, and a centralized modal system.

### Existing Layers

```
Browser (public/js/app.js)
    |
    | REST API calls (fetch + X-User-Permission header)
    v
Express.js (server.js, single file, ~2763 lines)
    |
    +-- Direct SQL via queryAll/queryOne/execute (db.js)
    |       |
    |       v
    |   sql.js SQLite (data/bemo.db, in-memory + disk write on every mutation)
    |
    +-- Proxy to Stammdaten API (http://stammdaten-service:3010)
    |       Routes: /api/insurances, /api/lawyers, /api/vermittler
    |
    +-- AWS S3 (file uploads, presigned download URLs)
    |
    +-- Azure MSAL (O365 email integration)
```

---

## Current State of the Akten Module

The Akten module has a working scaffold but is architecturally disconnected from the rest of the system.

### What Exists

| Component | Location | Status |
|-----------|----------|--------|
| DB table `akten` | `db.js` line 467 | Complete — flat schema |
| CRUD API `/api/akten` | `server.js` line 2647 | Complete — GET/POST/PUT/DELETE |
| List page `renderAkten()` | `app.js` line 9551 | Complete — table, filter, sort, badges |
| Detail modal `openAkteDetail()` | `app.js` line 9695 | Complete — read-only view |
| Create/edit form `openAkteForm()` | `app.js` line 9725 | Complete — all current fields |
| Sidebar nav entry | `public/index.html` line 51 | Complete |

### Current Schema (db.js line 467-482)

```sql
CREATE TABLE IF NOT EXISTS akten (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  aktennummer     TEXT NOT NULL DEFAULT '',
  datum           TEXT NOT NULL DEFAULT '',
  kunde           TEXT NOT NULL DEFAULT '',   -- free text, no FK
  anwalt          TEXT NOT NULL DEFAULT '',   -- free text, no FK to lawyers
  vorlage         TEXT NOT NULL DEFAULT '',
  zahlungsstatus  TEXT NOT NULL DEFAULT 'offen',
  vermittler      TEXT NOT NULL DEFAULT '',   -- free text, no FK to vermittler
  status          TEXT NOT NULL DEFAULT 'offen',
  notizen         TEXT NOT NULL DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Architectural Gaps

| Gap | Current State | Impact |
|-----|---------------|--------|
| No customer linkage | `kunde` is free text | Cannot navigate Customer -> Akten |
| No lawyer/vermittler linkage | `anwalt`/`vermittler` are free text | No autocomplete from Stammdaten, no cross-reference |
| No document attachments | S3 storage exists but is not Akten-scoped | No per-Akte file management |
| No activity history | No `akten_history` or change log | Cannot audit what changed and when |
| No relation to rentals | No FK to `rentals` or `fleet_vehicles` | Akte floats independently of the rental process |
| No PDF generation | Invoices have PDF, Akten do not | Cannot produce a case summary document |

---

## Recommended Architecture for Akten Enhancement

### Design Principle

Extend the existing flat schema incrementally using the migration-via-ALTER-TABLE pattern already established throughout `db.js`. Add optional FK columns. Do not rename existing text columns — they may contain legacy data. Add new FK columns alongside the text ones.

### Component Boundaries

```
Frontend (app.js)
  |
  +-- renderAkten()             [list page — exists]
  +-- openAkteDetail()          [detail modal — exists, extend]
  +-- openAkteForm()            [create/edit modal — exists, extend]
  +-- renderAkteDocuments()     [new: per-Akte S3 file list]
  +-- renderAktenFromCustomer() [new: customer detail inline widget]
  |
  | API calls
  v
server.js
  +-- GET/POST/PUT/DELETE /api/akten/:id    [exists]
  +-- GET /api/akten?customer_id=X          [extend existing list endpoint]
  +-- POST /api/files/upload (folder=akten/ID)  [exists, use with folder convention]
  +-- GET  /api/files/list?folder=akten/ID      [exists]
  +-- GET  /api/lawyers, /api/vermittler        [exists, proxy to Stammdaten]
  |
  v
db.js (akten table)
  +-- akten (existing)
  +-- customer_id column (new, migration)
  +-- lawyer_id column (new, migration — optional, Stammdaten is external)
```

### Data Flow

**Creating a new Akte:**
1. User opens `openAkteForm()` — frontend
2. Form loads Stammdaten dropdowns: `GET /api/lawyers` and `GET /api/vermittler` for autocomplete/select
3. Form optionally links to a customer: typeahead against `GET /api/customers?search=`
4. User submits — `POST /api/akten` with new optional `customer_id` field
5. Backend inserts row, returns new Akte
6. Frontend reloads list

**Attaching a document to an Akte:**
1. User selects file in Akte detail view
2. Frontend base64-encodes file, calls `POST /api/files/upload` with `folder: "akten/42"` (where 42 is akte ID)
3. S3 stores file at key `akten/42/filename.pdf`
4. Frontend calls `GET /api/files/list?folder=akten/42` to refresh attachment list
5. Downloads via `GET /api/files/download?key=akten/42/filename.pdf` → presigned URL (1h valid)

**Viewing Akten from a Customer record:**
1. User opens Customer detail view
2. Frontend calls `GET /api/akten?customer_id=X` (new query param, handled server-side)
3. Backend returns filtered list
4. Frontend renders inline Akten widget inside Customer detail

**Permission flow (unchanged pattern):**
- All mutations check `X-User-Permission` header
- Akten deletion already protected by global Admin-only DELETE middleware (server.js line 52-59)
- Editing restricted to Admin role (already implemented in frontend `isAdmin()` guards)

### S3 Folder Convention for Akten Documents

```
akten/
  {akte_id}/
    {timestamp}_{filename}
```

This follows the existing pattern in the codebase. The S3 API endpoints (`/api/files/upload`, `/api/files/list`, `/api/files/download`, `/api/files/:key`) are already implemented and require no changes — only the `folder` parameter changes.

---

## Build Order (Dependency Sequence)

The following sequence respects data dependencies and avoids rework:

### Step 1: DB Schema Migrations (no user-visible change)
Add optional FK columns to existing `akten` table via `ALTER TABLE ... ADD COLUMN` (matches existing migration pattern). No breaking changes.

```sql
ALTER TABLE akten ADD COLUMN customer_id INTEGER DEFAULT NULL;  -- FK to customers.id
```

Note: `lawyer_id` and `vermittler_id` reference the external Stammdaten API (separate service, no local table), so they cannot be enforced as SQL foreign keys. Keep them as text fields with autocomplete in the UI.

### Step 2: Enhance API List Endpoint
Extend `GET /api/akten` to accept `?customer_id=X` filter. Single line SQL change. Backwards-compatible.

### Step 3: Enhance Create/Edit Form (UI)
- Add customer search/select (typeahead against `/api/customers`)
- Replace free-text Anwalt/Vermittler inputs with select dropdowns populated from `/api/lawyers` and `/api/vermittler`
- These are already proxied through the main app at `/api/lawyers` and `/api/vermittler`

### Step 4: Akte Detail View — Document Attachments
- Add file upload widget to `openAkteDetail()` modal or a dedicated full-page detail view
- Reuse existing S3 upload/list/download endpoints with `folder=akten/{id}` convention
- No new backend endpoints required

### Step 5: Customer Detail — Akten Widget (optional cross-reference)
- Extend customer detail view to show associated Akten
- Calls `GET /api/akten?customer_id=X`
- Read-only list with link to open Akte detail

### Step 6: Akten Detail as Full Page (optional)
- If modal becomes too small for documents + fields, promote to a full page view
- Pattern: add `case 'akten-detail': renderAkteDetailPage(currentAkteId)` to `showPage()`
- Matches how invoices work — list page + detail page are separate

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Replacing Text Fields with FK-Only Fields
**What goes wrong:** Existing akten records have text in `kunde`, `anwalt`, `vermittler`. Switching to FK-only breaks reading those records.
**Instead:** Add new `customer_id` column alongside existing `kunde` text column. Populate `customer_id` on new creates. Display logic falls back to text when FK is null.

### Anti-Pattern 2: New Dedicated File Table in SQLite
**What goes wrong:** Tempting to add `akten_files` table to track metadata. But the existing S3 folder approach (`/api/files/list?folder=akten/ID`) provides this without schema changes. Adding a table creates a sync problem between SQLite and S3.
**Instead:** Use S3 folder convention `akten/{id}/` and list via existing API. Filenames in S3 are the source of truth.

### Anti-Pattern 3: Breaking Up server.js for the Akten Module
**What goes wrong:** Tempting to extract Akten routes to a separate file. But the entire codebase is one file — partial extraction creates inconsistency and adds routing complexity.
**Instead:** Keep Akten routes in server.js in the existing section (line 2647+). Add new routes immediately after existing ones. The monolith pattern is established and intentional.

### Anti-Pattern 4: Requiring Lawyer/Vermittler FK on All Existing Records
**What goes wrong:** Making the new dropdown fields required breaks editing existing records that only have text values.
**Instead:** Text fallback display — if select has no match, show stored text as-is. New records use select; old records retain text.

---

## Scalability Considerations

The Akten module at current scale (single Autovermietung, ~4 stations, small staff) has no scalability concerns. The relevant constraint is:

| Concern | Current Scale | Notes |
|---------|--------------|-------|
| SQLite write contention | Low (single-user writes) | sql.js writes to disk on every `execute()` — fine for current load |
| S3 file storage | Effectively unlimited | No action needed |
| Large akten list | Manageable with existing filter/sort | Add DB index on `customer_id` if list grows beyond ~1000 records |

---

## Sources

- Direct codebase analysis: `db.js` (full file, 522 lines)
- Direct codebase analysis: `server.js` (lines 2540-2740, 2647-2694)
- Direct codebase analysis: `public/js/app.js` (lines 9544-9800)
- Direct codebase analysis: `public/index.html` (line 51)
- `.planning/codebase/ARCHITECTURE.md` (existing architecture analysis)
- `.planning/PROJECT.md` (project context and constraints)

**Confidence:** HIGH — all findings are from direct code inspection, not inference.
