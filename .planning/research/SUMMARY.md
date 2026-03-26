# Project Research Summary

**Project:** Bemo Verwaltungssystem — Akten-Modul (v1.0)
**Domain:** Case file management for insurance-replacement car rental (Unfallersatz)
**Researched:** 2026-03-26
**Confidence:** HIGH

## Executive Summary

The Akten-Modul is not a general-purpose document manager — it is a case file system built around the German Unfallersatz workflow: every rental is tied to an insurance claim, a repair shop, and often a lawyer. An "Akte" is a legal case container that groups all parties (customer, Versicherung, Anwalt, Vermittler) and the rental record into one traceable unit. The existing module scaffold is further along than it appears — a full CRUD API, list page, and form exist in `server.js` and `app.js` — but it has critical gaps: all relational fields are stored as free text with no foreign keys, there is no audit trail, write endpoints have no permission checks, and the detail view is a limited modal rather than a full-page record.

The recommended approach is strictly additive and zero-new-dependencies: add nullable FK columns alongside the existing text columns (preserving production data), build an enriched `GET /api/akten/:id` that assembles all related entities server-side before responding, and replace the detail modal with a full-page view using the `navigate()` / `renderXDetail()` pattern already established by `renderCustomerDetail`, `renderFuhrparkDetail`, and `renderInvoiceDetail`. All required capabilities — FK migrations, cross-entity data loading, full-page navigation, Stammdaten sub-requests — are achievable with the existing stack. The work is SQL schema additions, two new/modified server.js endpoints, and frontend wiring in `app.js`.

The two non-negotiable requirements that must be in Phase 1 before any UI ships are: (a) an `akten_history` audit table with diff-on-PUT logic, because GoBD requires traceable history on insurance case files from the first production record, and (b) permission guards on all Akten write endpoints, because the current POST/PUT/DELETE handlers have no authorization check whatsoever. Skipping either in favor of speed leaves a legally sensitive module with no accountability trail and open to unauthorized modification by any user role.

---

## Key Findings

### Recommended Stack

Zero new npm dependencies are required for this milestone. Every capability the Akten-Modul needs is already present or is a pure code pattern. The only gap is a missing `GET /api/rentals/:id` endpoint (only the list endpoint exists), which must be added so the detail page can fetch a single rental's vehicle data. The existing stack is fully locked for this milestone.

**Core technologies:**
- **sql.js (SQLite WASM) 1.11.0** — schema migration via 9x `ALTER TABLE ADD COLUMN` (additive, no FK constraints in ALTER TABLE); `PRAGMA foreign_keys` behavior verified against official SQLite docs; existing `queryAll` / `queryOne` / `execute` helpers used throughout
- **Express.js 4.21.0** — new `fetchStammdatenById()` async helper for internal Stammdaten sub-requests (the existing `proxyStammdatenRequest` writes directly to `res` and cannot be reused server-side); enriched async `GET /api/akten/:id` handler
- **Vanilla JS `api()` + `navigate()`** — `Promise.all` for parallel picker loads in `openAkteForm()`; single enriched API call in `renderAkteDetail()`; no new routing library; no additional client-side libraries

See [STACK.md](.planning/research/STACK.md) for the complete ALTER TABLE migration code, the `fetchStammdatenById()` helper pattern, and the explicit list of rejected libraries with rationale.

### Expected Features

The Akten module is the primary deliverable. The hard dependency chain is: Customer + Stammdaten entities (exist) → Rental record (basic structure exists) → Akte (case file) → Invoice (exists, needs Akte link). The Akte is the integrating container for all prior work.

**Must have (table stakes):**
- Akte as case container linking customer, rental vehicle, Versicherung, Anwalt, Vermittler — the primary deliverable
- Schadensfahrzeug reference (damaged vehicle distinct from the rental car) — fundamental to Unfallersatz documentation
- Kostenübernahme-Typ (who pays: gegnerische Haftpflicht / Kasko / Selbstzahler) — determines billing address and rate
- Unfalldaten block (Unfalldatum, Unfallort, Polizei vor Ort) — required for insurance claim documentation
- Status workflow per Akte (Neu, In Bearbeitung, Fahrzeug ausgegeben, Reparatur abgeschlossen, Rechnung gestellt, Abgeschlossen)
- Notes / Verlauf (timestamped case history log with author)
- Full-page detail view replacing the current read-only modal
- Search and filter on the Akten list view
- Audit trail (akten_history table) — legally required under GoBD from day one

**Should have (operational value):**
- Akte → Invoice link with one-click generation (eliminates re-entry, highest-value integration in the system)
- Wiedervorlage (follow-up date) field — already in schema plan, low effort
- Status badges on list rows (pattern already exists on invoices)
- Customer detail view showing linked Akten inline

**Defer to v2+:**
- Schadenskarte (SVG damage diagram) — high complexity; photo upload + notes is sufficient for v1
- Übergabeprotokoll / Rückgabeprotokoll PDF — depends on completing the full rental data model first
- Cross-module search — build after all module data models are stable
- Email notifications on Akte status change — infrastructure exists (O365), but adds complexity; not blocking
- Dashboard KPIs — low effort but not blocking core workflow

See [FEATURES.md](.planning/research/FEATURES.md) for the full feature dependency graph and the Unfallersatz-specific context.

### Architecture Approach

The Akten detail page follows the monolithic SPA pattern established by `renderCustomerDetail`, `renderFuhrparkDetail`, and `renderInvoiceDetail` exactly: list row click triggers `navigate('akte-detail', id)`, which calls a single enriched `GET /api/akten/:id`. The backend assembles the full response — local SQLite JOINs for customer and rental, parallel `fetchStammdatenById()` calls for Vermittler and Versicherung — before responding. The frontend renders all data blocks from one JSON response. No multiple frontend API calls, no URL routing, no new client-side libraries.

**Major components:**
1. **db.js** — 9 new `ALTER TABLE ADD COLUMN` migrations (customer_id, rental_id, vermittler_id, versicherung_id, mietart, wiedervorlage, unfallDatum, unfallOrt, polizei) + new `akten_history` table; UNIQUE constraint on aktennummer
2. **server.js** — `fetchStammdatenById()` async helper; enriched async `GET /api/akten/:id`; extended `PUT /api/akten/:id` with audit diff-and-insert; `GET /api/rentals/:id` (new); permission guards added to all Akten write endpoints
3. **app.js** — `renderAkteDetail(id)` full-page renderer (new); extended `openAkteForm()` with parallel picker loads for customer / rental / Vermittler / Versicherung; extended `saveAkte()` with new FK fields; list row click changed from modal to `navigate('akte-detail', id)`; `openAkteDetail()` modal removed after verification

See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for the 11-step tiered build order, the enriched JSON response shape, anti-patterns with explanations, and the FK migration dual-display strategy.

### Critical Pitfalls

1. **Silent TEXT-to-FK nulling destroys production data** — Any name-matching migration that fails to resolve a text value writes NULL to the FK column; existing Akten become invisible in the UI with no error logged and no rollback possible. Prevention: additive columns only, keep text columns as display fallback forever, verify `SELECT COUNT(*) FROM akten WHERE customer_id IS NULL` post-migration, never batch-migrate by name-matching. (PITFALLS.md: Pitfalls 1, 3)

2. **No audit trail violates GoBD compliance** — The current PUT handler overwrites with no diff history. The `akten_history` table must exist before the first production Akte write — retrofitting leaves early records with no trail. Prevention: create `akten_history` in Phase 1 schema; diff old vs new on every PUT; make the table append-only (no DELETE endpoint). (PITFALLS.md: Pitfall 4)

3. **Zero permission checks on all five existing Akten endpoints** — Any user of any role can currently create, modify, or delete Akten. Any new endpoint added by copying the existing handlers inherits this gap. Prevention: permission check as the first two lines of every write handler; treat as non-negotiable for all new routes. (PITFALLS.md: Pitfall 5)

4. **Async race on detail page navigation corrupts DOM** — `navigate()` does not cancel in-flight async calls; callbacks from a previous Akte fetch fire into the next page's DOM. Prevention: `currentAkteId` global guard checked inside every async callback; `Promise.allSettled()` for optional sub-entity fetches so a single null FK (no rental linked yet) does not abort the entire page render. (PITFALLS.md: Pitfalls 6, 7)

5. **Aktennummer has no UNIQUE constraint and is race-vulnerable** — Two concurrent POSTs both read the same max Aktennummer and insert the same next value. No database constraint prevents duplicate case numbers. Prevention: add `UNIQUE(aktennummer)` in Phase 1 schema before any number generation logic is written; scope the MAX query to the current year prefix for correct year-boundary reset. (PITFALLS.md: Pitfalls 2, 11)

See [PITFALLS.md](.planning/research/PITFALLS.md) for all 15 pitfalls with phase-specific warning tables and prevention code snippets.

---

## Implications for Roadmap

Research points to a 3-phase structure driven by two hard constraints: (a) schema and endpoint hardening must come before any UI change saves FK-based data to the database; (b) the detail page depends on the enriched backend endpoint, which depends on the schema having the FK columns.

### Phase 1: Schema Hardening and Endpoint Security

**Rationale:** The schema migration is the highest-risk operation in the milestone. It must run in production before any frontend change can store or display FK-linked data. The permission guards and audit trail cannot be retrofitted — every record written before these exist has no authorization check and no history. These changes produce no user-visible UI change, which minimizes deployment risk.

**Delivers:** Production-safe schema with 9 new FK/field columns; `akten_history` table; `UNIQUE(aktennummer)` constraint; permission guards on all Akten write endpoints; server-side validation for required fields (Aktennummer non-empty, status allowed-values list); `ON DELETE SET NULL` on rental_id FK; non-silencing error logging in ALTER TABLE catch blocks.

**Addresses:** Audit trail (GoBD), Aktennummer uniqueness, authorization on write endpoints, Unfalldaten fields, Wiedervorlage field, Kostenübernahme-Typ.

**Avoids:** Pitfalls 1 (data loss), 2 (duplicate numbers), 4 (GoBD audit), 5 (permission spoofing), 8 (migration error swallowed), 9 (FK orphan on rental delete), 13 (empty Aktennummer accepted), 14 (invalid status strings accepted).

**Files:** `db.js`, `server.js`.

### Phase 2: Full-Page Detail View and Form Upgrade

**Rationale:** With the schema and endpoints solid, the full-page detail page is a direct application of an established codebase pattern. Three identical implementations exist as templates. The form upgrade replaces free-text inputs with FK-backed dropdowns, ensuring new records are properly linked from the first save. The `renderAkteDetail()` function is the primary user-visible deliverable of the milestone.

**Delivers:** Full-page Akte detail view with enriched data blocks (Kerndaten, Unfalldaten, Kundendaten, Mietvorgang, Vermittler, Versicherung); upgraded form with customer / rental / Vermittler / Versicherung selector dropdowns; read-only `akten_history` display block (admin-visible); enriched `GET /api/akten/:id` backend endpoint; `GET /api/rentals/:id` endpoint (new); `fetchStammdatenById()` helper; list row click navigates to detail page; `openAkteDetail()` modal removed after verification.

**Addresses:** Full-page detail view (table stakes), typed FK dropdowns for new records, legacy text display fallback with "nicht verknüpft" badge, audit history visibility for Verwaltung/Admin roles.

**Avoids:** Pitfalls 6 (stale global / async race), 7 (one failed optional fetch aborts all blocks), 10 (back button exits app — back-link required), 11 (year-boundary sequence reset), 12 (field added to form but not in detail/list — three-view checklist), 15 (date input via `new Date()` causes timezone shift — use `input.value` directly).

**Files:** `server.js` (new and modified endpoints), `app.js` (renderAkteDetail, openAkteForm, saveAkte, navigate switch, list row click).

### Phase 3: Rental Module Completion and Billing Close

**Rationale:** The Akte-to-rental link created in Phase 2 is only as useful as the rental record it points to. The full Mietvertrag data model (mileage, fuel level, deposit, driver's license, pickup/return location) is needed before Übergabe/Rückgabe protocols and PDF generation are meaningful. Completing this phase closes the Unfallersatz paper trail end-to-end.

**Delivers:** Complete rental data model with all required fields; rental status states; Übergabeprotokoll and Rückgabeprotokoll field structure; PDF generation for rental contract and handover protocol (reusing existing pdfkit pattern from invoices); Akte-to-invoice link with one-click generation.

**Addresses:** Mietvertrag (table stakes), Übergabeprotokoll, Rückgabeprotokoll, PDF generation, invoice generation from Akte.

**Defers:** Schadenskarte (SVG damage diagram), cross-module search, email notifications on status change, dashboard KPIs — all v2+.

**Files:** `db.js` (rental schema additions), `server.js` (rental endpoints, PDF templates), `app.js` (rental form, protocol views, PDF trigger, Akte-to-invoice button).

### Phase Ordering Rationale

- Phase 1 before Phase 2: The `openAkteForm()` upgrade in Phase 2 saves FK IDs. If the FK columns do not exist, those saves either crash or write junk data. Schema first is non-negotiable.
- Phase 2 before Phase 3: The Akte-to-rental link must be working and verified before the full rental data model is expanded. Adding rental fields before the link exists means testing the link against an unstable schema.
- Defer PDF and protocols to Phase 3: The pdfkit template for a Mietvertrag requires all rental fields to be present. Building the template before the data model is complete means rebuilding it when fields are added.

### Research Flags

Phases where deeper research is likely needed during planning:

- **Phase 1 (akten_history design):** Field-level diff vs full-row JSON snapshot — the tradeoffs for query complexity, storage, and GoBD auditability should be confirmed before the table schema is finalized. Brief research-phase pass recommended.
- **Phase 3 (PDF templates with pdfkit):** The existing invoice PDF template needs to be studied before designing the Mietvertrag and Übergabeprotokoll templates. Layout requirements (signature lines, field order, whether a visual damage diagram space is required) need client input.

Phases with well-documented patterns (skip research-phase):

- **Phase 1 (schema migrations, permission guards, validation):** Fully documented in STACK.md and PITFALLS.md with verified code patterns and exact line numbers from the codebase.
- **Phase 2 (detail page, form upgrade):** Three identical patterns exist in `app.js`. The architecture is fully specified in ARCHITECTURE.md with code snippets and exact file locations. Direct implementation from the research files.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct codebase inspection and official SQLite documentation. Zero new dependencies required — no inference or training-data assumptions used. |
| Features | MEDIUM | German market sources (Rentsoft, Remoso) are authoritative for DE context but are marketing content. Unfallersatz workflow requirements cross-referenced with DE legal/attorney sources. Feature priority inferred from PROJECT.md and domain research — no direct client interview on this milestone. |
| Architecture | HIGH | All findings from direct code inspection of `app.js`, `server.js`, `db.js` with confirmed line numbers. No inference — patterns verified against actual existing implementations. |
| Pitfalls | HIGH | 15 pitfalls derived from direct codebase analysis of known vulnerabilities plus official SQLite and GoBD documentation. One real-world SQLite FK data-loss incident cross-referenced (kyrylo.org 2025). |

**Overall confidence:** HIGH

### Gaps to Address

- **Schadensfahrzeug storage strategy:** FEATURES.md identifies the damaged vehicle (distinct from the rental car) as a table-stakes field. The research files do not resolve whether to add columns directly to `akten` or create a separate `schadenfahrzeuge` table. This decision belongs in Phase 1 schema design — resolve before writing migrations.
- **Stammdaten service endpoint paths:** ARCHITECTURE.md references `/api/vermittler/:id` and `/api/insurances/:id` as Stammdaten paths. The exact paths should be verified against the live stammdaten service (port 3010) before writing `fetchStammdatenById()` calls — a mismatched path returns null silently.
- **Existing production Akten volume:** The additive migration approach was chosen conservatively. Running `SELECT COUNT(*) FROM akten WHERE kunde != ''` on the production DB before Phase 1 would confirm how many existing records will show "nicht verknüpft" after migration, informing whether staff need a guided re-linking workflow.
- **Aktennummer format:** The exact format (e.g., `AK-2026-001` vs another convention) is not confirmed in PROJECT.md. Validate with the client before Phase 1, because the UNIQUE constraint and year-boundary MAX query depend on the prefix structure.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `db.js` (full file, 522 lines), `server.js` (~2763 lines), `public/js/app.js` (~10,000 lines) — 2026-03-26
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, `.planning/PROJECT.md`
- [SQLite ALTER TABLE — sqlite.org](https://www.sqlite.org/lang_altertable.html) — 12-step table reconstruction procedure
- [SQLite Foreign Key Support — sqlite.org](https://sqlite.org/foreignkeys.html) — PRAGMA behavior and enforcement rules
- [Martin Fowler — Data Fetching Patterns in SPAs](https://martinfowler.com/articles/data-fetch-spa.html) — parallel fetch patterns

### Secondary (MEDIUM confidence)
- [Rentsoft Autovermietung Features — rentsoft.de](https://rentsoft.de/branchen/autovermietung/) — German market rental software; DE workflow patterns
- [Remoso Car Rental Software — remoso.com](https://www.remoso.com/en/software-solutions/car-rental-software) — German market product comparison
- [Mietwagen Übergabeprotokoll — billiger-mietwagen.de](https://www.billiger-mietwagen.de/faq/mietwagen-uebergabeprotokoll.html) — protocol field requirements
- [Unfallrechtler Stuttgart — Mietwagen beim Unfallschaden](https://www.unfallrechtler-stuttgart.de/unfallschaden-a-z/mietwagen/) — DE legal documentation requirements
- [GoBD explained — fiskaly.com](https://www.fiskaly.com/blog/understanding-gobd-compliant-archiving) — audit trail compliance guidance
- [GoBD 2025 amendment — aodocs.com](https://www.aodocs.com/blog/gobd-explained-requirements-for-audit-ready-digital-bookkeeping-in-germany-and-beyond/) — current year, relevant to audit trail requirement
- [Add a Foreign Key to an Existing SQLite Table — database.guide](https://database.guide/add-a-foreign-key-to-an-existing-table-in-sqlite/) — migration pattern example

### Tertiary (supporting / corroborating)
- [Adamosoft — Car Rental Management Software Features](https://adamosoft.com/blog/travel-software-development/must-have-features-of-car-rental-management-software/) — US-market marketing content, cross-referenced with DE sources
- [SQLite FK migration data-loss incident — kyrylo.org, 2025](https://kyrylo.org/software/2025/09/27/a-mere-add-foreign-key-can-wipe-out-your-whole-rails-sqlite-production-table.html) — real-world incident validating Pitfall 1

---
*Research completed: 2026-03-26*
*Ready for roadmap: yes*
