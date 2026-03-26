---
phase: 01-schema-sicherheit
plan: 02
subsystem: api
tags: [permissions, audit-trail, security, sqlite, gobd]

# Dependency graph
requires:
  - phase: 01-01
    provides: "akten table with 9 new columns and akten_history table"
provides:
  - "Permission-guarded akten write endpoints (POST, PUT, DELETE) returning 403 for Benutzer role"
  - "GoBD-compliant field-level audit trail written to akten_history on every PUT"
  - "POST /api/akten validates aktennummer is non-empty (400)"
  - "All three write endpoints accept and store all 18 akten columns"
affects: [phase-02, frontend-akten-form, stammdaten-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Permission guard pattern: check x-user-permission header before any req.body access"
    - "Audit diff pattern: read existing row BEFORE update, loop TRACKED_FIELDS, insert history row per changed field"
    - "FK normalization: null/undefined/''/0 treated as equivalent to avoid spurious history entries"

key-files:
  created: []
  modified:
    - server.js

key-decisions:
  - "Permission guard checks x-user-permission header — roles allowed: Admin, Verwaltung, Buchhaltung"
  - "Diff loop skips fields absent from req.body (partial update support)"
  - "FK fields normalized to null (not empty string) for diff comparison"
  - "userId sourced from x-user-id header (same pattern as customer rebates)"

patterns-established:
  - "Permission guard: first line of every write handler, before any req.body destructuring"
  - "History diff: read existing, loop TRACKED_FIELDS, skip undefined, compare after normalization, insert row if changed"

requirements-completed: [SEC-01, DB-05]

# Metrics
duration: 2min
completed: 2026-03-27
---

# Phase 01 Plan 02: Permission Guards and Audit Trail for Akten Endpoints Summary

**Role-based permission guards on all akten write endpoints plus GoBD-compliant field-level audit trail writing to akten_history on PUT**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-26T23:25:22Z
- **Completed:** 2026-03-26T23:27:02Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- POST /api/akten: 403 for Benutzer, accepts all 18 columns, validates aktennummer non-empty (400)
- PUT /api/akten/:id: 403 for Benutzer, field-level diff writes rows to akten_history for changed fields only
- DELETE /api/akten/:id: 403 for Benutzer (explicit guard in addition to global Admin-only middleware)
- GET endpoints remain unprotected — reads have no permission restriction

## Task Commits

Each task was committed atomically:

1. **Task 1: Add permission guards to POST/DELETE and extend POST with new columns** - `e97f7df` (feat)
2. **Task 2: Rewrite PUT handler with permission guard, history diff, and new columns** - `d4e58f0` (feat)

## Files Created/Modified

- `server.js` - POST, PUT, DELETE /api/akten handlers replaced with permission-guarded, history-tracking versions

## Decisions Made

- Permission guard placed as the very first logic in each write handler (before req.body destructuring) — fail fast, no unnecessary DB reads for unauthorized requests
- FK fields normalized: null/undefined/''/0 all treated as equivalent to avoid spurious history entries when frontend sends empty string instead of null
- Diff loop uses `req.body[field] === undefined` to skip fields not present in request body — supports partial updates without creating false history entries
- `berlinToday() + ' ' + berlinTime()` used for changed_at timestamp to match existing timestamp conventions throughout server.js

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All akten write endpoints secured (SEC-01 closed)
- GoBD audit trail active for PUT operations (DB-05 closed)
- Remaining concern from STATE.md: Stammdaten-Service endpoint paths on port 3010 need verification before Phase 2
- Remaining concern from STATE.md: Schadensfahrzeug storage strategy (columns in akten vs. separate table) needs decision before Phase 2

---
*Phase: 01-schema-sicherheit*
*Completed: 2026-03-27*
