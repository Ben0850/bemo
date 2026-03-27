---
phase: 02-detailseite-formular
plan: 02
subsystem: ui
tags: [akten, search-dropdown, fk-picker, form, javascript]

# Dependency graph
requires:
  - phase: 02-detailseite-formular/02-01
    provides: renderAkteDetail full-page view, currentAkteId state variable, enriched GET /api/akten/:id with customer/rental/vermittler_obj/versicherung_obj
  - phase: 01-schema-sicherheit/01-02
    provides: FK columns in akten table (customer_id, vermittler_id, versicherung_id, rental_id, unfalldatum, unfallort, polizei_vor_ort, mietart, wiedervorlage_datum)
provides:
  - openAkteForm() with search-dropdown for Kunde and filterable selects for Vermittler/Versicherung/Mietvorgang
  - searchAkteCustomer / selectAkteCustomer / clearAkteCustomer helper functions
  - saveAkte() sending FK IDs and new fields, with after-save navigation to detail page or list
  - MIETART_OPTIONS constant
affects: [03-permissions-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - search-dropdown pattern (same as invoice): live /api/customers?search= with hidden input + selected chip
    - Promise.all parallel data load at form open
    - After-save navigation: currentAkteId && editId check routes to detail vs list

key-files:
  created: []
  modified:
    - public/js/app.js

key-decisions:
  - "Vermittler and Versicherung use full-list select (loaded once at form open) rather than live search — lists are small enough"
  - "Legacy kunde/vermittler text fields set to empty string on save — FK fields are now the source of truth for new records"
  - "After-save navigation checks currentAkteId && editId: if both truthy, re-render detail page; otherwise reset to list"

patterns-established:
  - "Akte FK picker pattern: Promise.all([vermittler, insurances, rentals]) at form open, customer via live search"
  - "Customer search-dropdown mirrors invoice pattern exactly (searchAkteCustomer/selectAkteCustomer/clearAkteCustomer)"

requirements-completed: [UI-08, UI-09]

# Metrics
duration: 2min
completed: 2026-03-27
---

# Phase 02 Plan 02: Akten Formular FK-Pickers Summary

**Akten form upgraded from free-text inputs to FK-linked search-dropdown for Kunde and filterable selects for Vermittler/Versicherung/Mietvorgang, plus new accident/rental fields (Unfalldatum, Unfallort, Polizei vor Ort, Mietart, Wiedervorlagedatum)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-27T00:02:12Z
- **Completed:** 2026-03-27T00:04:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Replaced openAkteForm() with version that loads vermittler/insurances/rentals in parallel via Promise.all, builds form with FK pickers
- Added customer search-dropdown (searchAkteCustomer/selectAkteCustomer/clearAkteCustomer) following the existing invoice pattern
- Added Mietvorgang select populated from /api/rentals with license_plate + vehicle + date range
- Added Unfalldatum, Unfallort, Polizei-vor-Ort checkbox, Mietart select, Wiedervorlagedatum fields
- Replaced saveAkte() to send FK IDs plus new fields; after-save navigation returns to detail page when editing from detail

## Task Commits

Each task was committed atomically:

1. **Task 1: Upgrade openAkteForm with FK pickers, new fields, and extended saveAkte** - `4f95953` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `public/js/app.js` - Replaced openAkteForm(), added searchAkteCustomer/selectAkteCustomer/clearAkteCustomer, replaced saveAkte(), added MIETART_OPTIONS constant

## Decisions Made
- Vermittler and Versicherung use full-list `<select>` (one-time load) rather than live search, as those lists are small
- Legacy `kunde` and `vermittler` text fields set to empty string on save for new records; FK fields are the source of truth going forward
- After-save navigation: `currentAkteId && editId` check — if editing from detail page, re-render detail; if creating new or editing from list, reset to list view

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Akten form now uses FK pickers; staff can link Kunde/Vermittler/Versicherung/Mietvorgang to actual records
- All new fields (Unfalldatum, Unfallort, Polizei vor Ort, Mietart, Wiedervorlagedatum) are stored and displayed in detail view
- Phase 02 is complete — ready for Phase 03 (permissions and polish)

## Self-Check: PASSED

- FOUND: .planning/phases/02-detailseite-formular/02-02-SUMMARY.md
- FOUND: searchAkteCustomer, selectAkteCustomer, clearAkteCustomer
- FOUND: MIETART_OPTIONS, akte-vermittler-id, akte-versicherung-id, akte-rental-id
- FOUND: akte-unfalldatum, akte-mietart, polizei_vor_ort, wiedervorlage_datum
- FOUND: Promise.all, renderAkteDetail(currentAkteId)
- FOUND: commit 4f95953

---
*Phase: 02-detailseite-formular*
*Completed: 2026-03-27*
