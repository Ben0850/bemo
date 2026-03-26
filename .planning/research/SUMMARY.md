# Project Research Summary

**Project:** Bemo Verwaltungssystem
**Domain:** Car rental management (Autovermietung) — Unfallersatz / accident replacement vehicles
**Researched:** 2026-03-26
**Confidence:** HIGH

## Executive Summary

Bemo is a single-tenant internal management system for a German car rental company specializing in Unfallersatz (accident replacement vehicles). The system is already in production with most foundational modules complete. The current milestone has two tracks: (1) infrastructure and security hardening of the existing stack, and (2) completing the Akten module — a case file system that tracks the full insurance/legal/rental workflow around each accident claim. The core insight from domain research is that the Akten module is not a simple rental record; it is a legal case container linking a customer, a rental vehicle, a damaged vehicle, an insurer, a lawyer, and a broker — and it carries compliance obligations (GoBD) that require an immutable audit trail from day one.

The recommended approach is additive and low-risk: replace the critical sql.js database layer with better-sqlite3 (eliminating data-loss-on-crash risk), upgrade Express to v5, add Zod validation and security middleware, and then build out the Akten module on the improved foundation. The existing Akten scaffold is further along than it appears — CRUD API, list page, and form all exist — but it has architectural gaps: all relational fields (customer, lawyer, broker) are stored as free text with no foreign keys, there is no audit trail, and Aktennummer generation has a race condition. These gaps must be closed before the module handles production case files.

The principal risks are data integrity and security. The sql.js in-memory-flush architecture can lose writes on crash; permission authorization relies entirely on a spoofable HTTP header rather than server-side sessions; and the Akten module currently has no audit log despite operating in a legally sensitive insurance context. The recommended mitigation sequence is: fix the database layer first (foundation), apply security hardening (auth and validation), then build Akten features on the solid base. Skipping the infrastructure phase to move faster on features would leave a production system with known data-loss and authorization vulnerabilities.

---

## Key Findings

### Recommended Stack

The existing stack (Node 20 / Express 4 / sql.js / PDFKit / AWS S3 / Azure MSAL / Vanilla JS) is sound except for sql.js, which is the highest-priority replacement. All other changes are incremental improvements, not rewrites. No frameworks, ORMs, TypeScript, or build tools should be introduced — the project constraints are firm and the cost/benefit is negative.

**Core technologies:**
- **better-sqlite3 @ 12.8.0** (replaces sql.js) — native SQLite bindings; eliminates data-loss-on-crash, 2x performance improvement, simpler synchronous API; requires switching Docker base from `node:20-alpine` to `node:20-slim`
- **express @ 5.2.1** (upgrade from 4.21.0) — async route errors auto-propagate to error middleware; removes dozens of manual try/catch wrappers; low migration risk
- **zod @ 3.25.x** (new) — schema validation middleware for all write endpoints; prevents malformed data reaching the database; v3 not v4 (v4 is breaking change)
- **helmet @ 8.x** (new) — one-line HTTP security header hardening; zero performance cost
- **express-rate-limit @ 7.x** (new) — brute-force protection on auth endpoints; memory store sufficient for single-instance deployment
- **pdfkit @ 0.18.0** (upgrade from 0.17.2) — minor bump only; no architectural change

See `.planning/research/STACK.md` for full version matrix and migration notes.

### Expected Features

The Akten module is the main new deliverable. It models the German Unfallersatz workflow: one Akte represents one accident claim and links the rental vehicle, the damaged vehicle, the insurer (Versicherung), the lawyer (Anwalt), the broker (Vermittler), and the customer into a single case file.

**Must have (table stakes):**
- Akte as case container with all linked parties (customer, Versicherung, Anwalt, Vermittler)
- Schadensfahrzeug (damaged vehicle) reference — distinct from rental car, needed for claim tracking
- Kostenübernahme-Typ — who pays (gegnerische Haftpflicht / Kasko / Selbstzahler); determines billing
- Status workflow per Akte (Neu → In Bearbeitung → Ausgegeben → Reparatur abgeschlossen → Rechnung gestellt → Abgeschlossen)
- Notes/Verlauf (case history log) with timestamps and author
- Full Mietvertrag data model (pickup/return times, mileage, fuel level, deposit, driver's license)
- Rental status states (Angebot / Gebucht / Ausgegeben / Zurückgegeben / Abgerechnet / Storniert)
- Rental linked to Akte and to Invoice — closes the billing loop
- Übergabeprotokoll and Rückgabeprotokoll fields (required for damage dispute protection under DE law)
- PDF generation for rental contract and handover protocol (pdfkit pattern already exists for invoices)

**Should have (differentiators vs. manual processes):**
- Akte → Invoice generation in one click (eliminates re-entry of data)
- Document attachments per Akte via existing S3 integration (using `akten/{id}/` folder convention)
- Customer detail view shows linked Akten inline
- Rental calendar integration (vehicle availability visible alongside rental dates)
- Audit trail (akten_history table) for GoBD compliance

**Defer (v2+):**
- Schadenskarte (SVG damage diagram) — high complexity; photo upload + notes is sufficient for now
- Cross-module search — build after all modules have stable data models
- Email notifications on Akte status changes — infrastructure exists (O365), but adds complexity; defer until core workflow is stable
- Dashboard KPIs — low effort, but not blocking

See `.planning/research/FEATURES.md` for full feature table with complexity ratings and dependency graph.

### Architecture Approach

The Akten module has a working scaffold (CRUD API at server.js:2647, list page renderAkten(), detail modal, and create/edit form in app.js). The architectural work is connecting the dots: adding FK columns alongside existing text columns (non-breaking migration), replacing free-text inputs with typed selects loaded from Stammdaten API, and reusing the existing S3 upload/list endpoints with an `akten/{id}/` folder convention. No new backend services, no extracted route files, no changes to the monolith pattern.

**Major components:**
1. **db.js schema migration** — add `customer_id`, `anwalt_id`, `vermittler_id`, `fahrzeug_id` FK columns via ALTER TABLE; add `akten_history` table; keep existing text columns as display fallback for legacy records
2. **server.js Akten routes** — extend existing GET /api/akten to accept `?customer_id=X` filter; add diff-and-log logic to PUT handler for akten_history; no new route files
3. **app.js Akten frontend** — upgrade form inputs from free-text to select dropdowns fed from /api/lawyers and /api/vermittler; add customer typeahead; add file attachment widget reusing /api/files endpoints; add history log display in detail view
4. **S3 folder convention** — `akten/{akte_id}/{timestamp}_{filename}` for per-case file storage; no schema changes needed

See `.planning/research/ARCHITECTURE.md` for full build order, data flow diagrams, and anti-patterns.

### Critical Pitfalls

1. **sql.js data loss on crash** — The in-memory flush model can lose all writes since the last flush if the Node process crashes. Mitigation: migrate to better-sqlite3 before any production data expansion. This is Phase 0, not optional.

2. **Duplicate Aktennummer race condition** — Two concurrent creates both read the same last Aktennummer and generate the same next value. The current `akten` table has no UNIQUE constraint on `aktennummer`. Mitigation: add UNIQUE constraint immediately; wrap number generation in an atomic SQLite transaction; auto-generate server-side only.

3. **Permission header spoofing** — All authorization checks read `x-user-permission` from the HTTP request header, which any client can set freely. Mitigation: implement server-side session validation (JWT or opaque token + sessions table) before deploying new write endpoints. At minimum, add `requirePermission()` middleware that validates against server state, not the request header.

4. **No audit trail on Akte changes** — Insurance and legal case files require traceable history under GoBD. Mitigation: create `akten_history` table and populate it on every PUT before the module handles any production records. Retrofitting history on existing records is impossible.

5. **Free-text relational fields break referential integrity** — `anwalt`, `vermittler`, `kunde` stored as plain strings. Name changes in Stammdaten silently diverge from Akten records. Mitigation: add FK columns (`anwalt_id`, `vermittler_id`, `customer_id`) via migration before the first production Akte is created; use text fields as display fallback only.

See `.planning/research/PITFALLS.md` for 13 pitfalls with phase-specific warnings.

---

## Implications for Roadmap

### Phase 1: Infrastructure and Security Hardening
**Rationale:** The existing production system has a data-loss vulnerability (sql.js), a spoofable authorization model (permission headers), and no input validation. Building new features on this foundation compounds all three risks. These changes are also the lowest visible-risk changes — they don't touch the UI at all, but they fix the foundation every subsequent phase depends on.
**Delivers:** Production-grade database (WAL, durable writes), HTTP security headers, auth endpoint rate limiting, input validation middleware, Express 5 with automatic async error propagation
**Addresses:** Table stakes reliability; no user-visible features
**Avoids:** Pitfalls 2 (permission spoofing), data loss from sql.js crash, malformed data writes
**Stack changes:** better-sqlite3, express@5, zod, helmet, express-rate-limit, pdfkit@0.18.0, node:20-slim Docker base

### Phase 2: Akten Schema and Data Model
**Rationale:** Before building any Akten UI, the data model must be correct. FK columns must be added before the first production record; the audit trail table must exist from day one; and Aktennummer generation must be atomic. Doing this as a dedicated phase prevents the most dangerous pitfall: building forms on top of a schema that will need breaking changes.
**Delivers:** Correct akten schema with FK columns, akten_history table, UNIQUE constraint on aktennummer, year-scoped number generation, server-side validation of required fields
**Addresses:** Core Akten data integrity requirements
**Avoids:** Pitfalls 1 (duplicate Aktennummern), 3 (free-text relational fields), 4 (no audit trail), 6 (silent ALTER TABLE failure), 7 (year boundary reset), 13 (empty Aktennummer)
**Uses:** zod validation middleware from Phase 1; better-sqlite3 transaction support

### Phase 3: Akten Module — Core UI
**Rationale:** With the schema correct and the foundation solid, build out the Akten UI fully. Replace free-text inputs with Stammdaten-backed selects, add customer typeahead, connect the detail view to the history log. The scaffold already exists — this phase finishes it.
**Delivers:** Fully functional Akten list + create/edit form with typed selects; detail view with audit history; customer detail showing linked Akten inline; search and filter
**Addresses:** Akte case container, linked parties (Versicherung, Anwalt, Vermittler, customer), Schadensfahrzeug reference, Kostenübernahme-Typ, Notes/Verlauf, status workflow
**Avoids:** Pitfall 5 (stale global state — reset `_aktenData` at render top), Pitfall 8 (field added to form but not detail/list — three-view checklist), Pitfall 11 (hardcoded status constants diverge)
**Architecture:** Extend app.js renderAkten/openAkteForm/openAkteDetail; extend GET /api/akten to accept customer_id filter; populate select dropdowns from /api/lawyers and /api/vermittler

### Phase 4: Rental Module Completion
**Rationale:** Akten are the case container; the Mietvertrag is the rental record inside the case. The rental module currently has a basic structure but is missing required fields (mileage, fuel level, deposit, driver's license, pickup/return times) and status states. Completing it unblocks the Übergabeprotokoll and invoice linkage in Phase 5.
**Delivers:** Full Mietvertrag data model, rental status states, rental linked to Akte, rental linked to Invoice
**Addresses:** Table stakes rental process features; rental → invoice billing loop
**Avoids:** Pitfall 8 (three-view checklist), Pitfall 12 (date formatting inconsistency)

### Phase 5: Protocols, PDF, and File Attachments
**Rationale:** Once rental and Akten data models are stable, the paper trail can be closed: handover/return protocols capture the physical state of the vehicle, PDFs provide the printable documents required under DE law, and file attachments allow scanned documents to live alongside the digital record.
**Delivers:** Übergabeprotokoll and Rückgabeprotokoll fields; PDF generation for rental contract and handover protocol; per-Akte S3 file attachments
**Addresses:** Physical signature requirement (DE law); damage dispute protection; document management
**Avoids:** Pitfall 9 (S3 cleanup on Akte delete — implement when attachments are added)
**Uses:** pdfkit (existing invoice pattern); S3 file API with akten/{id}/ folder convention

### Phase 6: Polish and Cross-Module Integration
**Rationale:** This phase improves quality across all existing modules and adds the integration features that depend on stable data models everywhere else. Cross-module features (search, calendar integration, dashboard KPIs) cannot be built reliably until the underlying data models are finalized.
**Delivers:** Search/filter on all list views; consistent empty states; confirmation dialogs; pagination on large lists; rental calendar integration; dashboard KPIs (active rentals, overdue, open invoices); consistent date formatting via `formatDateDE()` helper
**Addresses:** Differentiator features; operational quality
**Avoids:** Pitfall 12 (date formatting — centralize formatDateDE here if not earlier)

### Phase Ordering Rationale

- Phase 1 (infrastructure) before everything else: sql.js data loss and permission spoofing are not acceptable foundations for new feature development.
- Phase 2 (schema) before Phase 3 (UI): FK columns and audit trail must exist before the first production Akte record; retrofitting is impossible.
- Phase 4 (rentals) after Phase 3 (Akten core): Akte is the parent container; its structure must be defined before the Mietvertrag can be properly linked.
- Phase 5 (protocols + PDF) after Phase 4 (rental): PDFs and handover protocols require all rental fields to be present and stable.
- Phase 6 (polish + integration) last: cross-module features (search, calendar, KPIs) depend on stable data models across all modules.

### Research Flags

Phases needing deeper research during planning:
- **Phase 1 (infrastructure):** better-sqlite3 migration from sql.js requires careful API mapping (`db.run()` → `db.prepare().run()`); review all db.js query patterns before writing migration tasks. The Docker base change (Alpine → slim) has deployment implications — verify with existing CI/CD pipeline.
- **Phase 2 (schema):** Aktennummer year-boundary logic needs a concrete implementation spec; the exact format (AK-YYYY-NNN vs other) should be confirmed with the client before implementation.
- **Phase 5 (PDF):** The Übergabeprotokoll and Rückgabeprotokoll PDF layouts need design input — what fields, what order, whether a vehicle damage diagram is required or photo-based is acceptable.

Phases with well-documented patterns (standard, skip research-phase):
- **Phase 3 (Akten UI):** All patterns are established in the codebase; select dropdowns, typeaheads, and history logs follow existing conventions. Direct implementation from ARCHITECTURE.md.
- **Phase 6 (polish):** Standard UX improvements; no novel patterns required.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations verified against official sources (npm, Express migration guide, sql.js issue tracker, better-sqlite3 discussions). One MEDIUM: pdfkit 0.18.0 — no breaking change notes found, but minor version bump not explicitly verified as non-breaking. |
| Features | MEDIUM | German market product references (Rentsoft, Remoso) plus DE legal sources for Übergabeprotokoll requirements. No primary Bemo client interviews — feature priority is inferred from domain research + PROJECT.md. The Unfallersatz-specific workflow assumptions should be validated with the client. |
| Architecture | HIGH | All findings from direct codebase analysis (db.js, server.js, app.js). No inference — confirmed line numbers. The proposed incremental migration pattern matches the existing db.js approach exactly. |
| Pitfalls | HIGH | Critical pitfalls derived from direct code inspection of known vulnerabilities (sql.js flush pattern, permission header pattern, missing UNIQUE constraint). GoBD audit trail requirement verified against official German tax authority sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **Aktennummer format:** The exact format (e.g., AK-YYYY-NNN) is not confirmed in PROJECT.md. Validate with client before Phase 2 implementation. If the format changes post-implementation, all existing Aktennummern become inconsistently formatted.
- **Session/auth scope:** PITFALLS.md flags permission header spoofing as critical, but a full session system may be out of scope for this milestone. During Phase 1 planning, explicitly decide: implement JWT sessions now, or document the risk and defer? This decision gates what can safely be deployed.
- **Übergabeprotokoll design:** The required fields for handover/return protocols are known from domain research, but the PDF layout and whether a visual damage diagram is required must come from the client. Defer Phase 5 scope until this is confirmed.
- **Stammdaten API FK constraints:** `lawyer_id` and `vermittler_id` reference an external Stammdaten service — they cannot be enforced as SQL foreign keys. The display fallback pattern (show stored text when FK is null) must be designed explicitly in Phase 3 to handle legacy records cleanly.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `db.js` (522 lines), `server.js` (~2763 lines), `public/js/app.js` (~10000 lines), `public/index.html`
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, `.planning/PROJECT.md`
- [Express v5 release and migration guide](https://expressjs.com/en/guide/migrating-5.html)
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) + [GitHub discussions #1245, #1270](https://github.com/WiseLibs/better-sqlite3/discussions)
- [sql.js GitHub issue #350 — in-memory flush limitations](https://github.com/sql-js/sql.js/issues/350)
- [Zod official docs](https://zod.dev/v4) + [npm](https://www.npmjs.com/package/zod)
- [helmet GitHub](https://github.com/helmetjs/helmet)
- [GoBD compliance requirements](https://invoicedataextraction.com/blog/gobd-compliance-germany)

### Secondary (MEDIUM confidence)
- [Rentsoft Autovermietung Features](https://rentsoft.de/branchen/autovermietung/) — German market rental software; DE workflow patterns
- [Remoso Car Rental Software](https://www.remoso.com/en/software-solutions/car-rental-software) — German market reference
- [Mietwagen Übergabeprotokoll — billiger-mietwagen.de](https://www.billiger-mietwagen.de/faq/mietwagen-uebergabeprotokoll.html) — protocol field requirements
- [Unfallrechtler Stuttgart — Mietwagen beim Unfallschaden](https://www.unfallrechtler-stuttgart.de/unfallschaden-a-z/mietwagen/) — DE legal documentation requirements
- [bussgeldkatalog.org — Mietwagen nach Unfall Ablauf](https://www.bussgeldkatalog.org/mietwagen-nach-unfall/) — Unfallersatz process overview

### Tertiary (LOW confidence)
- [Adamosoft — Car Rental Management Software Features](https://adamosoft.com/blog/travel-software-development/must-have-features-of-car-rental-management-software/) — US-market marketing content; cross-referenced with DE sources
- [Record360 — Vehicle Inspection Workflows](https://record360.com/) — US SaaS; general inspection patterns only

---
*Research completed: 2026-03-26*
*Ready for roadmap: yes*
