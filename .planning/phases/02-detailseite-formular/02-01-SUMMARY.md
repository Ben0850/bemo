---
phase: 02-detailseite-formular
plan: 01
subsystem: ui
tags: [sqlite, stammdaten-api, full-page-view, async, detail-view]

# Dependency graph
requires:
  - phase: 01-schema-sicherheit
    provides: akten table with customer_id, rental_id, vermittler_id, versicherung_id FK columns and audit trail
provides:
  - Enriched GET /api/akten/:id returning customer, rental, vermittler_obj, versicherung_obj sub-objects
  - renderAkteDetail() full-page function with 6 styled data blocks
  - navigate case 'akte-detail' wired to Aktenliste row clicks
affects: [02-02, future akten edit form]

# Tech tracking
tech-stack:
  added: []
  patterns: [fetchStammdatenById async helper for external Stammdaten API, inline style block layout matching Vermittler detail pattern]

key-files:
  created: []
  modified:
    - server.js
    - public/js/app.js

key-decisions:
  - "fetchStammdatenById inserted after STAMMDATEN_API_URL/http/https consts so all dependencies exist at call time (not parse time)"
  - "vermittler_id and versicherung_id fetched in parallel via Promise.all to minimise response time"
  - "Legacy text fields (kunde, vermittler) shown with amber badge so operators can distinguish old from linked data"
  - "Edit button visible for Admin + Verwaltung + Buchhaltung matching existing POST/PUT permission guards"

patterns-established:
  - "fetchStammdatenById(urlPath): single-record fetch helper returning parsed JSON or null on error"
  - "Full-page detail via navigate('akte-detail', id) replaces openAkteDetail modal — consistent with customer-detail and invoice-detail"
  - "Block layout: background:var(--bg);border-radius:var(--radius);padding:14px 16px with uppercase section header"

requirements-completed: [UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07]

# Metrics
duration: 2min
completed: 2026-03-27
---

# Phase 02 Plan 01: Akten Detailseite Summary

**Enriched GET /api/akten/:id with SQLite joins + Stammdaten API lookups, and full-page renderAkteDetail() with six styled blocks replacing the read-only modal**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-26T23:56:15Z
- **Completed:** 2026-03-27T00:00:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- GET /api/akten/:id now returns enriched JSON: customer (SQLite join), rental (SQLite JOIN with fleet_vehicles), vermittler_obj and versicherung_obj (parallel Stammdaten API fetches), all null-safe
- async fetchStammdatenById helper centralises external API calls with error-resilient null fallback
- Full-page renderAkteDetail(id) with six blocks: Kundendaten, Unfalldaten, Mietvorgang, Aktendetails, Vermittler, Versicherung — matching Vermittler detail inline-style block pattern
- Row click in Aktenliste now navigates to full page (navigate('akte-detail', id)) instead of opening modal

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend enrichment -- fetchStammdatenById helper and enriched GET /api/akten/:id** - `b025653` (feat)
2. **Task 2: Full-page Akten detail view with all six data blocks** - `8d41512` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `server.js` - fetchStammdatenById helper + async GET /api/akten/:id with customer/rental joins and vermittler_obj/versicherung_obj enrichment
- `public/js/app.js` - currentAkteId state var, navigate case 'akte-detail', renderAkteDetail() function, updated row onclick in renderAktenTable

## Decisions Made
- fetchStammdatenById placed after the const STAMMDATEN_API_URL / http / https declarations so all three references are defined before any call site; no hoisting issue since it's only called at request time
- Promise.all for vermittler + versicherung in parallel — typical response time improvement when both IDs are set
- Legacy text fields displayed with amber "nicht verknuepft" badge to signal to operators that this data predates the FK linkage feature

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness
- Akten detail view is live; Plan 02-02 (edit form with Stammdaten search dropdowns) can build on top of renderAkteDetail
- openAkteForm(id) called from detail page's Bearbeiten button — Plan 02-02 will implement or update that function
- Stammdaten API endpoint paths verified in plan context: /api/vermittler/:id and /api/insurances/:id

---
*Phase: 02-detailseite-formular*
*Completed: 2026-03-27*
