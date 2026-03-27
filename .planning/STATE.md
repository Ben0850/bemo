---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: complete
stopped_at: Completed 03-01-PLAN.md — Akten-Liste 5 Spalten, customer_name JOIN, Filter-Persistenz
last_updated: "2026-03-27T00:21:31.632Z"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 5
  completed_plans: 5
---

# Project State: Bemo Verwaltungssystem

**Last updated:** 2026-03-27
**Session:** Plan 02-01 executed — enriched Akten detail endpoint and full-page view

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-26)

**Core value:** Alle Geschäftsprozesse der Autovermietung zuverlässig in einem System abbilden.
**Current focus:** Phase 03 — listen-optimierung

---

## Current Position

Phase: 03 (listen-optimierung) — COMPLETE
Plan: 1 of 1 (all plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 1
- Average duration: 8 min
- Total execution time: 8 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-schema-sicherheit | 1 | 8 min | 8 min |

*Updated after each plan completion*

---
| Phase 01-schema-sicherheit P02 | 2 | 2 tasks | 1 files |
| Phase 02-detailseite-formular P01 | 2 | 2 tasks | 2 files |
| Phase 02-detailseite-formular P02 | 2 | 1 tasks | 1 files |
| Phase 03-listen-optimierung P01 | 15 | 2 tasks | 2 files |

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

- [Phase 01-schema-sicherheit]: Permission guard checks x-user-permission header — roles: Admin, Verwaltung, Buchhaltung (SEC-01)
- [Phase 01-schema-sicherheit]: Audit diff loop skips fields absent from req.body — supports partial PUT without spurious history rows (DB-05)
- [Phase 02-detailseite-formular]: fetchStammdatenById helper inserted after STAMMDATEN_API_URL consts — all dependencies defined at call time
- [Phase 02-detailseite-formular]: Legacy text fields shown with amber badge to distinguish pre-FK data from linked Stammdaten records
- [Phase 02-detailseite-formular]: Vermittler/Versicherung use full-list select (small lists), Kunde uses live search (large list)
- [Phase 02-detailseite-formular]: Legacy kunde/vermittler text fields set to empty on save — FK fields are source of truth for new records
- [Phase 02-detailseite-formular]: After-save navigation: currentAkteId && editId routes to detail page, else to list
- [Phase 03-listen-optimierung]: customer_name || kunde Fallback in Tabelle und Suche haelt Legacy-Akten ohne customer_id sichtbar
- [Phase 03-listen-optimierung]: _aktenFilterState als Modulvariable fuer Filter-Persistenz ueber SPA-interne Navigation ohne localStorage

### Existing Akten scaffold

- DB table `akten` now has: id, aktennummer (UNIQUE), datum, kunde, anwalt, vorlage, zahlungsstatus, vermittler, status, notizen, customer_id, vermittler_id, versicherung_id, rental_id, unfalldatum, unfallort, polizei_vor_ort, mietart, wiedervorlage_datum, created_at, updated_at
- DB table `akten_history` now exists (id, akte_id, changed_by, changed_at, field_name, old_value, new_value)
- CRUD API at `/api/akten` — Write-Endpoints noch ohne Permission-Guards (Plan 02)
- Frontend: List + Modal (Detail + Form) — kein Full-Page-View (Phase 2)
- Stammdaten (Vermittler, Anwälte, Versicherungen) über Stammdaten-API Port 3010

### Pending Todos

None yet.

### Blockers/Concerns

- UNIQUE-Constraint aktiv: Plan 02 POST-Handler muss leere aktennummer ablehnen (400), da leerer String '' nun nur einmal erlaubt
- Stammdaten-Service Endpunkt-Pfade verifiziert: /api/vermittler/:id und /api/insurances/:id (aufgeloest durch 02-01)
- Schadensfahrzeug-Speicherstrategie (Spalten in akten vs. eigene Tabelle) vor Phase 2 entscheiden

---

## Session Continuity

Last session: 2026-03-27T00:21:31.625Z
Stopped at: Completed 03-01-PLAN.md — Akten-Liste 5 Spalten, customer_name JOIN, Filter-Persistenz
Resume file: None
