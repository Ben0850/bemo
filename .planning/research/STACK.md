# Technology Stack — Akten-Modul

**Project:** Bemo Verwaltungssystem
**Milestone:** v1.0 Akten-Modul
**Researched:** 2026-03-26
**Mode:** Additive — no new libraries required; patterns only

---

## Summary

The Akten module requires **zero new npm dependencies**. Every capability it needs — FK migration, cross-entity data loading, full-page navigation — is already present in the stack or is a pure code pattern. The work is SQL schema restructuring, an extra API endpoint for joined data, and a new `renderAkteDetail()` function that follows the existing `renderCustomerDetail` / `renderFuhrparkDetail` pattern.

---

## Existing Stack (locked — do not change for this milestone)

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20 (Alpine) |
| Server | Express.js | 4.21.0 |
| Database | sql.js (SQLite WASM) | 1.11.0 |
| Frontend | Vanilla JS (app.js) | — |
| DB helpers | `queryAll`, `queryOne`, `execute` in `db.js` | — |

---

## New Capabilities Needed and How to Achieve Them

### 1. FK Migration in sql.js (SQLite) — No ALTER TABLE ADD CONSTRAINT

**The constraint:** SQLite does not support `ALTER TABLE ... ADD FOREIGN KEY`. This is a hard limitation of SQLite itself (not sql.js-specific). The official SQLite documentation (sqlite.org/lang_altertable.html) documents the 12-step table reconstruction procedure as the only supported path.

**Confidence:** HIGH — official SQLite documentation.

**What the akten table currently has (db.js lines 467–482):**

```
akten (
  id, aktennummer, datum,
  kunde TEXT,         -- free text, should become customer_id INTEGER FK
  anwalt TEXT,        -- free text, references stammdaten service (no local table)
  vorlage TEXT,       -- keep as text (Wiedervorlagedatum = date string)
  zahlungsstatus TEXT,
  vermittler TEXT,    -- free text, should become vermittler_id INTEGER FK (stammdaten)
  status TEXT,
  notizen TEXT
)
```

**What the new akten table needs (Akten-Modul requirements):**

```
akten (
  id, aktennummer, datum,
  customer_id INTEGER FK → customers(id),   -- replaces kunde TEXT
  rental_id INTEGER FK → rentals(id),       -- new: linked rental from calendar
  rental_type TEXT,                          -- new: 'Reparaturmiete'|'Totalschadenmiete'
  unfall_datum TEXT,                         -- new: accident date
  unfall_ort TEXT,                           -- new: accident location
  polizei INTEGER DEFAULT 0,                 -- new: police on scene 0/1
  wiedervorlage TEXT,                        -- new: follow-up date
  vermittler_id INTEGER,                     -- replaces vermittler TEXT (stammdaten ref)
  versicherung_id INTEGER,                   -- new: insurance ref (stammdaten ref)
  anwalt TEXT,                               -- keep as text (stammdaten proxy ref)
  zahlungsstatus TEXT,
  status TEXT,
  notizen TEXT,
  created_at, updated_at
)
```

**Note on vermittler_id / versicherung_id:** These reference entities managed by the stammdaten service (port 3010), not local SQLite tables. They cannot have SQLite-enforced FK constraints. Store the numeric IDs as plain INTEGER columns and resolve the display names via API at load time. This is the same pattern used elsewhere in the codebase (e.g., `calendar_appointments.assigned_staff_id`).

**customer_id and rental_id** reference local tables (`customers`, `rentals`) and CAN have enforced SQLite FK constraints.

**The migration procedure for db.js:**

SQLite requires table reconstruction to add FK constraints. The pattern used by the existing `db.js` migrations (try/catch ALTER TABLE) is only valid for adding plain columns without constraints. For FK constraints, the procedure is:

```javascript
// In getDb(), after existing table creation:
try {
  // Step 1: Check if migration already done (idempotency guard)
  const cols = db.exec("PRAGMA table_info(akten)");
  const colNames = cols[0]?.columns
    ? cols[0].values.map(row => row[cols[0].columns.indexOf('name')])
    : [];

  if (!colNames.includes('customer_id')) {
    // Step 2: Disable FK enforcement (must be outside transaction)
    db.run('PRAGMA foreign_keys = OFF');

    // Step 3: Reconstruct in a transaction
    db.run('BEGIN TRANSACTION');

    db.run(`
      CREATE TABLE akten_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aktennummer TEXT NOT NULL DEFAULT '',
        datum TEXT NOT NULL DEFAULT '',
        customer_id INTEGER DEFAULT NULL,
        rental_id INTEGER DEFAULT NULL,
        rental_type TEXT DEFAULT '',
        unfall_datum TEXT DEFAULT '',
        unfall_ort TEXT DEFAULT '',
        polizei INTEGER DEFAULT 0,
        wiedervorlage TEXT DEFAULT '',
        vermittler_id INTEGER DEFAULT NULL,
        versicherung_id INTEGER DEFAULT NULL,
        anwalt TEXT DEFAULT '',
        zahlungsstatus TEXT NOT NULL DEFAULT 'offen',
        status TEXT NOT NULL DEFAULT 'offen',
        notizen TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (rental_id) REFERENCES rentals(id)
      )
    `);

    // Step 4: Migrate existing data
    // kunde TEXT → customer_id: match by name where possible, else NULL
    // (name-based matching is best-effort; manual cleanup may be needed)
    db.run(`
      INSERT INTO akten_new
        (id, aktennummer, datum, anwalt, zahlungsstatus, status, notizen,
         created_at, updated_at)
      SELECT
        id, aktennummer, datum, anwalt, zahlungsstatus, status, notizen,
        created_at, updated_at
      FROM akten
    `);

    // Step 5: Drop and rename
    db.run('DROP TABLE akten');
    db.run('ALTER TABLE akten_new RENAME TO akten');

    // Step 6: Verify integrity
    db.exec('PRAGMA foreign_key_check(akten)');

    db.run('COMMIT');
    db.run('PRAGMA foreign_keys = ON');
  }
} catch (e) {
  try { db.run('ROLLBACK'); } catch (_) {}
  db.run('PRAGMA foreign_keys = ON');
  console.error('akten migration failed:', e.message);
}
```

**Critical detail about sql.js and PRAGMA foreign_keys OFF:**
sql.js 1.11.0 runs SQLite synchronously in WASM. `PRAGMA foreign_keys = OFF` issued outside a transaction takes effect immediately — this is correct behavior. The constraint is that you cannot toggle it *inside* an active transaction. The pattern above (toggle OFF → BEGIN → work → COMMIT → toggle ON) is the correct order.

**Data migration for existing `kunde` TEXT values:**
Existing akten rows store free-text customer names in `kunde`. The migration above does not auto-resolve these to `customer_id` because name-matching is unreliable. After migration, `customer_id` will be NULL for all existing rows. The detail view should show a "Kunde nicht verknüpft — bitte zuweisen" message for rows with `customer_id = NULL`. This is acceptable and avoids silent data corruption.

---

### 2. Cross-Entity Data Loading — `Promise.all` with Existing `api()` Helper

**The need:** The Akten detail page must display data from multiple sources simultaneously:
- `GET /api/akten/:id` — core akte record
- `GET /api/customers/:id` — customer detail block
- `GET /api/rentals/:rental_id` — linked rental data
- `GET /api/stammdaten/vermittler/:id` — vermittler detail (via existing proxy)
- `GET /api/stammdaten/versicherungen/:id` — versicherung detail (via existing proxy)

**Pattern:** Use `Promise.all` with the existing `api()` function. Fetch all known IDs in parallel, with null-guard for optional relations.

```javascript
async function renderAkteDetail(akteId) {
  const main = document.getElementById('main-content');
  currentPage = 'akte-detail';
  main.innerHTML = '<div class="loading">Laden...</div>';

  try {
    const akte = await api(`/api/akten/${akteId}`);

    // Fetch all related entities in parallel — null-guard optional FKs
    const [customer, rental, vermittler, versicherung] = await Promise.all([
      akte.customer_id
        ? api(`/api/customers/${akte.customer_id}`).catch(() => null)
        : Promise.resolve(null),
      akte.rental_id
        ? api(`/api/rentals/${akte.rental_id}`).catch(() => null)
        : Promise.resolve(null),
      akte.vermittler_id
        ? api(`/api/stammdaten/vermittler/${akte.vermittler_id}`).catch(() => null)
        : Promise.resolve(null),
      akte.versicherung_id
        ? api(`/api/stammdaten/versicherungen/${akte.versicherung_id}`).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Render with all data available
    main.innerHTML = buildAkteDetailHTML(akte, customer, rental, vermittler, versicherung);

  } catch (err) {
    main.innerHTML = `<div class="error-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}
```

**Why `.catch(() => null)` per request, not `Promise.allSettled`:** Each `.catch()` on the individual request means a failed stammdaten lookup degrades gracefully (shows "Nicht verfügbar") without aborting the entire page load. `Promise.allSettled` would also work but requires unwrapping `.value` and `.reason` from each result, which is more verbose.

**Confidence:** HIGH — `Promise.all` is a language primitive; `api()` is already in the codebase.

---

### 3. Full-Page Navigation in SPA — Extend Existing `navigate()` Pattern

**The pattern already exists.** The app uses `navigate(page, data)` in `app.js`. Full-page detail views are already implemented for:
- `customer-detail` → `renderCustomerDetail(id)`
- `fuhrpark-detail` → `renderFuhrparkDetail(id)`
- `invoice-detail` → `renderInvoiceDetail(id)`
- `credit-detail` → `renderCreditNoteDetail(id)`

**What to add for the Akten module:**

```javascript
// In navigate() switch statement (app.js ~line 184):
case 'akte-detail': renderAkteDetail(data); break;
```

```javascript
// In renderAktenTable(), row click handler:
onclick="navigate('akte-detail', ${a.id})"

// Back-link in the detail view:
<a class="back-link" onclick="navigate('akten')">&larr; Zurück zu Akten</a>
```

**No URL routing, no hash, no history API.** The project does not use URL-based routing (there is no `window.location` or `history.pushState` in the codebase). Adding hash or History API routing for this milestone alone would create inconsistency with all other navigation. It is not worth the scope. The `navigate()` in-memory pattern is consistent with the entire existing codebase.

**Auto-refresh:** The Akten detail page does NOT need auto-refresh. Only `dashboard`, `calendar`, and `time-tracking` use `startAutoRefresh()`. The Akten detail view should call `stopAutoRefresh()` (this happens automatically because `navigate()` only calls `startAutoRefresh()` for those three pages).

**Confidence:** HIGH — pattern directly observable in codebase, zero new infrastructure needed.

---

### 4. Rentals Lookup Endpoint — Minor API Addition

**Current gap:** `GET /api/rentals` returns all rentals. There is no `GET /api/rentals/:id`. The Akten detail page needs to fetch a single rental by ID.

Add to `server.js` (in the RENTALS section, ~line 2155):

```javascript
app.get('/api/rentals/:id', (req, res) => {
  const row = queryOne(
    `SELECT r.*, fv.license_plate, fv.manufacturer, fv.model
     FROM rentals r
     JOIN fleet_vehicles fv ON r.vehicle_id = fv.id
     WHERE r.id = ?`,
    [Number(req.params.id)]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});
```

This is needed so `renderAkteDetail` can fetch the linked rental's vehicle and date information.

---

### 5. Akten Form Update — Stammdaten Dropdowns

**Current gap:** The `openAkteForm()` in `app.js` uses free-text inputs for `kunde`, `vermittler`, and stores them as TEXT. The new form needs:
- Customer: searchable customer selector (same pattern as `renderInvoices` customer select — fetch `/api/customers`, render `<select>` or typeahead)
- Vermittler: dropdown from `GET /api/stammdaten/vermittler`
- Versicherung: dropdown from `GET /api/stammdaten/versicherungen`
- Rental: dropdown from `GET /api/rentals` (filtered optionally by customer)

These are straightforward `<select>` elements populated by `api()` calls. No new component library is needed. The existing `<select>` pattern in `openAkteForm` already demonstrates this.

---

## What NOT to Add

| Rejected | Reason |
|----------|--------|
| better-sqlite3 | Migration to better-sqlite3 is high-value but scoped to a separate infrastructure milestone. Do not mix it with the Akten feature milestone — the risk of breaking production during a feature release is not justified. |
| Client-side router (navigo, page.js) | Inconsistent with all existing navigation. Adds a library for zero user-visible benefit in this milestone. |
| SQLite migration library (db-migrate, flyway) | Overkill for the `db.js` try/catch pattern already established. The one-time FK reconstruction can be written inline following the same pattern. |
| ORM or query builder | Raw SQL via `queryAll`/`queryOne` is already established. No ORM for a targeted schema addition. |
| Separate JS module file for Akten | Deferred per existing STACK.md recommendation. Valid for a future refactor milestone, not needed to ship the Akten feature. |

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| SQLite FK migration pattern | HIGH | Official SQLite docs (sqlite.org/lang_altertable.html) |
| sql.js PRAGMA behavior | HIGH | sqlite.org/pragma.html + sql.js is direct SQLite port |
| Promise.all cross-entity loading | HIGH | Language primitive + existing `api()` helper in codebase |
| navigate() extension pattern | HIGH | Directly observable in existing app.js codebase |
| No new npm dependencies needed | HIGH | All required capabilities present in current stack |

---

## Sources

- [SQLite ALTER TABLE documentation](https://www.sqlite.org/lang_altertable.html) — 12-step table reconstruction procedure
- [SQLite Foreign Key Support](https://sqlite.org/foreignkeys.html) — PRAGMA behavior, enforcement rules
- [Add a Foreign Key to an Existing SQLite Table](https://database.guide/add-a-foreign-key-to-an-existing-table-in-sqlite/) — step-by-step example
- [Data Fetching Patterns in SPAs (Martin Fowler)](https://martinfowler.com/articles/data-fetch-spa.html) — parallel fetch patterns
