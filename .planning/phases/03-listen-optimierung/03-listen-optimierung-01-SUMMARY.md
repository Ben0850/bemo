---
phase: 03-listen-optimierung
plan: 01
subsystem: ui
tags: [sqlite, left-join, filter-persistence, sorting, badge]

# Dependency graph
requires:
  - phase: 02-detailseite-formular
    provides: akten table with customer_id, mietart, wiedervorlage_datum columns
provides:
  - GET /api/akten returns customer_name via LEFT JOIN on customers table
  - Akten-Liste mit 5 Spalten (Aktennr., Kunde, Mietart, Status, Wiedervorlage)
  - Filter-Persistenz ueber Navigation via _aktenFilterState
  - Roter Badge fuer ueberfaellige Wiedervorlagedaten
affects: [future list pages, filter patterns]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - LEFT JOIN in list endpoint for computed display fields
    - _filterState module variable pattern for client-side filter persistence

key-files:
  created: []
  modified:
    - server.js
    - public/js/app.js

key-decisions:
  - "customer_name || kunde Fallback: a.customer_name || a.kunde behaelt Legacy-Daten ohne FK sichtbar"
  - "Filter-Persistenz via Modulvariable _aktenFilterState: kein localStorage noetig fuer SPA-interne Navigation"

patterns-established:
  - "Filter-Persistenz-Pattern: _filterState speichern in renderTable(), wiederherstellen in renderPage() nach innerHTML-Rebuild"
  - "Wiedervorlage-Badge-Pattern: new Date(datum) < new Date(new Date().toDateString()) fuer Tagesgrenze-Vergleich"

requirements-completed: [UI-10]

# Metrics
duration: 15min
completed: 2026-03-27
---

# Phase 3 Plan 01: Akten-Liste Optimierung Summary

**Akten-Liste auf 5 Spalten (Aktennr., Kunde, Mietart, Status, Wiedervorlage) mit LEFT JOIN customer_name, sortierbaren Headern, rot markierten ueberfaelligen Wiedervorlagen und Filter-Persistenz ueber Navigation**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-27T00:20:00Z
- **Completed:** 2026-03-27T00:35:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- GET /api/akten liefert customer_name per LEFT JOIN auf customers (CASE WHEN fuer Firmen vs. Privatpersonen)
- Akten-Liste zeigt genau 5 Spalten: Aktennr., Kunde, Mietart, Status, Wiedervorlage — alle sortierbar
- Wiedervorlagedaten in der Vergangenheit erscheinen als roter Badge (ef4444)
- _aktenFilterState persistiert Suchwort und Statusfilter: nach navigate('akte-detail') -> Zurueck ist Filter erhalten
- Suche filtert nach Aktennummer, Kundenname (customer_name FK + legacy kunde) und Status
- Zahlungsstatus-Filter und -Spalte entfernt (nicht im Scope der 5-Spalten-Anforderung)

## Task Commits

Each task was committed atomically:

1. **Task 1: Enrich GET /api/akten with customer_name JOIN** - `f74fa14` (feat)
2. **Task 2: Akten-Liste neue Spaltenstruktur und Filter-Persistenz** - `060c4fd` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `server.js` - GET /api/akten handler ersetzt durch LEFT JOIN + CASE WHEN customer_name
- `public/js/app.js` - _aktenFilterState, renderAkten (Filter-Restore), aktenWiedervorlageBadge, renderAktenTable (5 Spalten), clearAktenFilter

## Decisions Made

- `a.customer_name || a.kunde` Fallback in Tabelle und Suche: haelt Legacy-Akten ohne customer_id sichtbar
- _aktenFilterState als einfache Modulvariable statt localStorage — reicht fuer SPA-interne Navigation ohne Page-Reload

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 03 Plan 01 vollstaendig abgeschlossen — einziger Plan in Phase 03
- Akten-Liste ist produktionstauglich: 5 Spalten, sortierbar, Filter-Persistenz, Wiedervorlage-Highlighting
- Keine Blocker fuer Folgearbeiten

## Self-Check: PASSED

- SUMMARY.md: FOUND at .planning/phases/03-listen-optimierung/03-listen-optimierung-01-SUMMARY.md
- Commit f74fa14: FOUND (feat(03-01): enrich GET /api/akten with customer_name LEFT JOIN)
- Commit 060c4fd: FOUND (feat(03-01): Akten-Liste neue Spaltenstruktur und Filter-Persistenz)

---
*Phase: 03-listen-optimierung*
*Completed: 2026-03-27*
