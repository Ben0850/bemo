# Roadmap: Zahlungsverwaltung v1.1

## Overview

Milestone v1.1 ergänzt das bestehende Rechnungsmodul um vollständige Zahlungsverwaltung — Eingänge und Ausgänge bidirektional pro Rechnung, mit Bankkonto-FK, Datum, Betrag, Zahlungsart, Notiz und automatisch erfasstem Buchungs-User. Der Rechnungsstatus wird nicht mehr manuell gesetzt, sondern aus dem Saldo (SUM in − SUM out) gegen den Brutto-Betrag abgeleitet.

Drei sequentielle Phasen liefern das Modul: Schema und CRUD-Backend zuerst (Foundation für jeden späteren Zugriff), dann die Status-Logik plus Anzeige in der Rechnungs-Liste (damit der neue abgeleitete Status systemweit konsistent erscheint), zuletzt die Detail-UI mit Zahlungs-Tabelle, Formular und Bearbeiten/Löschen (das primäre Anwender-Deliverable).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Milestone v1.0 (abgeschlossen)
- Integer phases (4, 5, 6): Milestone v1.1 (aktuell)
- Decimal phases (z. B. 4.1, 5.1): Urgent insertions (markiert mit INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 4: Schema & Backend** - invoice_payments-Tabelle, FK/Constraints/Indizes und vollständige CRUD-API mit Permission-Guards (completed 2026-04-28)
- [x] **Phase 5: Status-Logik & Listen-Integration** - Saldo-Berechnung, abgeleiteter Rechnungs-Status, Anzeige als Badge in der Rechnungs-Liste (completed 2026-04-28)
- [x] **Phase 6: Detail-UI & Zahlungserfassung** - Zahlungs-Block in der Rechnungs-Detailseite mit Tabelle, Formular, Saldo-Anzeige und Bearbeiten/Löschen (completed 2026-04-28)

## Phase Details

### Phase 4: Schema & Backend
**Goal**: Datenbank und Endpoints sind produktionssicher, bevor irgendeine UI Zahlungen schreibt — invoice_payments existiert mit allen Constraints, und CRUD-Endpoints schreiben nur für autorisierte Rollen
**Depends on**: Nothing (erste Phase des Milestones; baut auf bestehenden invoices/bank_accounts auf)
**Requirements**: PAY-DB-01, PAY-DB-02, PAY-DB-03, PAY-DB-04, PAY-API-01, PAY-API-02, PAY-API-03, PAY-API-04, PAY-API-05
**Success Criteria** (what must be TRUE):
  1. Die Tabelle invoice_payments existiert mit allen Feldern (id, invoice_id, direction, amount, payment_date, payment_method, bank_account_id, reference, notes, booked_by, created_at, updated_at) und ist nach Migration auch bei Server-Neustart idempotent vorhanden
  2. Ein DELETE auf /api/invoices/:id löscht automatisch alle zugehörigen Zahlungseinträge (FK ON DELETE CASCADE), und ein INSERT mit direction außerhalb {'in','out'} oder amount <= 0 wird vom CHECK-Constraint mit Fehler abgewiesen
  3. Eine GET-Anfrage auf /api/invoices/:id/payments liefert ein chronologisch nach payment_date sortiertes Array aller Zahlungen der Rechnung; eine POST-Anfrage mit gültigem Body legt eine Zahlung an, gibt 201 mit der ID zurück und setzt booked_by automatisch auf den aktuellen User
  4. PUT /api/payments/:id ändert eine bestehende Zahlung (alle Felder außer booked_by und created_at), DELETE /api/payments/:id entfernt sie — beide Operationen funktionieren mit der eben angelegten ID
  5. Ein Schreibversuch (POST/PUT/DELETE) von einem User mit Rolle "Benutzer" wird mit HTTP 403 abgelehnt; nur Verwaltung, Buchhaltung und Admin dürfen schreiben (analog zu /api/invoices)
**Plans**: 2 plans
Plans:
- [ ] 04-01-PLAN.md — invoice_payments-Tabelle mit FK, CHECK-Constraints und Performance-Indizes (PAY-DB-01..04)
- [ ] 04-02-PLAN.md — CRUD-Endpoints (GET/POST/PUT/DELETE) mit Permission-Guards für Verwaltung/Buchhaltung/Admin (PAY-API-01..05)

### Phase 5: Status-Logik & Listen-Integration
**Goal**: Der Rechnungs-Status ist nicht mehr manuell gesetzt sondern wird systemweit aus dem Zahlungssaldo abgeleitet — sichtbar in der Rechnungs-Liste als Status-Badge, konsistent über alle Rechnungen
**Depends on**: Phase 4 (Saldo-Logik braucht invoice_payments)
**Requirements**: PAY-STAT-01, PAY-STAT-02, PAY-STAT-03, PAY-API-06
**Success Criteria** (what must be TRUE):
  1. Der Saldo einer Rechnung wird serverseitig korrekt als SUM(amount WHERE direction='in') − SUM(amount WHERE direction='out') berechnet und ist über die API abrufbar
  2. Eine GET-Anfrage auf /api/invoices liefert pro Rechnung den abgeleiteten payment_status ("offen" / "teilbezahlt" / "bezahlt" / "überzahlt") sowie den aktuellen Saldo gemäß Regel: 0 → offen, >0 und <total_gross → teilbezahlt, =total_gross → bezahlt, >total_gross → überzahlt
  3. In der Rechnungs-Liste im Frontend erscheint pro Rechnung ein Status-Badge mit dem abgeleiteten Status; eine in Phase 4 angelegte Zahlung verändert den Badge ohne manuellen Status-Eingriff
  4. Eine Test-Rechnung mit Brutto 1000 € zeigt: ohne Zahlung "offen", nach 400 €-Eingang "teilbezahlt", nach weiteren 600 €-Eingang "bezahlt", nach zusätzlichem 100 €-Eingang "überzahlt" — und nach einem 100 €-Ausgang wieder "bezahlt"
**Plans**: 2 plans
Plans:
- [ ] 05-01-PLAN.md — Backend Status-Logik: derivePaymentStatus()-Helper + GET /api/invoices und GET /api/invoices/:id mit payment_saldo + payment_status (PAY-STAT-01, PAY-STAT-02, PAY-API-06)
- [ ] 05-02-PLAN.md — Frontend Status-Badge: getPaymentStatusBadge() + neue Spalte Zahlung in der Rechnungs-Liste mit Filter (PAY-STAT-03)

### Phase 6: Detail-UI & Zahlungserfassung
**Goal**: Anwender können Zahlungen direkt aus der Rechnungs-Detailseite erfassen, einsehen, bearbeiten und löschen — mit voller Saldo-Transparenz und prominenter Status-Anzeige
**Depends on**: Phase 5 (Status-Logik wird in der Detailseite konsumiert)
**Requirements**: PAY-STAT-04, PAY-UI-01, PAY-UI-02, PAY-UI-03, PAY-UI-04, PAY-UI-05
**Success Criteria** (what must be TRUE):
  1. Die Rechnungs-Detailseite enthält einen "Zahlungen"-Block mit chronologischer Tabelle (Spalten: Datum, Richtung Eingang/Ausgang, Betrag, Konto, Zahlungsart, Buchungs-User, Notiz) — bestehende Zahlungen aus Phase 4 erscheinen dort sofort
  2. Ein Klick auf "+ Zahlungseingang" oder "+ Zahlungsausgang" öffnet ein Formular mit Feldern Datum (default heute), Betrag, Bankkonto (Dropdown aus bank_accounts), Zahlungsart und Verwendungszweck/Notiz; Speichern legt die Zahlung an und aktualisiert die Tabelle ohne Seitenneuladen
  3. Über jeder Tabellenzeile ist Bearbeiten verfügbar (öffnet das Formular vorausgefüllt) und Löschen (mit Bestätigungs-Dialog); beide Aktionen aktualisieren Tabelle und Saldo-Block sofort
  4. Über der Zahlungs-Tabelle sind sichtbar: "Bereits bezahlt: X €", "Offener Betrag: Y €" sowie der Status-Badge (offen/teilbezahlt/bezahlt/überzahlt) — Werte stimmen mit der Server-Berechnung aus Phase 5 überein
  5. Der Status-Badge und Restbetrag erscheinen prominent im oberen Bereich der Rechnungs-Detailseite (nicht nur unten beim Zahlungs-Block) — der Anwender sieht den Zahlungsstand bereits beim Öffnen einer Rechnung
**Plans**: 2 plans
Plans:
- [ ] 06-01-PLAN.md — Saldo-Header + Daten-Loader: loadInvoicePayments, loadBankAccounts, renderInvoicePaymentSaldoHeader (PAY-STAT-04, PAY-UI-05)
- [ ] 06-02-PLAN.md — Zahlungs-Tabelle + Modal-Form + Save/Edit/Delete + Permission-Aware UI + E2E-Checkpoint (PAY-UI-01..04)

## Progress

**Execution Order:**
Phases execute in numeric order: 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 4. Schema & Backend | 0/2 | Planned | - |
| 5. Status-Logik & Listen-Integration | 2/2 | Complete   | 2026-04-28 |
| 6. Detail-UI & Zahlungserfassung | 0/2 | Planned | - |

---

## Vorherige Milestones

### v1.0 — Akten-Modul (Complete, 2026-03-27)

3 Phasen, 5 Plans abgeschlossen. Details siehe Git-History und `phases/01-schema-sicherheit/`, `phases/02-detailseite-formular/`, `phases/03-listen-optimierung/`.

- Phase 1: Schema & Sicherheit (Complete 2026-03-26)
- Phase 2: Detailseite & Formular (Complete 2026-03-27)
- Phase 3: Listen-Optimierung (Complete 2026-03-27)
