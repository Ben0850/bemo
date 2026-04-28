---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Akten-Modul
status: unknown
stopped_at: "Plan 05-02 abgeschlossen (Task 1 commit e565725, Task 2 User-Approval erteilt). Phase 5 (Status-Logik & Listen-Integration) Code-vollstaendig — bereit fuer `/gsd:verify-work 5`. Naechster Schritt: `/gsd:plan-phase 6` (Detail-UI & Zahlungserfassung)."
last_updated: "2026-04-28T11:05:09.097Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 4
  completed_plans: 4
---

# Project State: Bemo Verwaltungssystem

**Last updated:** 2026-04-28
**Session:** Milestone v1.1 Zahlungsverwaltung — Phase 4 + Phase 5 Code-vollstaendig (4/4 Plans), Phase 5 bereit fuer Verification, Phase 6 (Detail-UI) als naechstes

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-28)

**Core value:** Alle Geschäftsprozesse der Autovermietung zuverlässig in einem System abbilden.
**Current focus:** Phase 05 abgeschlossen (Code-Stand, User-Approval erteilt) — bereit fuer Verification, dann Phase 06 Detail-UI

---

## Current Position

Phase: 05 (Status-Logik & Listen-Integration) — COMPLETE (2/2 plans, ready for verification)
Next: Phase 06 — Detail-UI & Zahlungserfassung (PAY-STAT-04 + PAY-UI-01..05)

## Performance Metrics

**Velocity:**

- Total plans completed: 9 (5 v1.0 + 4 v1.1)
- Average duration: ~6 min (v1.1 plans 4-5)
- Milestone v1.0 status: Complete
- Milestone v1.1 status: Phase 04 complete (2/2), Phase 05 complete (2/2, ready for verification), Phase 06 next

**By Milestone:**

| Milestone | Phases | Status |
|-----------|--------|--------|
| v1.0 Akten-Modul | 3 | Complete (2026-03-27) |
| v1.1 Zahlungsverwaltung | 3 | Phase 04 complete (2/2), Phase 05 complete (2/2), Phase 06 next |

**Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 04-schema-backend P01 | 1min | 1 | 1 |
| Phase 04-schema-backend P02 | 4min | 2 tasks | 1 files |
| Phase 05-status-logik-listen P01 | 5min | 3 tasks | 1 files |
| Phase 05-status-logik-listen P02 | 13min | 2 tasks | 1 files |

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
- [Phase 05-status-logik-listen P02]: Frontend Display-Mapping lowercase->Capitalize ('offen'->'Offen', 'ueberzahlt'->'Ueberzahlt' mit 'Ue' statt 'Ü' fuer HTML-Sicherheit)
- [Phase 05-status-logik-listen P02]: Badge-Farben gray/orange/green/blue — 'ueberzahlt'=blau (Info-State, kein Fehler-State weil Ueberzahlung meist bewusste Vorauszahlung/Skonto-Ausgleich)
- [Phase 05-status-logik-listen P02]: Spalte 'Zahlung' additiv neben 'Status' — manueller invoices.status (Workflow) und automatischer payment_status (Geld) sind getrennte Konzepte, beide parallel angezeigt
- [Phase 05-status-logik-listen P02]: Wiederverwendung bestehender badge-* CSS-Klassen — KEIN neues CSS, kein Stil-Conflict
- [Phase 05-status-logik-listen P02]: User-Approval erteilt mit Verifikations-Scope-Reservation: Layout/Filter/Badges visuell bestaetigt, volles 5-Status-Uebergangs-E2E erst in Phase 6 — vertretbar weil Backend Plan 05-01 bereits 12/12 E2E-Tests gruen hatte

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

Last session: 2026-04-28T10:57:57Z
Stopped at: Plan 05-02 abgeschlossen (Task 1 commit e565725, Task 2 User-Approval erteilt). Phase 5 (Status-Logik & Listen-Integration) Code-vollstaendig — bereit fuer `/gsd:verify-work 5`. Naechster Schritt: `/gsd:plan-phase 6` (Detail-UI & Zahlungserfassung).
Resume: `/gsd:verify-work 5` oder `/gsd:plan-phase 6`
