---
phase: 04-schema-backend
plan: 01
subsystem: database
tags: [sqlite, sql.js, schema-migration, foreign-keys, check-constraints, indices, payments]

requires:
  - phase: 03-akten-modul
    provides: bestehende invoices, invoice_items, bank_accounts Tabellen mit FK-Pattern
provides:
  - invoice_payments-Tabelle mit 12 Spalten (id, invoice_id, direction, amount, payment_date, payment_method, bank_account_id, reference, notes, booked_by, created_at, updated_at)
  - FK invoice_payments.invoice_id -> invoices(id) ON DELETE CASCADE
  - FK invoice_payments.bank_account_id -> bank_accounts(id) ohne CASCADE
  - CHECK direction IN ('in','out') und CHECK amount > 0
  - Indizes idx_invoice_payments_invoice_date (invoice_id, payment_date) und idx_invoice_payments_bank_account (bank_account_id)
  - Idempotente Migration via CREATE TABLE/INDEX IF NOT EXISTS
affects: [04-02-API, 05-status-listen, 06-detail-ui]

tech-stack:
  added: []
  patterns:
    - "Inline-CHECK-Constraints auf Spalten-Ebene statt Tabellen-Ebene"
    - "Idempotente Schema-Migrations via CREATE TABLE IF NOT EXISTS und CREATE INDEX IF NOT EXISTS"
    - "Bidirektionales Buchungsmodell mit direction-Spalte (in/out) statt zwei Tabellen"

key-files:
  created: []
  modified:
    - "db.js (Zeilen 434-457: invoice_payments + 2 Indizes)"

key-decisions:
  - "FK auf bank_accounts ohne ON DELETE CASCADE — Bankkonto-Löschen darf Zahlungen nicht mitnehmen"
  - "booked_by als TEXT NOT NULL DEFAULT '' — wird vom POST-Handler aus x-user-name-Header gefüllt, DEFAULT verhindert NULL-Constraint-Probleme bei direkten SQL-Tests"
  - "Inline-CHECK direkt an Spalten — kompakter und SQLite-konformer als Tabellen-Level CHECKs"
  - "bank_account_id NULLABLE — Bar/Kasse-Buchungen ohne Konto erlaubt"

patterns-established:
  - "Bidirektionale Geschäftsbuchungen: eine Tabelle mit direction-Enum statt zwei separate Tabellen (Eingänge/Ausgänge)"
  - "Idempotente Migration nach bank_accounts-Block, vor ALTER TABLE-Block für invoice_items"

requirements-completed: [PAY-DB-01, PAY-DB-02, PAY-DB-03, PAY-DB-04]

duration: 1min
completed: 2026-04-28
---

# Phase 04 Plan 01: Schema invoice_payments Summary

**SQLite-Tabelle invoice_payments mit 12 Spalten, FK ON DELETE CASCADE auf invoices, FK ohne CASCADE auf bank_accounts, CHECK-Constraints fuer direction/amount und zwei Performance-Indizes — Foundation fuer Phase 4 API-Endpoints.**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-28T09:59:04Z
- **Completed:** 2026-04-28T10:00:10Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- invoice_payments-Tabelle mit allen 12 Pflicht-Spalten angelegt (PAY-DB-01)
- ON DELETE CASCADE auf invoices(id) — geloeschte Rechnung raeumt Zahlungen mit ab (PAY-DB-02)
- CHECK-Constraints auf direction (IN 'in','out') und amount (>0) durch SQLite enforced (PAY-DB-03)
- Beide Performance-Indizes angelegt: (invoice_id, payment_date) und (bank_account_id) (PAY-DB-04)
- Migration ist idempotent — zweimaliger getDb()-Aufruf produziert keine Fehler

## Task Commits

Each task was committed atomically:

1. **Task 1: invoice_payments-Tabelle und Indizes anlegen** - `e613ecf` (feat)

**Plan metadata:** [pending final commit] (docs: complete plan)

## Files Created/Modified

- `db.js` (Zeilen 434-457) — invoice_payments-CREATE-Block plus zwei CREATE INDEX-Statements eingefuegt nach bank_accounts-Block, vor ALTER TABLE invoice_items vat_rate

## Decisions Made

- **FK bank_accounts ohne ON DELETE CASCADE** — Bankkonto-Loeschen darf bestehende Zahlungen nicht mitnehmen; Bewahrt GoBD-relevante historische Zuordnung.
- **booked_by als TEXT NOT NULL DEFAULT ''** — Pflichtfeld auf Anwendungsebene (POST-Handler in 04-02 fuellt aus x-user-name-Header), DEFAULT vermeidet aber Constraint-Fehler bei direkten Test-INSERTs.
- **Inline-CHECK an Spalten statt Table-Level** — Kompakter und in SQLite genauso enforced.
- **bank_account_id NULLABLE** — Bar-/Kassen-Buchungen ohne Konto sind erlaubt.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Schema-Foundation komplett; Plan 04-02 (REST-API fuer invoice_payments) kann unmittelbar darauf aufsetzen.
- Bestehende Tabellen invoices, bank_accounts, invoice_items bleiben unveraendert — keine Risiken fuer bestehende Module.
- Verifikation der CHECK-Constraints (Insert mit direction='other' und amount=0/-5) loest erwartungsgemaess CHECK-Fehler aus.

---
*Phase: 04-schema-backend*
*Completed: 2026-04-28*

## Self-Check: PASSED

- FOUND: db.js (modified, lines 434-457 contain invoice_payments + indices)
- FOUND: commit e613ecf in git log
- FOUND: PRAGMA table_info(invoice_payments) returns all 12 columns
- FOUND: PRAGMA foreign_key_list(invoice_payments) shows invoices CASCADE + bank_accounts
- FOUND: PRAGMA index_list(invoice_payments) shows both indices
- FOUND: CHECK direction enforced (verified with INSERT test)
- FOUND: CHECK amount > 0 enforced (verified with INSERT test)
- FOUND: Idempotence verified (two separate getDb() calls succeed)
