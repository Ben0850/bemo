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

### Active

- [ ] Bestehende Features fertigstellen und polieren (Detailansichten, fehlende Felder, UI-Konsistenz)
- [ ] Akten-Modul für Mietvorgänge (Details noch offen — wird in separatem Meilenstein definiert)

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
| Akten-Modul als separater Meilenstein | Umfang noch unklar, erst bestehende Features fertigstellen | — Pending |

---
*Last updated: 2026-03-26 after initialization*
