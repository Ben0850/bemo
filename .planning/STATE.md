---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Zahlungsverwaltung
status: defining_requirements
stopped_at: Milestone v1.1 started — defining requirements
last_updated: "2026-04-28T08:50:00.000Z"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State: Bemo Verwaltungssystem

**Last updated:** 2026-04-28
**Session:** Milestone v1.1 Zahlungsverwaltung gestartet — Anforderungen werden definiert

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-28)

**Core value:** Alle Geschäftsprozesse der Autovermietung zuverlässig in einem System abbilden.
**Current focus:** Milestone v1.1 — Zahlungsverwaltung

---

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-28 — Milestone v1.1 started

## Performance Metrics

**Velocity:**

- Total plans completed: 5 (v1.0)
- Average duration: ~10 min
- Milestone v1.0 status: Complete

**By Milestone:**

| Milestone | Phases | Status |
|-----------|--------|--------|
| v1.0 Akten-Modul | 3 | Complete (2026-03-27) |
| v1.1 Zahlungsverwaltung | TBD | Defining requirements |

---

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

Last session: 2026-04-28T08:50:00.000Z
Stopped at: Milestone v1.1 Zahlungsverwaltung gestartet
Resume file: None
