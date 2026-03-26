---
phase: 01-schema-sicherheit
plan: 01
subsystem: database
tags: [sqlite, sql.js, migration, schema, akten, audit-trail, unique-constraint]

# Dependency graph
requires: []
provides:
  - akten table with 9 new columns: customer_id, vermittler_id, versicherung_id, rental_id, unfalldatum, unfallort, polizei_vor_ort, mietart, wiedervorlage_datum
  - UNIQUE constraint on aktennummer via table reconstruction
  - akten_history table for GoBD-compliant audit trail (7 columns, FK to akten and staff)
affects: [01-02-PLAN, phase-2-detailseite, phase-3-listen]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ALTER TABLE try/catch idempotent column addition (existing pattern extended to akten)"
    - "SQLite table reconstruction for UNIQUE constraint: PRAGMA foreign_keys OFF -> BEGIN -> CREATE new -> INSERT SELECT -> DROP -> RENAME -> COMMIT -> PRAGMA ON"
    - "PRAGMA index_list idempotency guard: check column 2 (unique flag) before reconstruction"
    - "CREATE TABLE IF NOT EXISTS for append-only audit tables"

key-files:
  created: []
  modified:
    - db.js

key-decisions:
  - "ALTER TABLE blocks run first so new columns exist in source table before INSERT...SELECT in reconstruction — ensures all 9 new columns are copied in the same migration"
  - "PRAGMA index_list column 2 (unique flag) used as idempotency guard — reliable across restarts, does not depend on index name"
  - "akten_history is append-only (no DELETE endpoint) for GoBD compliance"

patterns-established:
  - "Pattern: SQLite UNIQUE via reconstruction — PRAGMA foreign_keys OFF before BEGIN TRANSACTION (not inside), check index_list before running"
  - "Pattern: Dual-strategy migration — ALTER TABLE for columns, reconstruction for constraints; both are idempotent independently"

requirements-completed: [DB-01, DB-02, DB-03, DB-04, DB-05]

# Metrics
duration: 8min
completed: 2026-03-27
---

# Phase 1 Plan 01: Schema Migration Summary

**SQLite akten table reconstructed with 9 new FK/accident/case-management columns and UNIQUE(aktennummer) constraint, plus akten_history audit table created for GoBD compliance**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-27T10:01:12Z
- **Completed:** 2026-03-27T10:09:30Z
- **Tasks:** 2
- **Files modified:** 2 (db.js, data/bemo.db)

## Accomplishments

- 9 new columns added to akten table via idempotent ALTER TABLE blocks (DB-01: customer_id, vermittler_id, versicherung_id, rental_id; DB-02: unfalldatum, unfallort, polizei_vor_ort; DB-03: mietart, wiedervorlage_datum)
- UNIQUE constraint on aktennummer enforced via full table reconstruction (akten_new CREATE -> INSERT SELECT all columns -> DROP -> RENAME), guarded by PRAGMA index_list idempotency check (DB-04)
- akten_history table created with 7 columns (id, akte_id, changed_by, changed_at, field_name, old_value, new_value) and FK references to akten and staff tables (DB-05)
- Pre-migration duplicate check confirmed zero duplicate aktennummer values and zero existing rows — safe reconstruction

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: akten column migrations, UNIQUE reconstruction, and akten_history table** - `52455df` (feat)

_Note: Both tasks were inserted as adjacent blocks in db.js in a single edit and committed together with the migrated database file._

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `db.js` - Added 9 ALTER TABLE migrations, table reconstruction block with UNIQUE constraint, akten_history CREATE TABLE (all before existing save() call)
- `data/bemo.db` - Migration executed on startup: akten reconstructed, akten_history table created

## Decisions Made

- Inserted ALTER TABLE blocks BEFORE the reconstruction block so new columns exist in the source akten table when INSERT...SELECT copies them — this ensures the 9 new columns are populated correctly during reconstruction even on first-run databases
- Used PRAGMA index_list column 2 (unique flag) as the idempotency guard rather than checking for a sentinel column — more semantically correct and doesn't depend on index naming conventions
- Confirmed zero duplicate aktennummer and zero rows in production DB before committing — reconstruction ran cleanly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Pre-flight duplicate check passed. Migration ran on first attempt with expected console.log output: "akten migration: table reconstructed with UNIQUE(aktennummer) and new columns". Second run confirmed idempotency (no errors, no duplicate console output).

## User Setup Required

None - no external service configuration required. Migration runs automatically on server startup.

## Next Phase Readiness

- akten table schema is complete — all 9 new columns available for the PUT/POST handler extensions in Plan 02
- aktennummer UNIQUE constraint is live — Plan 02 must add server-side validation to reject empty aktennummer (empty string would block all subsequent inserts)
- akten_history table is ready for the PUT handler audit-trail write logic in Plan 02
- Plan 02 (permission guards + audit trail write) can now proceed

---
*Phase: 01-schema-sicherheit*
*Completed: 2026-03-27*
