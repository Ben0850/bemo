# Requirements: Bemo Verwaltungssystem

**Defined:** 2026-04-28 (Milestone v1.1)
**Core Value:** Alle Geschäftsprozesse der Autovermietung zuverlässig in einem System abbilden — diese Iteration: Zahlungsströme pro Rechnung erfassen.

## v1.1 Requirements — Zahlungsverwaltung

Anforderungen für das Modul "Zahlungsverwaltung". Jede mappt in der Roadmap auf genau eine Phase.

### Schema & Datenmodell

- [ ] **PAY-DB-01**: Neue Tabelle `invoice_payments` mit Feldern id, invoice_id (FK), direction (in/out), amount, payment_date, payment_method, bank_account_id (FK auf bank_accounts), reference, notes, booked_by, created_at, updated_at
- [ ] **PAY-DB-02**: Foreign Key Constraint von invoice_payments.invoice_id auf invoices.id (ON DELETE CASCADE — eine gelöschte Rechnung räumt ihre Zahlungen mit ab)
- [ ] **PAY-DB-03**: CHECK-Constraint auf direction: nur 'in' oder 'out' erlaubt; CHECK-Constraint auf amount > 0
- [ ] **PAY-DB-04**: Indizes auf (invoice_id, payment_date) und (bank_account_id) für Performance bei Listen und Konto-Auswertungen

### Backend & API

- [ ] **PAY-API-01**: GET /api/invoices/:id/payments liefert alle Zahlungen einer Rechnung sortiert nach payment_date
- [ ] **PAY-API-02**: POST /api/invoices/:id/payments legt eine neue Zahlung an, setzt booked_by automatisch auf den aktuellen User
- [ ] **PAY-API-03**: PUT /api/payments/:id aktualisiert eine bestehende Zahlung (alle Felder außer booked_by und created_at)
- [ ] **PAY-API-04**: DELETE /api/payments/:id löscht eine Buchung (mit GoBD-Auswirkungs-Audit-Log oder Soft-Delete-Variante in Phase 2 evaluieren)
- [ ] **PAY-API-05**: Permission-Guards: nur Verwaltung, Buchhaltung, Admin dürfen Zahlungen anlegen, ändern oder löschen (analog zu Rechnungen)
- [ ] **PAY-API-06**: GET /api/invoices liefert pro Rechnung den abgeleiteten payment_status (offen/teilbezahlt/bezahlt/überzahlt) und den Saldo

### Status-Logik

- [ ] **PAY-STAT-01**: Rechnungs-Saldo wird berechnet als SUM(direction='in') − SUM(direction='out')
- [ ] **PAY-STAT-02**: Rechnungs-Status wird automatisch abgeleitet: 0 → "Offen", >0 und <total_gross → "Teilbezahlt", =total_gross → "Bezahlt", >total_gross → "Überzahlt"
- [ ] **PAY-STAT-03**: Status wird in der Rechnungs-Liste als Badge angezeigt
- [ ] **PAY-STAT-04**: Status wird in der Rechnungs-Detailseite prominent angezeigt zusammen mit Restbetrag

### Frontend — UI

- [ ] **PAY-UI-01**: Rechnungs-Detailseite zeigt einen "Zahlungen"-Block mit chronologischer Tabelle (Datum, Richtung Eingang/Ausgang, Betrag, Konto, Zahlungsart, Buchung-User, Notiz)
- [ ] **PAY-UI-02**: Button "+ Zahlungseingang" und "+ Zahlungsausgang" in der Rechnungs-Detailseite (oder kombinierter Button mit Richtungs-Auswahl im Formular)
- [ ] **PAY-UI-03**: Formular mit Feldern: Datum (default heute), Betrag, Bankkonto (Dropdown aus bank_accounts), Zahlungsart (Überweisung/Bar/Kartenzahlung/...), Verwendungszweck/Notiz
- [ ] **PAY-UI-04**: Bestehende Zahlungen lassen sich aus der Tabelle direkt bearbeiten und löschen (mit Bestätigungs-Dialog)
- [ ] **PAY-UI-05**: Saldo-Anzeige ("Bereits bezahlt: X €", "Offener Betrag: Y €") über der Zahlungs-Tabelle, plus Status-Badge

## v2 Requirements (deferred)

### Erweiterungen

- **PAY-EXT-01**: Auswertung "Saldo pro Bankkonto" (welche Rechnungen sind über welches Konto eingegangen)
- **PAY-EXT-02**: Skonto-Behandlung (Buchung "Skonto-Abzug" als spezielle Zahlungsart)
- **PAY-EXT-03**: Verknüpfung zu Gutschriften (eine Gutschrift erzeugt automatisch einen Zahlungsausgang)
- **PAY-EXT-04**: Bank-CSV-Import (automatische Zuordnung von Banktransaktionen zu Rechnungen)
- **PAY-EXT-05**: Mahnwesen-Trigger basierend auf Status "Offen" + überfällig
- **PAY-EXT-06**: Soft-Delete für Zahlungen (audit-konformer Lösch-Vermerk statt physisch entfernen)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Bank-API-Anbindung (PSD2/HBCI) | Hoher Aufwand, manuelle Buchung reicht für Praxis |
| Zahlungsverlauf als PDF | Nicht primär vom Anwender gefordert, kann später kommen |
| Mehrwährungsfähigkeit | Geschäft läuft komplett in EUR |
| Automatisches Mahnwesen | Bereits in PROJECT.md als Out-of-Scope deklariert |
| Gutschriften-Kopplung in v1.1 | Bewusst getrennt — eigener Buchhaltungsfluss |

## Traceability

Welche Phasen welche Requirements abdecken — wird vom Roadmapper gefüllt.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PAY-DB-01 | TBD | Pending |
| PAY-DB-02 | TBD | Pending |
| PAY-DB-03 | TBD | Pending |
| PAY-DB-04 | TBD | Pending |
| PAY-API-01 | TBD | Pending |
| PAY-API-02 | TBD | Pending |
| PAY-API-03 | TBD | Pending |
| PAY-API-04 | TBD | Pending |
| PAY-API-05 | TBD | Pending |
| PAY-API-06 | TBD | Pending |
| PAY-STAT-01 | TBD | Pending |
| PAY-STAT-02 | TBD | Pending |
| PAY-STAT-03 | TBD | Pending |
| PAY-STAT-04 | TBD | Pending |
| PAY-UI-01 | TBD | Pending |
| PAY-UI-02 | TBD | Pending |
| PAY-UI-03 | TBD | Pending |
| PAY-UI-04 | TBD | Pending |
| PAY-UI-05 | TBD | Pending |

**Coverage:**
- v1.1 requirements: 19 total
- Mapped to phases: 0 (Roadmapper folgt)
- Unmapped: 19

## Vorherige Milestones

### v1.0 — Akten-Modul (Complete, 2026-03-27)

16 Requirements (DB-01 bis DB-05, SEC-01, UI-01 bis UI-10) — alle in den Phasen 1-3 implementiert. Details in `phases/01-schema-sicherheit/`, `phases/02-detailseite-formular/`, `phases/03-listen-optimierung/`.

---
*Requirements defined: 2026-04-28*
*Last updated: 2026-04-28 — Milestone v1.1 gestartet*
