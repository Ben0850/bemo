---
phase: 04-schema-backend
plan: 02
subsystem: api
tags: [express, rest, crud, permission-guard, invoice-payments, http-api]

requires:
  - phase: 04-schema-backend
    provides: invoice_payments-Tabelle mit FK invoices(CASCADE), bank_accounts, CHECK direction/amount, Indizes (Plan 04-01)
provides:
  - GET /api/invoices/:id/payments — chronologisch sortierte Liste mit LEFT JOIN bank_accounts (Label/IBAN), 404 bei nicht-existierender Rechnung
  - POST /api/invoices/:id/payments — HTTP 201, booked_by automatisch aus x-user-name Header (NICHT aus Body)
  - PUT /api/payments/:id — aktualisiert alle Felder ausser booked_by und created_at (PAY-API-03 Unveraenderlichkeits-Garantie)
  - DELETE /api/payments/:id — Hard-Delete mit Inline-Guard fuer Verwaltung/Buchhaltung/Admin
  - Permission-Guard ['Verwaltung','Buchhaltung','Admin'] auf allen 3 Schreib-Endpoints, 403 + {error:'Keine Berechtigung'} fuer Benutzer
  - Globales DELETE-Middleware Whitelist um /api/payments/ erweitert (Verwaltung/Buchhaltung duerfen Zahlungen loeschen)
  - Body-Validation vor SQL: direction in/out, amount > 0, payment_date YYYY-MM-DD -> 400 mit klarer Fehlermeldung
affects: [05-status-listen, 06-detail-ui]

tech-stack:
  added: []
  patterns:
    - "Permission-Guard als FIRST-Statement im Handler (vor jeder DB-Operation)"
    - "booked_by aus Request-Header lesen (NIE aus Body) — Server-controlled identity"
    - "Body-Validation vor SQL-Insert — verhindert 500-Fehler durch CHECK-Constraint-Verletzungen"
    - "PUT mit existing-Wert-Fallback bei undefined-Feldern (partielle Updates ohne Datenverlust)"
    - "DELETE-Whitelist im globalen Middleware + Inline-Guard im Handler (Two-Layer-Auth)"

key-files:
  created: []
  modified:
    - "server.js (Zeile 53-66 globales DELETE-Middleware Whitelist; Zeilen 1444-1593 INVOICE PAYMENTS Block mit 4 Endpoints)"

key-decisions:
  - "booked_by ausschliesslich aus x-user-name Header — Body-Wert wird ignoriert (Sicherheit: User darf nicht behaupten, jemand anderes habe gebucht)"
  - "PUT lasst booked_by und created_at unveraendert — UPDATE-SET-Klausel enthaelt nur 7 Datenspalten + updated_at = 8 Zuweisungen"
  - "Body-Validation vor SQL — klarere 400-Antworten als rohe CHECK-Constraint-Fehler"
  - "DELETE-Whitelist-Erweiterung um /api/payments/ — globales Admin-only-Middleware blockiert sonst Verwaltung/Buchhaltung BEVOR Inline-Guard greift"
  - "PUT mit existing-Fallback fuer undefined-Felder — partielles Update von z.B. nur amount darf payment_method/notes nicht auf '' ueberschreiben"
  - "GET ohne Permission-Guard — Lesezugriff auf Zahlungshistorie fuer alle eingeloggten Rollen"

patterns-established:
  - "Two-Layer-Authorization fuer DELETE: globales Middleware lasst Pfad durch (Whitelist), Inline-Guard im Handler prueft erlaubte Rollen"
  - "Server-controlled Identity-Felder (booked_by) werden ausschliesslich aus Headers gelesen, niemals aus Request-Body"
  - "201-Status fuer erfolgreiche POST-Anlage mit vollstaendigem Datensatz im Response (inkl. id und Server-defaults)"

requirements-completed: [PAY-API-01, PAY-API-02, PAY-API-03, PAY-API-04, PAY-API-05]

duration: 4min
completed: 2026-04-28
---

# Phase 04 Plan 02: REST-API invoice_payments Summary

**Vier CRUD-Endpoints fuer invoice_payments mit Permission-Guards (Verwaltung/Buchhaltung/Admin), booked_by aus x-user-name Header, Body-Validation vor SQL und Two-Layer-DELETE-Auth (globales Middleware Whitelist + Inline-Guard).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-28T10:02:49Z
- **Completed:** 2026-04-28T10:06:23Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- GET /api/invoices/:id/payments liefert chronologisch sortierte Liste mit Bankkonto-Label/IBAN via LEFT JOIN — 200+[] bei leerer Liste, 404 bei unbekannter Rechnung (PAY-API-01)
- POST /api/invoices/:id/payments legt Zahlung an, gibt HTTP 201 + Datensatz, setzt booked_by aus x-user-name Header (PAY-API-02)
- PUT /api/payments/:id aktualisiert alle Felder ausser booked_by und created_at — verifiziert mit Body `{booked_by:"hacker"}` -> response zeigt original booked_by (PAY-API-03)
- DELETE /api/payments/:id loescht Datensatz (200 + {success:true,message:'Zahlung geloescht'}) (PAY-API-04)
- Permission-Guards auf allen 3 Schreib-Endpoints: Benutzer -> 403 mit {error:'Keine Berechtigung'} (PAY-API-05)
- Globales DELETE-Middleware um /api/payments/ erweitert — Verwaltung/Buchhaltung koennen ueber Inline-Guard loeschen
- Body-Validation: direction='other' -> 400, amount=0 -> 400, ungueltiges payment_date -> 400 (CHECK-Constraints werden nie sichtbar)
- E2E-Verifikation komplett: alle 9 success criteria mit live-Server gegen Test-Rechnung ID 8 bestaetigt

## Task Commits

Each task was committed atomically:

1. **Task 1: GET-Endpoint und globales DELETE-Middleware Whitelist anpassen** - `5db44ad` (feat)
2. **Task 2: POST/PUT/DELETE-Endpoints mit Permission-Guards einfuegen** - `0292465` (feat)

**Plan metadata:** [pending final commit] (docs: complete plan)

## Files Created/Modified

- `server.js`:
  - Zeilen 53-66: Globales DELETE-Middleware um `/api/payments/` Whitelist erweitert
  - Zeilen 1444-1593: Neuer Block `// ===== INVOICE PAYMENTS =====` mit 4 Endpoints (GET/POST/PUT/DELETE)
  - Position: NACH `app.delete('/api/invoice-items/:id', ...)`, VOR `// PDF Generation`
  - Bestehende Endpoints `/api/invoices`, `/api/invoices/:id`, `/api/invoice-items/:id` UNVERAENDERT

## Decisions Made

- **booked_by ausschliesslich aus x-user-name Header** — Body-Wert wird ignoriert. Verifiziert mit POST `{booked_by:"hacker"}` und x-user-name=admin1 -> response zeigt `booked_by:"admin1"`. Sicherheit: User darf nicht behaupten, jemand anderes habe gebucht.
- **PUT-SQL enthaelt KEIN booked_by und KEIN created_at** — direkt im UPDATE-Statement weggelassen. Verifiziert mit PUT-Body `{amount:300, booked_by:"hacker"}` -> response zeigt `booked_by:"alice"` (unveraendert), `created_at` unveraendert, `updated_at` advanced.
- **Body-Validation vor SQL** — direction/amount/payment_date werden VOR INSERT geprueft, liefern HTTP 400 mit beschreibender Fehlermeldung. CHECK-Constraints aus Plan 04-01 sind die Fallback-Schicht (HTTP 500), wuerden aber bei normaler Nutzung nie ausgeloest.
- **DELETE-Whitelist /api/payments/** — globales Middleware blockiert ALLE non-Admin-DELETEs. Ohne Whitelist-Erweiterung waere Inline-Guard fuer Verwaltung/Buchhaltung wirkungslos. Pfadcheck `req.path.startsWith('/api/payments/')` umgeht das globale Middleware, Inline-Guard im Handler prueft die 3 erlaubten Rollen.
- **PUT mit existing-Fallback** — bei undefined-Feldern wird der bestehende DB-Wert verwendet (`(payment_method !== undefined) ? payment_method : existing.payment_method`). Erlaubt z.B. partielles Update von nur `amount`, ohne `notes` zu loeschen.
- **GET ohne Permission-Guard** — Lesezugriff offen fuer alle Rollen. Konsistent mit `/api/invoices` GET.

## Deviations from Plan

None — plan executed exactly as written. Alle Akzeptanz-Kriterien aus dem Plan beim ersten Versuch erfuellt; keine Auto-Fixes notwendig.

## Issues Encountered

- **Server-Restart noetig:** Beim ersten Verifikations-Lauf war der vorhandene Dev-Server (PID 46000) noch mit alter server.js aktiv. Erste curl-Tests trafen den alten Code (route fehlte -> SPA-Fallback HTML zurueck). Loesung: alten Prozess via taskkill beendet, frischen `node server.js` gestartet -> alle 4 Endpoints sofort verfuegbar. Pattern aus user-MEMORY: "Server nach Backend-Aenderungen immer selbst neustarten" hat sich bestaetigt.

## E2E-Verifikation (Live-Server gegen Rechnung ID 8)

| Test | Erwartung | Ergebnis |
|------|-----------|----------|
| GET /api/invoices/8/payments (leer) | 200 + [] | PASS |
| GET /api/invoices/99999/payments (unbekannt) | 404 | PASS |
| POST mit `x-user-permission: Benutzer` | 403 + {error:'Keine Berechtigung'} | PASS |
| POST mit `x-user-permission: Verwaltung`, x-user-name=alice | 201 + Datensatz mit `booked_by:"alice"` | PASS |
| POST mit Body `{booked_by:"hacker"}`, header x-user-name=admin1 | response `booked_by:"admin1"` (Body ignoriert) | PASS |
| POST mit `direction:"other"` | 400 + {error:"direction muss 'in' oder 'out' sein"} | PASS |
| POST mit `amount:0` | 400 + {error:"amount muss > 0 sein"} | PASS |
| PUT mit Body `{amount:300, booked_by:"hacker"}` | 200, amount=300, booked_by="alice" unveraendert, updated_at advanced | PASS |
| PUT mit `x-user-permission: Benutzer` | 403 + {error:'Keine Berechtigung'} | PASS |
| DELETE durch Buchhaltung | 200 + {success:true,message:'Zahlung geloescht'} | PASS |
| DELETE durch Benutzer | 403 + {error:'Keine Berechtigung'} | PASS |
| GET nach Loeschung | 200 + verbleibender Datensatz mit `bank_account_label:null` (Bar) | PASS |

## User Setup Required

None — keine externe Service-Konfiguration noetig. Alle Endpoints funktionieren mit bestehendem AUTH-Pattern (x-user-permission/x-user-name Header werden vom Frontend bereits in jedem Request gesetzt).

## Next Phase Readiness

- **Phase 5 (Status-Listen):** Saldo-Berechnung kann GET /api/invoices/:id/payments aufrufen — chronologische Sortierung und numerischer amount-Typ stehen.
- **Phase 6 (Detail-UI):** POST/PUT/DELETE-Endpoints sind aufrufbar — Detail-UI braucht nur noch Frontend-Form-Logik plus optional Bank-Konto-Dropdown (LEFT JOIN liefert bereits Label/IBAN).
- **Cascade-Verhalten:** invoice_payments-Records werden beim Loeschen einer Rechnung automatisch mitgeloescht (FK ON DELETE CASCADE aus Plan 04-01) — Frontend muss nicht explizit aufraeumen.
- **Server laeuft auf Port 3001** mit allen 4 neuen Endpoints aktiv. Bestehende /api/invoices, /api/invoice-items, /api/customers etc. sind unveraendert verfuegbar.

---
*Phase: 04-schema-backend*
*Completed: 2026-04-28*

## Self-Check: PASSED

- FOUND: server.js modified (Zeilen 53-66 + 1444-1593)
- FOUND: commit 5db44ad in git log (Task 1)
- FOUND: commit 0292465 in git log (Task 2)
- FOUND: `app.get('/api/invoices/:id/payments'` present in server.js
- FOUND: `app.post('/api/invoices/:id/payments'` present in server.js
- FOUND: `app.put('/api/payments/:id'` present in server.js
- FOUND: `app.delete('/api/payments/:id'` present in server.js
- FOUND: `!req.path.startsWith('/api/payments/')` in globalem DELETE-Middleware
- FOUND: 3x `'Keine Berechtigung'` Permission-Guard-Strings (POST, PUT, DELETE)
- FOUND: PUT-UPDATE-SQL ohne `booked_by =` und ohne `created_at =`
- FOUND: Live-Server-Verifikation 12/12 Tests passed
- FOUND: node --check server.js -> exit 0 (kein Syntaxfehler)
