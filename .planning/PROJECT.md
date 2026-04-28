# Bemo Verwaltungssystem

## What This Is

Webbasiertes Verwaltungssystem für die Autovermietung Bemo. Verwaltet Kunden, Fahrzeuge, Fuhrpark, Vermietungen, Rechnungen, Gutschriften, Zeiterfassung, Kalender, Urlaub und Stammdaten (Versicherungen, Anwälte, Vermittler, Mitarbeiter). Läuft als Docker-Container mit Express-Backend, Vanilla-JS-Frontend und SQLite-Datenbank.

## Core Value

Alle Geschäftsprozesse der Autovermietung — von der Kundenverwaltung über Mietvorgänge bis zur Buchhaltung — müssen zuverlässig in einem System abgebildet und bedienbar sein.

## Requirements

### Validated

- ✓ Kundenverwaltung mit CRUD, Privat-/Firmenkunden, Fahrzeugzuordnung — existing
- ✓ Fahrzeugverwaltung mit Kennzeichen, FIN, Hersteller, Typ — existing
- ✓ Fuhrpark-Übersicht mit Flottenfahrzeugen — existing
- ✓ Mitarbeiterverwaltung mit Rollen (Benutzer, Verwaltung, Buchhaltung, Admin) — existing
- ✓ Login-System mit rollenbasierter Navigation — existing
- ✓ Kalender mit Terminen pro Station — existing
- ✓ Zeiterfassung mit Stempelfunktion — existing
- ✓ An-/Abwesenheitsplaner (Urlaub, Krank, etc.) — existing
- ✓ Rechnungserstellung mit automatischer Nummernvergabe (MMJJJJXXX) — existing
- ✓ Rechnungsübersicht mit Filter, Sortierung, Status-Badges — existing
- ✓ Gutschriften-Verwaltung — existing
- ✓ PDF-Erzeugung für Rechnungen — existing
- ✓ Vermittler-Verwaltung mit CRUD — existing
- ✓ Versicherungen-Verwaltung — existing
- ✓ Anwälte-Verwaltung — existing
- ✓ Fahrzeugschein-Scan via OCR (OpenAI) — existing
- ✓ Datei-Upload zu AWS S3 — existing
- ✓ O365-E-Mail-Integration für Benachrichtigungen — existing
- ✓ Support-Ticket-System — existing
- ✓ Vorschläge-System — existing
- ✓ Vermietungs-Modul (Grundstruktur) — existing
- ✓ Firmendaten-Einstellungen — existing
- ✓ Programmversion/Changelog — existing
- ✓ Akten-Modul: Schema (FK-Spalten, Audit-Log, UNIQUE-Constraint) — v1.0
- ✓ Akten-Modul: Vollseiten-Detailansicht mit Kunden-/Unfall-/Miet-/Vermittler-/Versicherungs-Block — v1.0
- ✓ Akten-Modul: Formular mit FK-Pickern für Kunde/Vermittler/Versicherung — v1.0
- ✓ Akten-Modul: Mietart und Wiedervorlagedatum — v1.0
- ✓ Akten-Modul: Listen-Optimierung mit Filter-Persistenz und Spaltensortierung — v1.0
- ✓ Stammdaten: Dekra DRS Stundenverrechnungssätze pro PLZ-Bereich — Hotfix
- ✓ Stammdaten-API: Eigenständiger GitHub-Repo + Privat (online deployment in progress)

### Active

- [ ] Zahlungsverwaltung: Zahlungseingänge pro Rechnung erfassen
- [ ] Zahlungsverwaltung: Zahlungsausgänge (Rückzahlungen) pro Rechnung erfassen
- [ ] Zahlungsverwaltung: Auswahl des Bankkontos (FK auf bank_accounts)
- [ ] Zahlungsverwaltung: Zahlungsdatum, Betrag, Zahlungsart, Verwendungszweck/Notiz
- [ ] Zahlungsverwaltung: Erfassung von Buchungs-User automatisch
- [ ] Zahlungsverwaltung: Status der Rechnung wird automatisch aus Saldo abgeleitet
- [ ] Zahlungsverwaltung: Zahlungs-Liste in der Rechnungsdetailseite mit Bearbeiten/Löschen

### Out of Scope

- Framework-Wechsel (React, Vue etc.) — bestehendes Vanilla-JS-System beibehalten
- Datenbankwechsel auf PostgreSQL — aktuell kein Bedarf, SQLite reicht
- Mobile App — Weboberfläche ist ausreichend
- Automatisiertes Mahnwesen — Mahnstufen werden manuell gesetzt

## Context

- Bestehendes Verwaltungsprogramm für die Autovermietung Bemo, im produktiven Einsatz
- Monolithische SPA-Architektur: Express Backend + Vanilla JS Frontend (~10.000 Zeilen app.js)
- SQLite via sql.js (WASM), Datenbankdatei: `data/bemo.db`
- Deployment auf Hetzner Cloud als Docker-Container mit Nginx Reverse Proxy
- 4 Rollen: Benutzer, Verwaltung, Buchhaltung, Admin
- 4 Stationen: Alsdorf, Baesweiler, Merkstein, Außendienst
- Stammdaten-API als separater Service auf Port 3010
- Viele Module existieren bereits, einige haben noch unfertige Detailansichten oder fehlende Felder

## Constraints

- **Tech Stack**: Express, Vanilla JS, sql.js, PDFKit — beibehalten
- **Architektur**: Monolithische SPA-Struktur beibehalten, kein Framework-Wechsel
- **Deployment**: Docker-Container auf Hetzner, Nginx Reverse Proxy
- **Sprache**: UI komplett auf Deutsch

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla JS statt Framework | Bestehendes System, Umstieg zu aufwendig | ✓ Good |
| SQLite statt PostgreSQL | Einfaches Setup, ausreichend für aktuelle Nutzerzahl | ✓ Good |
| Monolithische app.js | Historisch gewachsen, funktioniert | ⚠️ Revisit |
| Akten-Modul als separater Meilenstein | Umfang jetzt definiert, eigener Meilenstein v1.0 | ✓ Good |
| Akten-Detailseite als Vollseite statt Modal | Umfangreiche Verwaltung braucht Platz, Modal zu eingeschränkt | ✓ Good |
| FK-Referenzen statt Freitext für Kunde/Vermittler/Versicherung | Konsistenz mit Stammdaten, keine Divergenz bei Namensänderungen | ✓ Good |
| invoice_payments als eigene Tabelle statt paid_amount-Spalte | Vollständige Historie für GoBD/Audit, ermöglicht bidirektionale Buchungen (Eingang/Ausgang) | — Pending |
| Rechnungs-Status wird aus Zahlungssaldo abgeleitet | Single source of truth statt manuell setzbarem Status, automatische Konsistenz | — Pending |
| FK auf bestehende bank_accounts statt neue Konto-Tabelle | Konten werden bereits in den Einstellungen gepflegt, keine Dopplung | — Pending |

## Current Milestone: v1.1 Zahlungsverwaltung

**Goal:** Zahlungsströme pro Rechnung vollständig erfassen — Eingänge und Ausgänge bidirektional, mit Datum, Betrag, Bankkonto, Zahlungsart und automatischer Erfassung des buchenden Mitarbeiters. Der Rechnungsstatus ergibt sich automatisch aus dem Saldo.

**Target features:**
- Zahlungseingänge pro Rechnung (z.B. Teilzahlung Kunde)
- Zahlungsausgänge pro Rechnung (z.B. Rückzahlung an Kunde)
- Auswahl des Bankkontos aus bestehenden Firmen-Konten (`bank_accounts`)
- Erfassung von Datum, Betrag, Zahlungsart, Verwendungszweck/Notiz
- Buchender Mitarbeiter wird automatisch festgehalten (booked_by = aktueller User)
- Rechnungsstatus wird aus Saldo abgeleitet: Offen / Teilbezahlt / Bezahlt / Überzahlt
- Zahlungs-Liste in der Rechnungs-Detailseite mit "+ Zahlung hinzufügen" und Bearbeiten/Löschen

---
*Last updated: 2026-04-28 after start of milestone v1.1*
