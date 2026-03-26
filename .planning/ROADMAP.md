# Roadmap: Akten-Modul v1.0

## Overview

The Akten-Modul gives Bemo a single, coherent case file for every Unfallersatz rental: customer, accident data, rental vehicle, Vermittler, and Versicherung on one page. Three sequential phases deliver this — schema and security first (the foundation every later save depends on), then the full-page detail view and form upgrade (the primary user-facing deliverable), then list improvements that make the module operationally complete.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Schema & Sicherheit** - FK-Spalten, Audit-Tabelle, UNIQUE-Constraint und Schreibschutz vor jeder UI-Änderung
- [ ] **Phase 2: Detailseite & Formular** - Vollseiten-Aktenansicht mit allen Datenblöcken und FK-Dropdowns im Formular
- [ ] **Phase 3: Listen-Optimierung** - Akten-Liste mit verbesserter Filterung, Sortierung und Spaltenstruktur

## Phase Details

### Phase 1: Schema & Sicherheit
**Goal**: Datenbank und Endpoints sind produktionssicher, bevor irgendeine UI FK-Daten speichert
**Depends on**: Nothing (first phase)
**Requirements**: DB-01, DB-02, DB-03, DB-04, DB-05, SEC-01
**Success Criteria** (what must be TRUE):
  1. Die akten-Tabelle enthält die FK-Spalten customer_id, vermittler_id, versicherung_id, rental_id neben den bestehenden TEXT-Feldern (kein Datenverlust an existierenden Akten)
  2. Die akten-Tabelle enthält die Felder unfalldatum, unfallort, polizei_vor_ort, mietart und wiedervorlage_datum
  3. Die aktennummer-Spalte hat einen UNIQUE-Constraint — ein zweiter INSERT mit derselben Aktennummer wird vom Datenbankfehler abgefangen
  4. Jeder Schreibversuch auf POST/PUT/DELETE /api/akten von einem Benutzer mit der Rolle "Benutzer" wird mit HTTP 403 abgelehnt
  5. Jede PUT-Anfrage auf /api/akten/:id erzeugt einen Eintrag in akten_history mit Nutzer-ID, Zeitstempel und den geänderten Feldern
**Plans**: TBD

### Phase 2: Detailseite & Formular
**Goal**: Jeder Akten-Datensatz hat eine vollständige Verwaltungsseite mit allen verknüpften Entitäten auf einen Blick, und neue Akten werden mit FK-Referenzen angelegt
**Depends on**: Phase 1
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09
**Success Criteria** (what must be TRUE):
  1. Ein Klick auf eine Akte in der Liste öffnet eine Vollseite (kein Modal) mit Navigation zurück zur Liste
  2. Die Detailseite zeigt Kundendaten (Name, Telefon, E-Mail), Unfalldaten (Datum, Ort, Polizei Ja/Nein), Mietvorgang (Kennzeichen, Fahrzeugbezeichnung, Mietbeginn, Mietende, Mietdauer in Tagen) sowie Mietart und Wiedervorlagedatum
  3. Die Detailseite zeigt den Vermittler-Datenblock und den Versicherungs-Datenblock — bei nicht verknüpften Datensätzen erscheint ein "Nicht verknüpft"-Badge statt einem Fehler
  4. Das Akten-Formular enthält Dropdown-/Suchfelder für Kunde, Vermittler und Versicherung (statt Freitexteingabe), und eine gespeicherte Akte zeigt die verknüpften Daten korrekt in der Detailseite
  5. Ein Mietvorgang aus dem Vermietkalender kann im Formular ausgewählt und mit der Akte verknüpft werden
**Plans**: TBD

### Phase 3: Listen-Optimierung
**Goal**: Die Akten-Liste ist produktionstauglich mit durchsuchbaren, sortierbaren Spalten die den täglichen Workflow unterstützen
**Depends on**: Phase 2
**Requirements**: UI-10
**Success Criteria** (what must be TRUE):
  1. Die Akten-Liste zeigt relevante Spalten (z. B. Aktennummer, Kunde, Mietart, Status, Wiedervorlage) und lässt sich nach jeder Spalte sortieren
  2. Die Liste kann nach Aktennummer, Kundenname oder Status gefiltert werden, und der Filter überlebt eine Seitennavigation (zurück von Detailansicht zur Liste)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema & Sicherheit | 0/? | Not started | - |
| 2. Detailseite & Formular | 0/? | Not started | - |
| 3. Listen-Optimierung | 0/? | Not started | - |
