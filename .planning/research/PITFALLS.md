# Domain Pitfalls

**Domain:** Car rental management software — Akten module addition + feature polish
**Project:** Bemo Verwaltungssystem
**Researched:** 2026-03-26
**Confidence:** HIGH (derived from direct codebase analysis + verified against domain research)

---

## Critical Pitfalls

Mistakes that cause data corruption, security incidents, or rewrites.

---

### Pitfall 1: Duplicate Aktennummer Due to Race Condition

**What goes wrong:** Two users create a new Akte simultaneously. Both read the same "last Aktennummer" (e.g., AK-2026-005) and both generate AK-2026-006. One INSERT succeeds; the second either silently overwrites or crashes with a 500 if a UNIQUE constraint exists — but the `akten` table currently has no UNIQUE constraint on `aktennummer`.

**Why it happens:** The current `generateInvoiceNumber()` pattern (server.js lines 1100-1116) is a read-then-write without an atomic lock. The same pattern is copy-pasted into any new sequential number generation. sql.js is synchronous but Node.js is not — two overlapping HTTP requests can both enter the read-then-increment sequence before either completes the write.

**Consequences:** Duplicate Aktennummern break filing logic, cause legal ambiguity in case file references, and cannot be corrected without manual data cleanup.

**Prevention:**
- Add `UNIQUE` constraint on `aktennummer` column in `akten` table immediately.
- Wrap the read + increment + insert in a single SQLite transaction using `db.run('BEGIN'); ... db.run('COMMIT')` so the sequence is atomic.
- Alternatively, auto-generate the Aktennummer server-side (never trust a client-supplied value for sequential numbers) and apply a retry loop on UNIQUE constraint violation.

**Warning signs:** Two Akten with the same number appear in the list; a 500 error appears in server logs during concurrent creates.

**Phase:** Address before or during the Akten polish phase, before any multi-user testing.

---

### Pitfall 2: Permission Header Spoofing on New Akten Endpoints

**What goes wrong:** All authorization in this app reads `x-user-permission` from the HTTP request header (server.js lines 54-55). Any browser extension, API client, or compromised frontend can set this header to `Admin` and gain full CRUD access to Akten — including creating, editing, or deleting case files.

**Why it happens:** The existing admin guard for DELETE (server.js line 52) trusts the header directly. The new `/api/akten` endpoints inherit this pattern. There is no server-side session validation.

**Consequences:** Non-admin staff can modify or delete case files. In an insurance/legal context (Versicherungsfälle, Anwaltsakten) this is a serious integrity risk. If audited, forged records cannot be distinguished from legitimate ones.

**Prevention:**
- Before adding new features, implement session tokens: on login, issue a server-signed JWT or an opaque session ID stored in `sessions` table. Validate on every request — never trust permission headers from clients.
- At minimum, add a middleware function `requirePermission(level)` that validates against a server-side session store, not a request header. Apply it to all Akten write endpoints.
- If a full session system is out of scope for this milestone, document the risk explicitly and restrict Akten write endpoints to the same guard pattern — but do not introduce new unauthenticated write paths.

**Warning signs:** Any `/api/akten` POST/PUT/DELETE endpoint that only checks `req.headers['x-user-permission']` without session validation.

**Phase:** Security hardening phase. Must be addressed before deploying any new write endpoints to production.

---

### Pitfall 3: Akten as Free-Text Strings Break Relational Integrity

**What goes wrong:** The `akten` table stores `kunde`, `anwalt`, and `vermittler` as plain TEXT strings rather than foreign keys to `customers`, `lawyers`, and `vermittler` tables. If a lawyer's name changes, all Akten referencing the old name become stale. Deleting a Vermittler record leaves orphaned Akte entries pointing to a name that no longer resolves. Searching or filtering Akten by Vermittler requires string matching instead of ID lookup.

**Why it happens:** The original schema was built quickly as a flat-file list. The same pattern exists in `rentals.customer_name` (TEXT, not FK). It is easy to add and simple to display, but creates a fragile coupling by name rather than ID.

**Consequences:** Divergence between Stammdaten records and Akten records over time. Reports become inaccurate. Renaming a lawyer means manually updating all Akten. Referential integrity cannot be enforced by the database.

**Prevention:**
- Add `anwalt_id INTEGER REFERENCES lawyers(id)`, `vermittler_id INTEGER REFERENCES vermittler(id)`, and `customer_id INTEGER REFERENCES customers(id)` columns via migration.
- Keep the TEXT columns as display-only cache for cases where the related record was deleted (a common pattern in legal software: "Anwalt: Dr. Müller [gelöscht]").
- Use FK lookups in the GET endpoint JOIN so names are always current.

**Warning signs:** The form uses a free-text `<input>` for Anwalt/Vermittler/Kunde rather than a `<select>` loaded from the respective API.

**Phase:** Akten schema design phase, before the first production record is created. Migrating TEXT to FK after records exist requires data reconciliation.

---

### Pitfall 4: No Audit Trail on Case File Changes

**What goes wrong:** When an Akte's Zahlungsstatus changes from "offen" to "bezahlt", or when a case is marked "abgeschlossen", there is no record of who made the change or when. For insurance-related rental cases, this creates legal exposure if a dispute arises about when a case was closed or by whom.

**Why it happens:** The entire app has no audit logging (see CONCERNS.md — "Missing Critical Features"). Adding Akten without adding an audit log to that module repeats the same gap in a legally sensitive context.

**Consequences:** Cannot reconstruct case file history for legal disputes. GoBD requires traceable records for business-process documentation. A user can change the status of a case file and deny it; there is no way to prove otherwise.

**Prevention:**
- Add an `akten_history` table: `(id, akte_id, changed_by, changed_at, field_name, old_value, new_value)`.
- On every PUT to `/api/akten/:id`, diff old vs new values and insert one row per changed field into `akten_history`.
- Display the history in the Akte detail view (read-only, Verwaltung/Admin only).

**Warning signs:** The PUT endpoint for Akten modifies the record with no corresponding history INSERT.

**Phase:** Akten module implementation. Do not ship production Akten without history from day one — retrofitting history after records exist means the earliest records have no trail.

---

### Pitfall 5: Expanding the 10,000-Line app.js Without Isolating State

**What goes wrong:** Adding Akten detail views, linked sub-forms, or file attachments to `app.js` without a module boundary causes new `_aktenData` global variables to collide with page-navigation resets. For example: a user opens Akte detail, navigates away, navigates back — but `_aktenData` still contains stale data from the prior session because `renderAkten()` checks for a cached value instead of re-fetching.

**Why it happens:** The existing pattern (e.g., `let _aktenData = []` at file scope) is already present. Every render function calls `api('/api/akten')` on load, which is fine for the list — but if a detail view stores its own state in a global and that state is not cleared on page change, stale data silently persists.

**Consequences:** Users see outdated records. Status badges show old values. In a legal case file context, a user might act on stale information (e.g., think a case is still "offen" when it was just closed by a colleague).

**Prevention:**
- Always re-fetch from API on page render — never read from a global cache in render functions without a `stale` check.
- The existing `navigate(page)` function (app.js line 182: `main.innerHTML = '<div class="loading">Laden...</div>'`) clears the DOM. Use this as the contract: global page-level data variables (`_aktenData`, etc.) should be reset to `[]` at the top of each `renderX()` function, before the await, not after.
- If adding a detail view that needs local sub-state (attachments list, history), scope it within the detail function's closure, not at file scope.

**Warning signs:** `let _aktenXxx = ...` declared at the top of app.js file scope where it could persist across navigations.

**Phase:** Every new page/detail view added during the polish and Akten phases.

---

## Moderate Pitfalls

---

### Pitfall 6: Adding Schema Columns via try-catch Migration Without Validation

**What goes wrong:** Every new column added to `akten` (e.g., `anwalt_id`, `schadennummer`, `fahrzeug_id`) follows the existing try-catch pattern in db.js: `ALTER TABLE akten ADD COLUMN ... catch(e) {}`. If the `ALTER TABLE` fails for a reason other than "column already exists" (e.g., disk full, lock timeout, syntax error), the error is silently swallowed and the app starts with a missing column — then crashes at runtime when the INSERT tries to use it.

**Prevention:**
- After each `ALTER TABLE` try-catch, immediately follow with a validation query: `PRAGMA table_info(akten)` and verify the column exists. If it does not, throw a startup error before the app accepts traffic.
- Alternatively, implement the migration as a separate numbered migration file with a `schema_version` table so each migration runs exactly once and failures are logged, not swallowed.

**Warning signs:** New try-catch block added to db.js without a post-migration schema assertion.

**Phase:** Any schema change in db.js.

---

### Pitfall 7: Akten Aktennummer Auto-Increment Ignores Year Boundary

**What goes wrong:** The existing invoice number format is `MMJJJJXXX` (month + year + sequence). If Aktennummern follow a similar year-scoped format (e.g., AK-2026-001), the sequence counter must reset to 001 on January 1st. The current `generateInvoiceNumber()` already queries by prefix to find the last number — but if the year boundary logic is wrong, January will continue from last December's sequence (e.g., AK-2026-...098 becomes AK-2027-099 instead of AK-2027-001).

**Prevention:**
- When generating Aktennummern, always scope the MAX query to the current year prefix: `SELECT MAX(CAST(substr(aktennummer, ...) AS INTEGER)) FROM akten WHERE aktennummer LIKE 'AK-2027-%'`.
- Write a test (even a manual one-time check) that verifies year rollover produces 001.

**Warning signs:** The sequence query does not filter by year in the WHERE clause.

**Phase:** Akten module, number generation logic.

---

### Pitfall 8: Feature Polish Adds Fields Without Updating All Views

**What goes wrong:** When polishing an existing module (e.g., adding a `schadennummer` field to Akten or a missing `fahrzeug_id` to Vermietung), the field is added to the form and the database — but the list view, the detail modal, and the PDF export still omit it. Users enter data that then appears invisible in every other context.

**Why it happens:** In a 10,000-line app.js, render functions are far apart. It is easy to update `openAkteForm()` (line ~9725) but forget `openAkteDetail()` (line ~9695) and `renderAktenTable()` (line ~9631). The list table already omits `notizen`; adding a new field without checking all three view contexts repeats this pattern.

**Prevention:**
- For every new field, audit three locations before marking done: (1) form (`openXxxForm`), (2) detail view (`openXxxDetail`), (3) list table header + row.
- If a field is intentionally list-hidden (e.g., long notes), document this in a comment at the form definition.

**Warning signs:** A field exists in the form but the detail modal shows a static list of fields that was copy-pasted and not updated.

**Phase:** Every polish or field-addition task.

---

### Pitfall 9: S3 File Attachments on Akten Without Cleanup on Delete

**What goes wrong:** If Akten eventually support file attachments (uploaded to S3), deleting an Akte via DELETE `/api/akten/:id` does not trigger S3 object deletion. S3 objects accumulate indefinitely, incurring cost and leaving potentially sensitive documents (scanned insurance letters, legal correspondence) in storage after the case is deleted.

**Why it happens:** The existing `execute('DELETE FROM akten WHERE id=?')` has no cascading side-effect for S3. The S3 delete logic exists in server.js for the file module (`/api/files/delete`) but is not called from Akten delete.

**Prevention:**
- Before deleting an Akte, query `SELECT * FROM akte_files WHERE akte_id = ?`, call S3 `DeleteObjectCommand` for each key, then delete the DB records.
- If S3 deletion fails, do not proceed with the DB delete — return an error and surface it to the user.

**Warning signs:** DELETE endpoint for Akten calls `execute('DELETE FROM akten...')` without a preceding S3 cleanup step.

**Phase:** If/when file attachments are added to the Akten module.

---

### Pitfall 10: Email Notification Silent Failure on Case Status Change

**What goes wrong:** If status change notifications are added to Akten (e.g., notify the Anwalt when a case is closed), the existing O365 email integration silently swallows failures (server.js lines 1000-1033). The status update succeeds in the database, but the lawyer/intermediary is never notified. No error is shown to the user.

**Prevention:**
- Follow the fix pattern already documented in CONCERNS.md: return `{ success: true, warning: "Status aktualisiert, aber E-Mail-Benachrichtigung fehlgeschlagen: ..." }` and display it as a toast warning in the frontend.
- Do not block the status change on email success — email is non-critical; the database write is critical.

**Warning signs:** Akten PUT endpoint sends email in a try-catch that swallows the error and returns `{ success: true }` unconditionally.

**Phase:** If email notifications are added to Akten status changes.

---

## Minor Pitfalls

---

### Pitfall 11: Hardcoded AKTEN_STATUS Values Diverge Between Frontend and Backend

**What goes wrong:** `AKTEN_STATUS` and `AKTEN_ZAHLUNGSSTATUS` are defined in app.js (line ~9545). If the backend begins validating status values (which it currently does not), any status value added to the frontend list but not yet deployed on the backend causes a silent 400/500. Conversely, if the backend adds a status that the frontend list doesn't include, it cannot be set from the UI.

**Prevention:**
- Either serve the valid status lists from an API endpoint (`GET /api/akten/config`) so frontend and backend share a single source of truth, or add comments in both locations marking them as paired constants requiring simultaneous updates.

**Warning signs:** `AKTEN_STATUS` array defined only in app.js with no corresponding validation in server.js POST/PUT handler.

**Phase:** Akten module implementation.

---

### Pitfall 12: Polish Tasks Introduce Inconsistent Date Formatting

**What goes wrong:** The app uses `datum.split('-').reverse().join('.')` to display dates in German format (DD.MM.YYYY) in some places (e.g., Akten list, app.js line 9678) and ISO format (YYYY-MM-DD) in others. When polishing existing modules and adding new date fields, a developer copying from one module to another may use the raw ISO value for display, producing an inconsistency visible to users.

**Prevention:**
- Extract a `formatDateDE(isoString)` helper function and use it in every date display context. The pattern already exists inline; centralizing it prevents the inconsistency from spreading.

**Warning signs:** A date field displayed directly from `row.datum` without the `.split('-').reverse().join('.')` transform.

**Phase:** Every polish task touching date display.

---

### Pitfall 13: No Input Validation on Akten POST Allows Empty Aktennummern

**What goes wrong:** The current POST `/api/akten` handler (server.js line 2667) does not validate that `aktennummer` is non-empty before inserting. An Akte with `aktennummer = ''` is created silently and appears in the list with no identifier, making it unfindable by search and un-deletable by number.

**Prevention:**
- Add a validation guard: `if (!aktennummer || !aktennummer.trim()) return res.status(400).json({ error: 'Aktennummer ist Pflichtfeld' })`.
- Mirror this validation in the frontend form (the `required` attribute on the input already exists — verify the server also enforces it).

**Warning signs:** POST handler uses `aktennummer || ''` as the fallback, meaning empty string is a valid value.

**Phase:** Akten module hardening.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Akten schema design | Free-text strings for relational data (Pitfall 3) | Add FK columns before first production record |
| Akten number generation | Race condition duplicates (Pitfall 1) | UNIQUE constraint + atomic transaction |
| Akten number generation | Year-boundary sequence reset (Pitfall 7) | Scope MAX query to current year prefix |
| Any new write endpoint | Permission header spoofing (Pitfall 2) | requirePermission() middleware against session, not header |
| Status/payment changes | No audit trail (Pitfall 4) | `akten_history` table, populated in PUT handler |
| Feature polish (any module) | Field added to form but not detail/list (Pitfall 8) | Three-view checklist per field |
| db.js schema migrations | Silent ALTER TABLE failure (Pitfall 6) | Post-migration schema assertion |
| Page navigation / app.js | Stale global state (Pitfall 5) | Reset module data at top of each render function |
| Date display in polish tasks | Inconsistent DE/ISO formatting (Pitfall 12) | `formatDateDE()` helper function |
| Akten POST endpoint | Empty Aktennummer accepted (Pitfall 13) | Server-side non-empty validation |

---

## Sources

- Codebase direct analysis: `server.js`, `db.js`, `public/js/app.js` (2026-03-26)
- `.planning/codebase/CONCERNS.md` — known bugs, fragile areas, security considerations
- [GoBD 2025 Amendment — E-Invoice Archiving Rules (RTC Suite)](https://rtcsuite.com/germany-clarifies-e-invoice-archiving-rules-gobd-2025-amendment-how-businesses-must-now-store-einvoices/)
- [GoBD Requirements Germany: Complete Digital Record-Keeping Guide](https://invoicedataextraction.com/blog/gobd-compliance-germany)
- [SQLite Concurrency and Why You Should Care (HN)](https://news.ycombinator.com/item?id=45781298)
- [SQLite 4.0 as a Production Database: 2025 Benchmarks and Pitfalls (Markaicode)](https://markaicode.com/sqlite-4-production-database-benchmarks-pitfalls/)
- [How To Prevent Race Conditions in Database (Medium)](https://medium.com/@doniantoro34/how-to-prevent-race-conditions-in-database-3aac965bf47b)
- [Global Variables Cause Data Leaks in Node.js Servers (Aikido)](https://www.aikido.dev/code-quality/rules/why-global-variables-cause-data-leaks-in-node-js-servers)
- [Top 10 Application-Design Mistakes (NN/G)](https://www.nngroup.com/articles/top-10-application-design-mistakes/)
- Ersatzfahrzeug/Schadenfall domain research: [Leihwagen nach Unfall — autocrashexpert.de](https://www.autocrashexpert.de/leihwagen-nach-unfall/)
