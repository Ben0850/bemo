---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Akten-Modul
status: unknown
stopped_at: "Plan 05-01 abgeschlossen — derivePaymentStatus helper + GET /api/invoices und GET /api/invoices/:id liefern payment_saldo+payment_status. Naechster Plan: 05-02 Frontend-Listen"
last_updated: "2026-04-28T10:39:05.299Z"
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 4
  completed_plans: 3
---

# Project State: Bemo Verwaltungssystem

**Last updated:** 2026-04-28
**Session:** Milestone v1.1 Zahlungsverwaltung — Roadmap erstellt (3 Phasen, 19 Requirements gemappt)

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-28)

**Core value:** Alle Geschäftsprozesse der Autovermietung zuverlässig in einem System abbilden.
**Current focus:** Phase 05 — Status-Logik & Listen-Integration

---

## Current Position

Phase: 05 (Status-Logik & Listen-Integration) — EXECUTING
Plan: 2 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 7 (5 v1.0 + 2 v1.1)
- Average duration: ~8 min
- Milestone v1.0 status: Complete
- Milestone v1.1 status: Phase 04 complete (2/2 plans done), Phase 05 next

**By Milestone:**

| Milestone | Phases | Status |
|-----------|--------|--------|
| v1.0 Akten-Modul | 3 | Complete (2026-03-27) |
| v1.1 Zahlungsverwaltung | 3 | Phase 04 complete (2/2 plans), Phase 05 next |

**Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 04-schema-backend P01 | 1min | 1 | 1 |
| Phase 04-schema-backend P02 | 4min | 2 tasks | 1 files |
| Phase 05-status-logik-listen P01 | 5min | 3 tasks | 1 files |

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

- [Phase 04-schema-backend]: booked_by ausschliesslich aus x-user-name Header (NIE aus Body) — Server-controlled identity
- [Phase 04-schema-backend]: PUT /api/payments/:id schliesst booked_by und created_at explizit aus UPDATE-SQL aus (PAY-API-03 Unveraenderlichkeit)
- [Phase 04-schema-backend]: Two-Layer-DELETE-Auth: globales Middleware Whitelist /api/payments/ + Inline-Guard fuer Verwaltung/Buchhaltung/Admin
- [Phase 05-status-logik-listen]: Backend liefert lowercase Status-Strings ohne Umlaut (offen/teilbezahlt/bezahlt/ueberzahlt) — Frontend macht Display-Mapping
- [Phase 05-status-logik-listen]: Floating-Point-Toleranz 0.005 EUR (halber Cent) verhindert dass 999.9999 als teilbezahlt vs 1000.00 erscheint
- [Phase 05-status-logik-listen]: Status-Logik in JS, Aggregation in SQL — Refactoring der Toleranzgrenzen aendert nur eine JS-Konstante
- [Phase 05-status-logik-listen]: Liste nutzt LEFT JOIN+GROUP BY (eine Query, kein n+1), Detail nutzt eigene aggregate queryOne (einfacheres SQL)

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

Last session: 2026-04-28T10:38:42.635Z
Stopped at: Plan 05-01 abgeschlossen — derivePaymentStatus helper + GET /api/invoices und GET /api/invoices/:id liefern payment_saldo+payment_status. Naechster Plan: 05-02 Frontend-Listen
Resume: `/gsd:plan-phase 4`
