# Requirements: Akten-Modul v1.0

**Defined:** 2026-03-26
**Core Value:** Alle Daten zu einem Mietvorgang (Kunde, Unfall, Mietfahrzeug, Vermittler, Versicherung) auf einen Blick in einer Akte verwalten.

## v1.0 Requirements

### Schema & Backend

- [x] **DB-01**: FK-Spalten customer_id, vermittler_id, versicherung_id, rental_id zur akten-Tabelle hinzufügen (neben bestehenden TEXT-Feldern als Fallback)
- [x] **DB-02**: Neue Spalten unfalldatum, unfallort, polizei_vor_ort in akten-Tabelle
- [x] **DB-03**: Neue Spalten mietart, wiedervorlage_datum in akten-Tabelle
- [x] **DB-04**: UNIQUE Constraint auf aktennummer (keine Duplikate)
- [x] **DB-05**: akten_history Tabelle für Audit-Trail (wer hat wann was geändert — GoBD)

### Sicherheit

- [ ] **SEC-01**: Permission-Guards auf allen Akten-Endpoints (POST, PUT, DELETE) — nur Verwaltung/Buchhaltung/Admin dürfen schreiben

### Frontend — Detailansicht

- [ ] **UI-01**: Akten-Detailseite als Vollseite (kein Modal), erreichbar per Klick aus der Akten-Liste
- [ ] **UI-02**: Kundendaten-Block mit vollständiger Kontaktanzeige (Name, Telefon, E-Mail)
- [ ] **UI-03**: Unfalldaten-Block (Unfalldatum, Unfallort, Polizei vor Ort Ja/Nein)
- [ ] **UI-04**: Mietvorgang-Block (Mietbeginn, Mietende, Fahrzeug Kennzeichen + Bezeichnung, Mietdauer in Tagen)
- [ ] **UI-05**: Mietart-Anzeige (Reparaturmiete / Totalschadenmiete) und Wiedervorlagedatum
- [ ] **UI-06**: Vermittler-Daten-Block
- [ ] **UI-07**: Versicherungs-Daten-Block

### Frontend — Formular & Liste

- [ ] **UI-08**: Akten-Formular mit Dropdown/Suche für Kunde, Vermittler, Versicherung (statt Freitext)
- [ ] **UI-09**: Mietvorgang aus Vermietkalender verknüpfen (Auswahl bestehender Mietvorgänge)
- [ ] **UI-10**: Akten-Liste: Spalten, Filter und Sortierung verbessern

## v2.0 Requirements

### Erweiterungen

- **DOC-01**: Dokumenten-Anhänge pro Akte (S3-Upload, Dateiverwaltung)
- **PDF-01**: Übergabeprotokoll als PDF
- **PDF-02**: Rückgabeprotokoll als PDF
- **INV-01**: Akte → Rechnung mit einem Klick (Daten übernehmen)
- **HIST-01**: Akten-Verlauf Timeline-Ansicht
- **STAT-01**: Dashboard-KPIs für offene Akten, Wiedervorlagen

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automatische Aktennummer-Vergabe | Klärung Format noch offen, manuell für v1.0 |
| Schadenskarte / Schadendiagramm | Fotos reichen für v1.0 |
| E-Mail-Versand aus Akte | Über O365-Integration separat |
| Automatische Zuordnung bestehender TEXT-Daten zu FK | Risiko Fehlzuordnung, manuelle Zuordnung sicherer |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 1 | Complete |
| DB-02 | Phase 1 | Complete |
| DB-03 | Phase 1 | Complete |
| DB-04 | Phase 1 | Complete |
| DB-05 | Phase 1 | Complete |
| SEC-01 | Phase 1 | Pending |
| UI-01 | Phase 2 | Pending |
| UI-02 | Phase 2 | Pending |
| UI-03 | Phase 2 | Pending |
| UI-04 | Phase 2 | Pending |
| UI-05 | Phase 2 | Pending |
| UI-06 | Phase 2 | Pending |
| UI-07 | Phase 2 | Pending |
| UI-08 | Phase 2 | Pending |
| UI-09 | Phase 2 | Pending |
| UI-10 | Phase 3 | Pending |

**Coverage:**
- v1.0 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after roadmap creation*
