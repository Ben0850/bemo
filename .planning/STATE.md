---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Akten-Modul
status: unknown
stopped_at: Plan 04-01 abgeschlossen — invoice_payments-Schema live, Plan 04-02 (REST-API) ist next
last_updated: "2026-04-28T10:01:22.676Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 2
  completed_plans: 1
---

# Project State: Bemo Verwaltungssystem

**Last updated:** 2026-04-28
**Session:** Milestone v1.1 Zahlungsverwaltung — Roadmap erstellt (3 Phasen, 19 Requirements gemappt)

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-28)

**Core value:** Alle Geschäftsprozesse der Autovermietung zuverlässig in einem System abbilden.
**Current focus:** Phase 04 — Schema & Backend

---

## Current Position

Phase: 04 (Schema & Backend) — EXECUTING
Plan: 2 of 2 (Plan 04-01 complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 6 (5 v1.0 + 1 v1.1)
- Average duration: ~9 min
- Milestone v1.0 status: Complete
- Milestone v1.1 status: Phase 04 in progress (1/2 plans done)

**By Milestone:**

| Milestone | Phases | Status |
|-----------|--------|--------|
| v1.0 Akten-Modul | 3 | Complete (2026-03-27) |
| v1.1 Zahlungsverwaltung | 3 | Phase 04 executing (1/2 plans) |

**Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 04-schema-backend P01 | 1min | 1 | 1 |

## Accumulated Context

### Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Akten-Detailseite als Vollseite | Umfangreiche Verwaltung braucht Platz | 2026-03-26 |
| FK-Spalten additiv neben TEXT-Spalten | Kein Datenverlust bei bestehenden Akten | 2026-03-26 |
| Mietvorgang aus Vermietkalender verknüpfen | Daten nicht doppelt erfassen | 2026-03-26 |
| ALTER TABLE vor Reconstruction ausführen | Neue Spalten existieren in Quelltabelle bevor INSERT...SELECT läuft | 2026-03-27 |
| PRAGMA index_list col 2 als Idempotenz-Guard | Zuverlässig nach Neustart, unabhängig von Index-Namen | 2026-03-27 |
| akten_history append-only (kein DELETE-Endpoint) | GoBD-Konformität erfordert unveränderliches Audit-Log | 2026-03-27 |
| invoice_payments als eigene Tabelle | Vollständige Historie für GoBD/Audit, bidirektionale Buchungen | 2026-04-28 |
| Rechnungsstatus aus Saldo abgeleitet | Single source of truth, automatische Konsistenz | 2026-04-28 |
| PAY-STAT-01/02/03 in Phase 5 (mit API-06) | Status-Logik und Listen-Anzeige sind eine verifizierbare Einheit | 2026-04-28 |
| PAY-STAT-04 in Phase 6 (mit Detail-UI) | Prominente Status-Anzeige gehört zur Detailseite, nicht zur Listen-Phase | 2026-04-28 |
| FK invoice_payments.bank_account_id ohne ON DELETE CASCADE | Bankkonto-Löschen darf Zahlungshistorie nicht entfernen (GoBD-Konformität) | 2026-04-28 |
| booked_by als TEXT NOT NULL DEFAULT '' | POST-Handler füllt aus x-user-name-Header, DEFAULT verhindert NULL-Constraint-Probleme bei Direct-SQL-Tests | 2026-04-28 |

### Existing relevant scaffold (v1.1 context)

- DB table `invoices`: id, invoice_number (UNIQUE), customer_id, invoice_date, due_date, status, total_net, total_gross, total_vat, payment_method, notes, company_snapshot, created_at, updated_at
- DB table `invoice_items`: line items (qty, unit_price, totals)
- DB table `bank_accounts` existiert bereits: id, label, iban, bic, bank_name, is_default
- API: `/api/invoices` (GET/POST), `/api/invoices/:id` (GET), `/api/bank-accounts` (CRUD)
- Frontend: `renderInvoices()`, `renderInvoiceDetail()` (Vollseite)
- AUTH: Nur Verwaltung/Buchhaltung/Admin dürfen Rechnungen anlegen — gleiche Permission-Logik gilt für Zahlungen

### Pending Todos

None yet.

### Blockers/Concerns

- Stammdaten-API Server-Deployment ist parallel pausiert — siehe `.planning/HANDOFF-stammdaten-deployment.md`
- Lokal uncommittete Änderungen in Bemo (Dekra-DRS-Frontend, Datenimport-Ordner, Electron-Ordner) — vor Milestone-Commits klären

---

## Session Continuity

Last session: 2026-04-28T10:01:22.667Z
Stopped at: Plan 04-01 abgeschlossen — invoice_payments-Schema live, Plan 04-02 (REST-API) ist next
Resume: `/gsd:plan-phase 4`
