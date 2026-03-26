# Architecture Patterns: Akten-Modul Integration

**Domain:** Full-page detail view in monolithic SPA — cross-entity data aggregation
**Researched:** 2026-03-26
**Overall confidence:** HIGH (all findings from direct codebase inspection)

---

## Current System in One Paragraph

Single Express.js process (~2763 lines in server.js). Static files + REST API served from the same process. SQLite via sql.js (in-memory, written to disk on every `execute()` call). Frontend is one Vanilla JS file (~10 000 lines in `public/js/app.js`), no bundler. Navigation is handled by `navigate(page, data)` which overwrites `#main-content` via `innerHTML`. Global state lives in module-level `let` variables (`currentPage`, `currentCustomerId`, `loggedInUser`, etc.).

---

## Existing Full-Page Detail Pattern (the template to follow)

Three pages already implement the exact pattern the Akten detail view must use. All three are structurally identical:

| Instance | Triggered by | State var set | Backend call |
|----------|-------------|---------------|-------------|
| `renderCustomerDetail(id)` | `navigate('customer-detail', id)` | `currentCustomerId = id` | `GET /api/customers/:id` (returns nested vehicles/credits) |
| `renderInvoiceDetail(id)` | `navigate('invoice-detail', id)` | none | `GET /api/invoices/:id` |
| `renderFuhrparkDetail(id)` | `navigate('fuhrpark-detail', id)` | none | `GET /api/fleet-vehicles/:id` (returns nested maintenance/mileage) |

**The canonical pattern (verified in app.js lines 1060-1160, 6805-6853, 5553+):**

```
1. List page renders rows. Each row's onclick calls navigate('entity-detail', row.id).
2. navigate() sets currentPage, clears #main-content, dispatches to render function.
3. Async render function calls api('/api/entity/:id') — ONE request.
4. Backend returns an enriched object (related data embedded, not separate fetch).
5. render function writes full page HTML via main.innerHTML.
6. Back link calls navigate('list-page').
7. Edit/action buttons are inline HTML strings calling modal functions.
```

The Akten detail page must follow this pattern without deviation. No architectural exceptions are needed or warranted.

---

## Current Akten Module Baseline

### Schema (db.js lines 467-482) — what exists today

```sql
CREATE TABLE IF NOT EXISTS akten (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  aktennummer     TEXT NOT NULL DEFAULT '',
  datum           TEXT NOT NULL DEFAULT '',
  kunde           TEXT NOT NULL DEFAULT '',      -- free text, no FK
  anwalt          TEXT NOT NULL DEFAULT '',      -- free text, no FK to lawyers
  vorlage         TEXT NOT NULL DEFAULT '',
  zahlungsstatus  TEXT NOT NULL DEFAULT 'offen',
  vermittler      TEXT NOT NULL DEFAULT '',      -- free text, no FK to Stammdaten
  status          TEXT NOT NULL DEFAULT 'offen',
  notizen         TEXT NOT NULL DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### API endpoints (server.js lines 2647-2692) — what exists today

- `GET /api/akten` — list, optional `?search=` across text columns
- `GET /api/akten/:id` — single record (simple `queryOne`, no enrichment)
- `POST /api/akten` — create, accepts all current text columns
- `PUT /api/akten/:id` — update, same fields
- `DELETE /api/akten/:id` — delete

### Frontend functions (app.js lines 9548-9800) — what exists today

- `renderAkten()` — list page with sort/filter, renders via `#main-content`
- `openAkteDetail(id)` — read-only modal (NOT a full page — this gets replaced)
- `openAkteForm(editId)` — create/edit modal
- `saveAkte(e, editId)` — submits to API
- `deleteAkte(id, name)` — confirms and deletes

The list row currently calls `openAkteDetail(id)` for non-admins and `openAkteForm(id)` for admins directly from the row. Both get replaced with `navigate('akte-detail', id)`.

### Stammdaten Proxy (server.js lines 2694-2740)

Vermittler, Versicherungen (insurances), and Anwälte (lawyers) live in a separate service on port 3010. The main app proxies them:

```
GET /api/vermittler     → http://stammdaten-service:3010/api/vermittler
GET /api/insurances     → http://stammdaten-service:3010/api/insurances
GET /api/lawyers        → http://stammdaten-service:3010/api/lawyers
```

The proxy uses a raw `http.request()` function (`proxyStammdatenRequest`, line 2699). It writes directly to `res` and cannot be reused for internal server-side sub-requests. A separate internal fetch helper is needed.

---

## Recommended Architecture

### Overview

```
Frontend (app.js)                         Backend (server.js)
─────────────────────────────────────     ────────────────────────────────────────
renderAkten()  [list]           ────────→ GET /api/akten
  row click → navigate('akte-detail', id)
                                                 │
renderAkteDetail(id)  [full-page]  ←────────────┘
  ONE call: api('/api/akten/:id')  ────────→ GET /api/akten/:id  [enriched]
                                                 │
                                     ┌───────────┴──────────────────────┐
                                     │ JOIN customers (local SQLite)    │
                                     │ JOIN rentals + fleet_vehicles    │
                                     │ fetchStammdatenById vermittler   │
                                     │ fetchStammdatenById versicherung │
                                     └──────────────────────────────────┘
                                     Returns one enriched JSON object

openAkteForm(editId)  [edit modal]
  Parallel picker loads:
  api('/api/customers')          ────────→ GET /api/customers
  api('/api/vermittler')         ────────→ GET /api/vermittler (proxy)
  api('/api/insurances')         ────────→ GET /api/insurances (proxy)
  api('/api/rentals')            ────────→ GET /api/rentals
```

### Single-Request Enrichment Principle

The detail page makes exactly one API call. The backend aggregates all related data before responding. This matches how `GET /api/customers/:id` already embeds `vehicles` and `credits` arrays.

**Enriched response shape for `GET /api/akten/:id`:**

```json
{
  "id": 42,
  "aktennummer": "AK-2026-042",
  "datum": "2026-01-15",
  "zahlungsstatus": "offen",
  "status": "offen",
  "notizen": "...",
  "mietart": "Reparaturmiete",
  "wiedervorlage": "2026-03-01",
  "unfallDatum": "2026-01-14",
  "unfallOrt": "Aachen, Adenauerallee",
  "polizei": 1,
  "kunde": "Alttext-Fallback für Legacy-Datensätze",
  "vermittler": "Alttext-Fallback",
  "customer": {
    "id": 7,
    "first_name": "Max",
    "last_name": "Mustermann",
    "phone": "0241 123456",
    "email": "max@example.de"
  },
  "vermittler_obj": {
    "id": 3,
    "name": "Vermittler GmbH",
    "phone": "..."
  },
  "versicherung": {
    "id": 5,
    "name": "HUK-COBURG",
    "phone": "..."
  },
  "rental": {
    "id": 12,
    "start_date": "2026-01-15",
    "end_date": "2026-02-12",
    "license_plate": "AC-BM-100",
    "manufacturer": "VW",
    "model": "Passat"
  }
}
```

The legacy text fields (`kunde`, `vermittler`, `anwalt`) remain in the response as fallback display values for records that predate the FK migration.

---

## Integration Points

### 1. db.js — New Columns via ALTER TABLE

Location: after line 482 (after the `akten` CREATE TABLE block).
Pattern: matches every existing migration in the file.

```javascript
// Akten-Modul v1.0 — new columns
try { db.run("ALTER TABLE akten ADD COLUMN customer_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN vermittler_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN versicherung_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN rental_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN mietart TEXT DEFAULT ''"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN wiedervorlage TEXT DEFAULT ''"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN unfallDatum TEXT DEFAULT ''"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN unfallOrt TEXT DEFAULT ''"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN polizei INTEGER DEFAULT 0"); } catch(e) {}
```

Do not use REFERENCES syntax in ALTER TABLE. SQLite allows it syntactically but cannot enforce FK integrity when `PRAGMA foreign_keys = ON` is set after the fact on existing NULLable columns. Use application-layer validation only.

### 2. server.js — Internal Stammdaten Fetch Helper

New private async function, placed near line 2698 (above the proxy functions):

```javascript
async function fetchStammdatenById(urlPath) {
  return new Promise((resolve) => {
    const fullUrl = `${STAMMDATEN_API_URL}${urlPath}`;
    const proto = fullUrl.startsWith('https') ? https : http;
    let data = '';
    const req = proto.get(fullUrl, (proxyRes) => {
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
  });
}
```

This helper returns `null` on any error (network, parse, 404). The enriched endpoint treats null as "not linked" and omits the block from the response.

### 3. server.js — Replace GET /api/akten/:id (line 2661)

Replace the synchronous handler with an async enriching one:

```javascript
app.get('/api/akten/:id', async (req, res) => {
  const row = queryOne('SELECT * FROM akten WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Local FK joins (synchronous, in-memory SQLite)
  if (row.customer_id) {
    row.customer = queryOne(
      'SELECT id, first_name, last_name, phone, email, company_name, customer_type FROM customers WHERE id = ?',
      [row.customer_id]
    ) || null;
  }
  if (row.rental_id) {
    row.rental = queryOne(
      `SELECT r.id, r.start_date, r.end_date, fv.license_plate, fv.manufacturer, fv.model
       FROM rentals r
       JOIN fleet_vehicles fv ON r.vehicle_id = fv.id
       WHERE r.id = ?`,
      [row.rental_id]
    ) || null;
  }

  // External Stammdaten (parallel, non-blocking)
  const [vermittlerData, versicherungData] = await Promise.all([
    row.vermittler_id ? fetchStammdatenById(`/api/vermittler/${row.vermittler_id}`) : Promise.resolve(null),
    row.versicherung_id ? fetchStammdatenById(`/api/insurances/${row.versicherung_id}`) : Promise.resolve(null)
  ]);
  row.vermittler_obj = vermittlerData;
  row.versicherung = versicherungData;

  res.json(row);
});
```

### 4. server.js — Extend PUT /api/akten/:id (line 2676)

The UPDATE must persist all nine new columns alongside the existing ones. The field list in the SQL and `req.body` destructuring both expand.

### 5. app.js — Navigate dispatch

Add to the switch in `navigate()` (currently at line 191, after `case 'akten'`):

```javascript
case 'akte-detail': renderAkteDetail(data); break;
```

Add global state variable near lines 17-18:

```javascript
let currentAkteId = null;
```

### 6. app.js — renderAkteDetail(id) — new function

Placed after `renderAkten()` (after line ~9590). Follows the `renderFuhrparkDetail` structure:

```javascript
async function renderAkteDetail(id) {
  const main = document.getElementById('main-content');
  currentAkteId = id;
  try {
    const a = await api(`/api/akten/${id}`);
    main.innerHTML = `
      <a class="back-link" onclick="navigate('akten')">&larr; Zurück zur Aktenliste</a>
      <div class="page-header">
        <h2>Akte ${escapeHtml(a.aktennummer || '#' + a.id)}</h2>
        <div>
          ${isAdmin() ? `<button class="btn btn-primary" onclick="openAkteForm(${id})">Bearbeiten</button>` : ''}
        </div>
      </div>

      <!-- Block: Kerndaten -->
      <div class="card">
        <div class="card-header"><h3>Aktendetails</h3></div>
        <!-- datum, mietart, vorlage, wiedervorlage, zahlungsstatus, status, notizen -->
      </div>

      <!-- Block: Unfalldaten -->
      <div class="card">
        <div class="card-header"><h3>Unfalldaten</h3></div>
        <!-- unfallDatum, unfallOrt, polizei badge -->
      </div>

      <!-- Block: Kundendaten — a.customer or fallback a.kunde -->
      <div class="card">
        <div class="card-header"><h3>Kundendaten</h3></div>
        <!-- name, phone (clickable tel:), email (clickable mailto:) -->
        <!-- if a.customer is null and a.kunde is set: show a.kunde with "nicht verknüpft" badge -->
      </div>

      <!-- Block: Mietvorgang — a.rental -->
      <div class="card">
        <div class="card-header"><h3>Mietvorgang</h3></div>
        <!-- start_date, end_date, calculated Mietdauer in Tagen, vehicle info -->
        <!-- if null: "kein Mietvorgang verknüpft" -->
      </div>

      <!-- Block: Vermittler — a.vermittler_obj or fallback a.vermittler -->
      <div class="card">
        <div class="card-header"><h3>Vermittler</h3></div>
      </div>

      <!-- Block: Versicherung — a.versicherung -->
      <div class="card">
        <div class="card-header"><h3>Versicherung</h3></div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler beim Laden: ${escapeHtml(err.message)}</p></div>`;
  }
}
```

### 7. app.js — List row click change

In `renderAktenTable()` (line 9631), the tbody row must navigate instead of opening a modal. The current inline onclick (line ~9686) changes from:

```javascript
// Before — non-admin path:
onclick="event.stopPropagation();openAkteDetail(${a.id})"
// Before — admin path:
onclick="event.stopPropagation();openAkteForm(${a.id})"
```

To a single click handler for all roles:

```javascript
onclick="navigate('akte-detail', ${a.id})"
```

The edit button in the detail page header handles the admin-only edit path.

### 8. app.js — openAkteForm() — Picker fields

The form needs parallel data loading for all four pickers. The function signature and body top expand:

```javascript
async function openAkteForm(editId) {
  let a = { /* existing defaults plus new FK columns */ };
  let customers = [], vermittlerList = [], versicherungen = [], rentals = [];

  try {
    [customers, vermittlerList, versicherungen, rentals] = await Promise.all([
      api('/api/customers'),
      api('/api/vermittler'),
      api('/api/insurances'),
      api('/api/rentals')
    ]);
    if (editId) a = await api('/api/akten/' + editId);
  } catch (err) {
    showToast('Fehler beim Laden der Formulardaten', 'error');
    return;
  }

  // Build <select> elements using the loaded lists
  // ...
}
```

The Kundenpicker `<select>` uses `a.customer_id` as the pre-selected value. If a record has `customer_id = null` but has text in `a.kunde`, show a read-only hint below the select: "Altdaten: [a.kunde]".

### 9. app.js — saveAkte() — Extended body

Include all nine new FK/field values in the request body:

```javascript
const data = {
  // existing fields...
  customer_id: Number(document.getElementById('akte-customer-id').value) || null,
  vermittler_id: Number(document.getElementById('akte-vermittler-id').value) || null,
  versicherung_id: Number(document.getElementById('akte-versicherung-id').value) || null,
  rental_id: Number(document.getElementById('akte-rental-id').value) || null,
  mietart: document.getElementById('akte-mietart').value,
  wiedervorlage: document.getElementById('akte-wiedervorlage').value,
  unfallDatum: document.getElementById('akte-unfall-datum').value,
  unfallOrt: document.getElementById('akte-unfall-ort').value,
  polizei: document.getElementById('akte-polizei').checked ? 1 : 0
};
```

### 10. app.js — Delete openAkteDetail()

The modal function at line 9695 becomes dead code once the detail page is live. Remove it after step 7 is verified working.

---

## FK Migration Strategy: TEXT → FK Columns

### Constraint

The `akten` table has live production data with free-text values in `kunde` and `vermittler`. No data migration script should be run. The risk of incorrect matching outweighs the benefit.

### Approach: Additive Columns, Dual Display

| Phase | Action |
|-------|--------|
| Now | Add `customer_id`, `vermittler_id`, `versicherung_id` as nullable INTEGER columns |
| New records | Forms save FK IDs; text fields (`kunde`, `vermittler`) are also populated for backwards compat |
| Existing records | `customer_id` is NULL; detail page falls back to displaying `a.kunde` text with "nicht verknüpft" badge |
| Future (optional) | After staff have linked all records manually during normal use, text columns can be deprecated |

**Detail page fallback logic (verified in renderCustomerDetail pattern):**

```javascript
// Kundendaten block
const customerHtml = a.customer
  ? `<div>${escapeHtml(a.customer.first_name)} ${escapeHtml(a.customer.last_name)}</div>
     <div>${a.customer.phone ? '<a href="tel:'+escapeHtml(a.customer.phone)+'">'+escapeHtml(a.customer.phone)+'</a>' : ''}</div>`
  : a.kunde
    ? `<div>${escapeHtml(a.kunde)} <span class="badge badge-yellow">nicht verknüpft</span></div>`
    : '<div class="text-muted">kein Kunde hinterlegt</div>';
```

The same pattern applies to Vermittler (fall back to `a.vermittler` text) and Versicherung (no legacy text field, just "nicht hinterlegt" if null).

### Why No Batch Migration Script

- Free text values may not match Stammdaten names exactly (typos, abbreviations).
- A wrong link is worse than no link — it displays false contact data to staff.
- Staff recognize their own records and will link them correctly during normal editing.
- The fallback display makes unlinked records clearly visible without being broken.

---

## Build Order

Steps are ordered by dependency. Steps within the same tier can be worked in parallel.

**Tier 1 — Foundation (no user-visible changes)**

| Step | File | What | Prerequisite |
|------|------|------|-------------|
| 1 | `db.js` | 9 ALTER TABLE migrations for new columns | None |
| 2 | `server.js` | `fetchStammdatenById()` helper function | None |

**Tier 2 — Backend (requires Tier 1)**

| Step | File | What | Prerequisite |
|------|------|------|-------------|
| 3 | `server.js` | Replace `GET /api/akten/:id` with enriched async handler | Steps 1, 2 |
| 4 | `server.js` | Extend `PUT /api/akten/:id` for all new columns | Step 1 |

**Tier 3 — Frontend Shell (independent of Tier 1/2, can start immediately)**

| Step | File | What | Prerequisite |
|------|------|------|-------------|
| 5 | `app.js` | Add `currentAkteId` state variable | None |
| 6 | `app.js` | Add `case 'akte-detail'` to `navigate()` switch | None |

**Tier 4 — Frontend Detail Page (requires Tier 2 + Tier 3)**

| Step | File | What | Prerequisite |
|------|------|------|-------------|
| 7 | `app.js` | `renderAkteDetail(id)` function | Steps 3, 5, 6 |
| 8 | `app.js` | Extend `openAkteForm()` with picker fields | Steps 1, 4 |
| 9 | `app.js` | Extend `saveAkte()` to include new fields | Step 8 |

**Tier 5 — Wiring and Cleanup (requires Tier 4)**

| Step | File | What | Prerequisite |
|------|------|------|-------------|
| 10 | `app.js` | Change list row click to `navigate('akte-detail', id)` | Step 7 |
| 11 | `app.js` | Delete `openAkteDetail()` modal function | Step 10 |

---

## New vs Modified Components Summary

### New (do not exist today)

| Component | File | Description |
|-----------|------|-------------|
| `fetchStammdatenById(path)` | `server.js` | Internal async Stammdaten fetch for enrichment |
| `renderAkteDetail(id)` | `app.js` | Full-page detail render function |
| `currentAkteId` | `app.js` | Global state variable |
| `case 'akte-detail'` in `navigate()` | `app.js` | Route dispatch entry |
| 9 new `ALTER TABLE` migrations | `db.js` | Schema extension |

### Modified (exist, require targeted changes)

| Component | File | Lines | Change |
|-----------|------|-------|--------|
| `GET /api/akten/:id` handler | `server.js` | 2661-2665 | Full replacement with async enriched version |
| `PUT /api/akten/:id` handler | `server.js` | 2676-2684 | Extended column list |
| `openAkteForm()` | `app.js` | 9725-9761 | Picker fields + parallel data loading |
| `saveAkte()` | `app.js` | 9763-9789 | New fields in request body |
| `renderAktenTable()` row click | `app.js` | ~9686 | Modal call → `navigate('akte-detail', id)` |

### Removed (once detail page verified working)

| Component | File | Lines | Reason |
|-----------|------|-------|--------|
| `openAkteDetail()` | `app.js` | 9695-9723 | Replaced by full-page `renderAkteDetail()` |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Multiple Frontend API Calls for the Detail Page
**What goes wrong:** Frontend fetches `/api/akten/:id`, then separately fetches `/api/customers/:id`, `/api/vermittler/:id`, etc. in parallel.
**Why bad:** 4-5 round-trips instead of 1. Complex partial-loading states. A Stammdaten network error breaks customer data display even though customer data is local. Inconsistent with all other detail pages in the codebase.
**Instead:** Single enriched `GET /api/akten/:id` that assembles all blocks server-side.

### Anti-Pattern 2: Dropping TEXT Columns During Migration
**What goes wrong:** Removing `kunde`, `vermittler` fields when adding FK columns. Existing records lose their data. SQLite does not support DROP COLUMN in older versions (only added in SQLite 3.35.0 — sql.js may use an older version).
**Instead:** Additive only. TEXT columns remain as legacy fallback. Never touched by migration scripts.

### Anti-Pattern 3: Reusing proxyStammdatenRequest for Internal Sub-Requests
**What goes wrong:** `proxyStammdatenRequest` (line 2699) writes directly to an Express `res` object. It cannot return a value for internal use. Attempting to adapt it would require a refactor.
**Instead:** New `fetchStammdatenById()` promise-based helper that returns the parsed JSON (or null on error).

### Anti-Pattern 4: FK REFERENCES in ALTER TABLE
**What goes wrong:** SQLite's ALTER TABLE accepts the REFERENCES clause syntactically but cannot backfill constraint enforcement on existing NULL rows.
**Instead:** `INTEGER DEFAULT NULL` with no constraint clause. Validate at application level.

### Anti-Pattern 5: A Separate HTML Page for the Detail View
**What goes wrong:** A new `/akten/:id` URL route served from Express would break the SPA session model. `loggedInUser`, `currentPage`, and all other global state are lost on a hard navigation.
**Instead:** Stay within the `#main-content` SPA pattern exactly like all other detail pages.

---

## Scalability Considerations

Not a concern for v1.0. For reference:

| Concern | Current scale | Notes |
|---------|--------------|-------|
| SQLite write speed | Low concurrency | sql.js writes to disk on every `execute()` — fine for single-user edits |
| Stammdaten sub-requests | One per detail page open | No caching needed at this scale |
| Akten list size | Hundreds, not thousands | Existing filter/sort handles it; add `CREATE INDEX akten_customer_id ON akten(customer_id)` if list exceeds 2000 rows |

---

## Sources

- Direct codebase inspection: `db.js` lines 1-522 (full file)
- Direct codebase inspection: `server.js` lines 2647-2763 (Akten endpoints, proxy, startup)
- Direct codebase inspection: `public/js/app.js` lines 159-213 (navigate), 1060-1115 (renderCustomerDetail), 6805-6853 (renderFuhrparkDetail), 9548-9800 (Akten module)
- `.planning/codebase/ARCHITECTURE.md` — existing architecture documentation
- `.planning/PROJECT.md` — project requirements and constraints

**Confidence:** HIGH. All findings are from direct code inspection. No inference or training-data assumptions used.
