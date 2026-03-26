# Domain Pitfalls: Akten-Modul

**Domain:** Adding case file management with cross-entity FK references to an existing monolithic SPA
**Project:** Bemo Verwaltungssystem
**Researched:** 2026-03-26
**Confidence:** HIGH — derived from direct codebase analysis (db.js, server.js, app.js) + verified domain research

---

## Critical Pitfalls

Mistakes that cause data corruption, silent data loss, security incidents, or rewrites.

---

### Pitfall 1: TEXT-to-FK Migration Silently Orphans Existing Akten Rows

**What goes wrong:**
The current `akten` table stores `kunde`, `anwalt`, and `vermittler` as free-text strings (e.g. `"Müller, Hans"`). Migrating to FK columns (`kunde_id INTEGER REFERENCES customers(id)`) requires matching existing text values to integer IDs. SQLite cannot `ADD CONSTRAINT` via `ALTER TABLE` — the only path to add a FK is table recreation (CREATE new, copy with JOIN, drop old, rename). If the JOIN misses a text value (name spelled differently, record deleted, extra whitespace), those rows silently get `NULL` for the FK column. Any query that filters by FK will not return them.

**Why it happens:**
The `db.js` migration pattern uses bare `try-catch` blocks that swallow all errors (lines 73–380). The same pattern used to add new columns also swallows a failed data migration. Zero rows migrated produces no exception. The app continues, the Akten appear missing, and no error trace points to the migration.

**Consequences:**
- Production Akten with non-matching text values become invisible in the UI after migration
- No rollback: sql.js `save()` overwrites the DB file atomically; once the file is written with NULLs, the prior state is gone unless a manual backup exists
- Insurance case history disappears with no audit record — GoBD-relevant

**Prevention:**
1. Before writing the migration: `SELECT COUNT(*) FROM akten WHERE kunde NOT IN (SELECT last_name || ', ' || first_name FROM customers)` — count unmatched rows. If any exist, the migration must handle them (fallback TEXT column, not NULL FK).
2. Do the migration in three steps: (a) ADD the new nullable FK column, (b) UPDATE it from a lookup, (c) verify `SELECT COUNT(*) FROM akten WHERE kunde_id IS NULL AND kunde != ''` = 0 before removing the TEXT column.
3. Never drop the original TEXT columns in the same migration step that populates the FK columns. Keep TEXT as a display fallback: "Anwalt: Dr. Müller [gelöscht]".
4. Call `save()` to a timestamped backup file immediately before running any migration that touches existing rows.

**Detection:**
`SELECT COUNT(*) FROM akten WHERE kunde_id IS NULL` after migration. If count exceeds the number of Akten that legitimately have no customer, rows were lost.

**Phase:** Phase 1 (schema migration). Must be resolved before UI development begins touching FK-based data.

---

### Pitfall 2: Aktennummer Race Condition Creates Duplicate Case Numbers

**What goes wrong:**
The `akten` table has no `UNIQUE` constraint on `aktennummer` (confirmed in db.js lines 468–482). The invoice number generator (`generateInvoiceNumber()`, server.js lines 1102–1116) demonstrates the exact same unsafe pattern: read the highest existing number, increment it, insert. Two concurrent POST requests to `/api/akten` that arrive within the same event loop cycle both read the same highest Aktennummer and both generate the same next number. Both inserts succeed because there is no constraint to block the second.

**Why it happens:**
sql.js is synchronous internally, but Node.js `async` request handlers interleave between `await` points. The sequence "read max → compute next → insert" is not atomic at the HTTP handler level. Under light concurrent usage this is unlikely; under a multi-tab workflow (two staff opening "Neue Akte" simultaneously) it is reproducible.

**Consequences:**
- Two Akten with the same Aktennummer in production — discovered by chance, not by any error
- Insurance correspondence references Aktennummern as case identifiers; duplicates cause real-world confusion
- GoBD requires unique, traceable identifiers for business process documentation

**Prevention:**
- Add `UNIQUE(aktennummer)` to the akten table schema immediately in the first db.js migration
- For auto-generation: scope the MAX query to the current year prefix and wrap in `db.run('BEGIN IMMEDIATE')` / `db.run('COMMIT')` to make the read-increment-insert atomic (SQLite IMMEDIATE lock blocks concurrent writes)
- Alternatively: generate the number as a timestamp-based string client-side, rely on the UNIQUE constraint to reject the rare collision, and retry once on HTTP 409

**Detection:**
`SELECT aktennummer, COUNT(*) FROM akten GROUP BY aktennummer HAVING COUNT(*) > 1` — run this on the production DB before and after enabling auto-generation.

**Phase:** Schema fix in Phase 1. Number generation implementation in Phase 2 (new Akte form). The UNIQUE constraint must exist before any number generation logic is written.

---

### Pitfall 3: Akten Stored as Free-Text Breaks Relational Integrity Over Time

**What goes wrong:**
`akten.kunde`, `akten.anwalt`, `akten.vermittler` are TEXT, not FK references to `customers`, `lawyers`, `vermittler` tables. If a lawyer's display name changes, all existing Akten still show the old name. Deleting a Vermittler leaves Akten with a string that resolves to nothing. The Akten detail view cannot link to the full Stammdaten record for that entity — it would need to search by name, which is ambiguous.

**Why it happens:**
The original schema was built as a flat filing list. The same free-text pattern exists in the rentals module. It is the simplest way to create a record quickly but the worst way to maintain relational consistency.

**Consequences:**
- Reports grouping Akten by Vermittler show split counts when a name is spelled inconsistently (e.g., "Müller GmbH" vs "Mueller GmbH")
- The new Vermittler-Daten-Block and Versicherungs-Daten-Block on the detail page cannot show current phone/email if data is stored as a text snapshot at creation time
- Referential integrity cannot be enforced by the database

**Prevention:**
- Add `anwalt_id INTEGER REFERENCES lawyers(id)`, `vermittler_id INTEGER REFERENCES vermittler(id)`, `customer_id INTEGER REFERENCES customers(id)`, `versicherung_id INTEGER REFERENCES versicherungen(id)` columns via migration
- Keep TEXT columns as read-only display cache for the "entity was deleted" case
- Forms use `<select>` dropdowns populated from the respective API endpoints, not free-text inputs

**Warning signs:** The Akte form uses `<input type="text">` for Anwalt, Vermittler, or Kunde rather than a `<select>` populated from `/api/lawyers`, `/api/vermittler`, `/api/customers`.

**Phase:** Schema design before first production record. Migrating TEXT to FK after records exist requires the data reconciliation process described in Pitfall 1.

---

### Pitfall 4: No Audit Trail on Case File Changes (GoBD Exposure)

**What goes wrong:**
When an Akte's `zahlungsstatus` changes from "offen" to "bezahlt" or `status` changes to "abgeschlossen", there is no record of who made the change or when. The current PUT `/api/akten/:id` handler (server.js lines 2676–2684) overwrites all fields with no diff or history write.

**Why it happens:**
The app has no audit logging anywhere (CONCERNS.md — "Missing Critical Features"). Adding Akten without audit logging repeats this gap in the most legally sensitive module in the system.

**Consequences:**
- Cannot reconstruct case file history for disputes with insurers or lawyers
- GoBD requires traceable records for business-process documentation; changes and who made them must be logged
- A staff member can change the payment status of a case and deny it; there is no way to demonstrate otherwise

**Prevention:**
- Add an `akten_history` table: `(id INTEGER PK, akte_id INTEGER, changed_by INTEGER, changed_at TEXT, field_name TEXT, old_value TEXT, new_value TEXT)`
- In every PUT handler for Akten: diff old vs new values (query before update, compare field by field), insert one row per changed field into `akten_history`
- Display the history in the detail view (read-only, Verwaltung/Admin visibility)
- The `akten_history` table must have no DELETE endpoint — append-only

**Warning signs:** The PUT endpoint calls `execute('UPDATE akten SET ...')` with no preceding `INSERT INTO akten_history`.

**Phase:** Akten module implementation. Do not deploy production Akten writes without history from day one — retrofitting history means the earliest records have no trail.

---

### Pitfall 5: Permission Header Spoofing on New Akten Write Endpoints

**What goes wrong:**
All authorization in the app reads `x-user-permission` from the HTTP request header (server.js lines 54–55). The current Akten endpoints (lines 2647–2690) have NO permission check — any request can create, modify, or delete Akten. New endpoints added for the detail page (linking Mietvorgang, updating Wiedervorlage, changing payment status) will inherit the same zero-protection pattern unless a check is explicitly added.

**Why it happens:**
The `server.js` pattern requires inline permission checks at every route. There is no global middleware enforcing authentication. New routes added by copying the current Akten handlers copy a handler that has no permission guard.

**Consequences:**
- Any user (including Benutzer-role) can currently modify case files
- Insurance-case-relevant fields (Zahlungsstatus, Abschlussdatum) can be changed without authorization
- Without an audit trail (Pitfall 4), unauthorized changes leave no evidence

**Prevention:**
- Every new Akten route must include `const permission = req.headers['x-user-permission'];` and the guard as the first lines, before any `req.body` destructuring
- Read-only endpoints (GET) should be accessible to all authenticated users but verify `x-user-id` is present
- Do not use the existing `POST /api/akten` handler as a template — it has no permission check

**Warning signs:** Any `/api/akten` POST/PUT/DELETE that does not begin with a permission level check.

**Phase:** Every phase that adds a new endpoint. Non-negotiable.

---

### Pitfall 6: Stale `_aktenData` Global Causes Wrong Data in Detail Page

**What goes wrong:**
The existing `renderAkten()` fetches `/api/akten` and stores results in the file-scope variable `_aktenData`. The current `openAkteDetail(id)` reads from this cached array (`_aktenData.find(x => x.id === id)`), not from the server. The new full-page detail view (`navigate('akte-detail', id)`) must fetch fresh data from the server. However, if the user navigates to the detail page via a direct state (e.g., after page load without visiting the list first), `_aktenData` is empty and the find returns `undefined`.

More critically: the detail page will make multiple async API calls (akte, customer, anwalt, versicherung, mietvorgang). If the user navigates away during these calls, all callbacks still fire and render into whatever DOM is currently displayed — overwriting the next page's content with data from the Akte they just left.

**Why it happens:**
The navigate function (app.js line 159) does not cancel in-flight async operations. The global `currentPage` variable is the only guard available, and it must be checked inside every async callback.

**Consequences:**
- Blank or wrong data in the detail view depending on navigation timing
- "Laden..." spinner that never clears if an async callback runs after the page was replaced
- Status fields showing values from a different Akte than the one displayed

**Prevention:**
1. Add `let currentAkteId = null;` as a global (mirroring `currentCustomerId`)
2. Set it at the top of `renderAkteDetail(id)` before any `await`
3. Inside every async callback in the detail renderer, check `if (currentPage !== 'akte-detail' || currentAkteId !== id) return;` before touching the DOM
4. The detail page always fetches `GET /api/akten/:id` directly — never reads from `_aktenData`
5. Reset `_aktenData = []` at the top of `renderAkten()` before the API fetch, so stale data is never served from cache

**Detection:** Navigate to an Akte detail, immediately click back to the list, observe whether the list DOM shows any bleed-through from the detail page's async callbacks.

**Phase:** Phase 2 (detail page). The `renderCustomerDetail` function is the correct model — follow it exactly.

---

### Pitfall 7: Multi-Source Data Loading Fails Entirely When One Entity Is Unset

**What goes wrong:**
The Akten detail page needs to display 4–5 data blocks: the Akte itself, the linked Kunde, Vermittler, Versicherung, and Mietvorgang. Using sequential `await` calls or `Promise.all()` means a single 404 (e.g., `mietvorgang_id` is NULL because no rental has been linked yet) aborts the entire render. The customer block, accident data, and every other field never render because one optional block returned an error.

**Why it happens:**
`Promise.all()` rejects on the first rejection. A `mietvorgang_id = NULL` fetch to `/api/vermietung/null` returns 404, which the `api()` helper throws. The outer try-catch catches it and renders a generic error page.

**Consequences:**
- An Akte without a Mietvorgang assigned yet (a common state at case creation) cannot be viewed at all
- Users cannot fill in optional fields progressively — the form is locked until every entity is assigned
- The "Laden..." state persists indefinitely if the error path doesn't explicitly clear it

**Prevention:**
Use `Promise.allSettled()` for all optional entity loads. The Akte record itself is required — throw if it fails. Every other block is optional — render "nicht zugewiesen" on rejection.

```javascript
const [akteResult, customerResult, mietResult] = await Promise.allSettled([
  api(`/api/akten/${id}`),
  customer_id ? api(`/api/customers/${customer_id}`) : Promise.resolve(null),
  mietvorgang_id ? api(`/api/vermietung/${mietvorgang_id}`) : Promise.resolve(null)
]);
if (akteResult.status === 'rejected') throw akteResult.reason;
const akte = akteResult.value;
const kunde = customerResult.status === 'fulfilled' ? customerResult.value : null;
// render each block independently
```

**Phase:** Phase 2 (detail page implementation). Establish this pattern before writing any block renderer — retrofitting it after building sequential `await` chains is tedious.

---

## Moderate Pitfalls

---

### Pitfall 8: db.js Migration try-catch Swallows Non-Duplicate-Column Failures

**What goes wrong:**
Every new column added to `akten` follows the existing pattern:
```javascript
try { db.run("ALTER TABLE akten ADD COLUMN kunde_id INTEGER"); } catch(e) {}
```
The catch is intentional for the "duplicate column name" case (migration already ran). But if the ALTER TABLE fails for any other reason — syntax error, disk full, ORM lock — the identical catch fires and the error is swallowed. The app starts with the column missing, then crashes at runtime when any INSERT or SELECT references it.

**Prevention:**
Check for the specific error text before swallowing silently:
```javascript
try { db.run("ALTER TABLE akten ADD COLUMN kunde_id INTEGER"); }
catch(e) { if (!e.message.includes('duplicate column name')) console.error('Migration warning (akten):', e.message); }
```
Additionally: after each migration block, run `PRAGMA table_info(akten)` and assert the expected column exists before the app accepts any traffic.

**Warning signs:** New `try { db.run('ALTER TABLE akten...') } catch(e) {}` block with no post-assertion and no error logging.

**Phase:** Every db.js change. Apply to all new Akten columns.

---

### Pitfall 9: Mietvorgang FK Orphans Akte When Rental Is Deleted

**What goes wrong:**
Adding `mietvorgang_id INTEGER REFERENCES vermietung(id)` without an ON DELETE strategy means deleting a rental from the Vermietung module silently orphans the Akte. The FK column holds a non-null ID with no corresponding row. The Mietvorgang block renders an error; the Akte itself is still functional but appears broken.

**Prevention:**
Use `ON DELETE SET NULL` on the `mietvorgang_id` FK — not `ON DELETE CASCADE`, which would delete the entire Akte when a rental is cancelled (clearly wrong for a case file). Add an application-layer warning: before deleting a Vermietung entry, check `SELECT COUNT(*) FROM akten WHERE mietvorgang_id = ?` and show a confirmation dialog if count > 0.

**Phase:** Phase 1 (schema). The ON DELETE clause must be in the initial column definition — it cannot be added retroactively via ALTER TABLE in SQLite without full table recreation.

---

### Pitfall 10: Full-Page Navigation Breaks Browser Back Button Expectation

**What goes wrong:**
The `navigate()` function (app.js line 159) does not interact with `window.history`. The browser back button exits the app entirely, not to the previous in-app page. For the Akte detail page — which has multiple editable fields and a "Wiedervorlage" date — users will instinctively use browser back to return to the Akten list and lose any unsaved form state.

**Prevention:**
Include a visible "Zurück zur Aktenliste" `<a class="back-link" onclick="navigate('akten')">` at the top of the detail page. This is the established pattern (customer-detail uses it). Do not rely on browser back. Consider adding a `beforeunload` guard for unsaved changes if the detail form allows inline editing.

**Phase:** Phase 2 (UI). Include the back-link element as part of the page template, not as a post-launch improvement.

---

### Pitfall 11: Aktennummer Year-Boundary Sequence Reset Breaks in January

**What goes wrong:**
If Aktennummern follow a year-scoped format (e.g., AK-2026-001), the sequence counter must reset to 001 on January 1st. The existing `generateInvoiceNumber()` queries by month-year prefix. A year-scoped Aktennummer generator that queries without a year filter will continue the December sequence into January (AK-2026-098 followed by AK-2027-099 instead of AK-2027-001).

**Prevention:**
Always scope the MAX query to the current year prefix:
```sql
SELECT aktennummer FROM akten
WHERE aktennummer LIKE 'AK-2027-%'
ORDER BY aktennummer DESC LIMIT 1
```
Write a manual test that verifies the first Akte created on a new year gets sequence 001.

**Phase:** Phase 2 (number generation). Verify during implementation, not post-release.

---

### Pitfall 12: Feature Polish Adds Fields to Form Without Updating List and Detail Views

**What goes wrong:**
When adding new fields to the Akte (Unfalldatum, Unfallort, Polizei vor Ort, Mietart, Wiedervorlage), the field is added to `openAkteForm()` and the database column is added in `db.js` — but `renderAktenTable()` (line 9631) and `openAkteDetail()` (line 9695) are not updated. Users enter data that appears in the edit form but is invisible everywhere else.

**Why it happens:**
In a 10,000-line `app.js`, the three render contexts for a single module (form, detail, list row) are 50–200 lines apart from each other. It is easy to update one and forget the others. The existing Akten module already exhibits this: `notizen` is in the form and detail modal but not in the list table.

**Prevention:**
For every new field, audit three locations before marking the task done:
1. `openAkteForm()` — form input
2. Detail page renderer — display block
3. `renderAktenTable()` — list column header and cell (or document why the field is intentionally list-hidden)

**Phase:** Every field addition in Phases 2–3.

---

### Pitfall 13: Empty Aktennummer Accepted by Current POST Endpoint

**What goes wrong:**
The current POST `/api/akten` handler (server.js line 2668) uses `aktennummer || ''` as the fallback — meaning an Akte with no number is a valid database record. The list view displays an empty `<strong></strong>` cell, and search (`aktennummer LIKE ?`) cannot find it. It cannot be meaningfully filed or referenced.

**Prevention:**
Add server-side validation: `if (!aktennummer || !aktennummer.trim()) return res.status(400).json({ error: 'Aktennummer ist Pflichtfeld' });`. The frontend `required` attribute exists already — this ensures the server enforces the same rule independently.

**Phase:** Phase 1 (endpoint hardening). Should be added as part of the same PR that adds the UNIQUE constraint.

---

### Pitfall 14: Status Constants Defined Only in Frontend, Not Validated in Backend

**What goes wrong:**
`AKTEN_STATUS` and `AKTEN_ZAHLUNGSSTATUS` are JavaScript arrays defined only in `app.js`. The backend accepts any string value for `status` and `zahlungsstatus` fields without validating against the known list. A typo or a direct API call can write `"Offen"` (uppercase O) or `"in_bearbeitung"` (underscore) to the database, causing status badges to render with the grey fallback color (unknown status) and filter dropdowns to show zero results for that status.

**Prevention:**
Add an allowed-values check in the POST and PUT handlers:
```javascript
const VALID_STATUS = ['offen', 'in Bearbeitung', 'abgeschlossen', 'storniert'];
if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
```
Or serve the valid list from `GET /api/akten/config` so frontend and backend share a single source.

**Phase:** Phase 1 (endpoint hardening).

---

### Pitfall 15: Date Fields Converted Through `new Date()` Shift by Timezone

**What goes wrong:**
Dates stored as `TEXT` in SQLite (`YYYY-MM-DD`) are correct when taken directly from an `<input type="date">` value. If any code path passes the date through `new Date(value).toISOString()`, the ISO string will include a UTC offset: `"2026-04-01T22:00:00.000Z"` for a Berlin user entering April 1st (CEST = UTC+2). Stored as TEXT, this writes `"2026-04-01T22:00:00.000Z"` to the database. Displayed with the existing `datum.split('-').reverse().join('.')` formatter, it shows `"000Z.00.2026-04-01T22"` — a broken display.

**Prevention:**
Use `document.getElementById('akte-datum').value` directly (returns `"2026-04-01"`). Never pass a date-input value through `new Date()`. The existing helpers `berlinToday()` and `berlinNow()` are for server-side timestamps only.

**Phase:** Phase 2 (form implementation). Applies to every date field: Unfalldatum, Wiedervorlage.

---

## Phase-Specific Warnings Summary

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Phase 1: Schema — Add FK columns | Silent ALTER TABLE failure (Pitfall 8) | Log non-duplicate-column errors; assert column exists post-migration |
| Phase 1: Schema — TEXT-to-FK migration | Unmatched text values become NULL (Pitfall 1) | Pre-count mismatches; keep TEXT fallback; verify NULLs = 0 before dropping |
| Phase 1: Schema — Aktennummer | No UNIQUE constraint (Pitfall 2) | Add UNIQUE before enabling auto-generation |
| Phase 1: Schema — Mietvorgang FK | Orphan reference on rental deletion (Pitfall 9) | ON DELETE SET NULL in initial column definition |
| Phase 1: Endpoints — POST/PUT | Empty Aktennummer accepted (Pitfall 13) | Server-side non-empty validation |
| Phase 1: Endpoints — all writes | No permission check on existing routes (Pitfall 5) | Add permission guard as first line in every handler |
| Phase 1: Endpoints — PUT | No audit trail (Pitfall 4) | `akten_history` table; diff and insert on every PUT |
| Phase 1: Endpoints — status fields | Invalid status strings accepted (Pitfall 14) | Allowed-values validation in POST/PUT |
| Phase 2: Detail page — navigation | Stale global state, async race (Pitfall 6) | `currentAkteId` guard in every async callback |
| Phase 2: Detail page — sub-entity loading | One 404 aborts all blocks (Pitfall 7) | `Promise.allSettled()` for optional FKs |
| Phase 2: Detail page — back button | Browser back exits app (Pitfall 10) | Visible `back-link` in page template |
| Phase 2: Number generation | Year-boundary sequence not reset (Pitfall 11) | Scope MAX query to current year prefix |
| Phase 2: Form — date fields | `new Date()` timezone shift corrupts date (Pitfall 15) | Use `input.value` directly |
| Phase 2–3: Any field addition | Field in form but not in detail/list views (Pitfall 12) | Three-view checklist per field |
| Phase 3+: Relational integrity over time | Free-text entities diverge from Stammdaten (Pitfall 3) | FK columns with Stammdaten dropdowns in forms |

---

## Sources

- Direct codebase analysis: `server.js`, `db.js`, `public/js/app.js` — 2026-03-26 (HIGH confidence — primary sources)
- `.planning/codebase/CONCERNS.md` — known bugs, fragile areas, security considerations (HIGH confidence — internal analysis)
- [SQLite Foreign Key Support — sqlite.org](https://sqlite.org/foreignkeys.html) (HIGH confidence — official documentation)
- [A mere add_foreign_key can wipe out your whole Rails+SQLite production table — kyrylo.org, 2025](https://kyrylo.org/software/2025/09/27/a-mere-add-foreign-key-can-wipe-out-your-whole-rails-sqlite-production-table.html) (MEDIUM confidence — real-world incident, directly applicable)
- [Alembic batch migrations for SQLite — alembic.sqlalchemy.org](https://alembic.sqlalchemy.org/en/latest/batch.html) (HIGH confidence — official docs on SQLite table recreation constraint)
- [GoBD explained: Requirements for bookkeeping and digital archiving — fiskaly.com](https://www.fiskaly.com/blog/understanding-gobd-compliant-archiving) (MEDIUM confidence — practitioner guide, consistent with known GoBD scope)
- [GoBD 2025 amendment on e-invoice archiving — aodocs.com](https://www.aodocs.com/blog/gobd-explained-requirements-for-audit-ready-digital-bookkeeping-in-germany-and-beyond/) (MEDIUM confidence — current year, relevant to audit trail requirement)
