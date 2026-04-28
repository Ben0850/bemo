---
phase: 05-status-logik-listen
plan: 01
subsystem: api
tags: [express, sqlite, status-derivation, payment-saldo, left-join, group-by, floating-point-tolerance]

requires:
  - phase: 04-schema-backend
    provides: invoice_payments-Tabelle (FK invoices ON DELETE CASCADE, CHECK direction/amount), Index idx_invoice_payments_invoice_date (Plan 04-01)
  - phase: 04-schema-backend
    provides: GET/POST/PUT/DELETE-Endpoints fuer invoice_payments mit Permission-Guards (Plan 04-02)
provides:
  - "derivePaymentStatus(saldo, total_gross) Helper-Funktion in server.js — reine JS-Funktion, liefert 'offen' | 'teilbezahlt' | 'bezahlt' | 'ueberzahlt'"
  - "GET /api/invoices liefert pro Rechnung payment_saldo (number, 2 NK) und payment_status (string), berechnet in EINER SQL-Query (LEFT JOIN + GROUP BY)"
  - "GET /api/invoices/:id liefert konsistent zur Liste payment_saldo + payment_status, items[]-Array unveraendert erhalten"
  - "Floating-Point-Toleranz 0.005 EUR (halber Cent) verhindert dass 999.9999 als teilbezahlt vs 1000.00 erscheint"
  - "n+1-frei: Liste mit n Rechnungen wird durch EINE queryAll abgewickelt, nicht durch n+1 Sub-Queries"
affects: [05-02-frontend-listen, 06-detail-ui]

tech-stack:
  added: []
  patterns:
    - "Status-Ableitung aus Aggregat-Query: SUM(CASE WHEN direction='in') - SUM(CASE WHEN direction='out')"
    - "Floating-Point-Toleranz-Vergleich (Math.abs(diff) < TOL) statt strict equality fuer EUR-Betraege"
    - "LEFT JOIN + GROUP BY i.id liefert pro Rechnung exakt eine Row, auch bei 0 oder n Zahlungen"
    - "Math.round(value * 100) / 100 fuer 2-Nachkommastellen-Rundung VOR Response — verhindert Floating-Point-Artefakte im Frontend"
    - "Status-Logik in JS, nicht in SQL — vereinfacht Refactoring der Toleranzgrenzen"

key-files:
  created:
    - ".planning/phases/05-status-logik-listen/deferred-items.md (vat_rate=0 Fallback-Bug pre-existing in invoice-items)"
  modified:
    - "server.js (3 Stellen: neue Helper-Funktion, GET /api/invoices erweitert, GET /api/invoices/:id erweitert)"

key-decisions:
  - "Status-Werte lowercase ohne Umlaut ('offen','teilbezahlt','bezahlt','ueberzahlt') — Frontend macht Display-Capitalize+Umlaut-Mapping. REQUIREMENTS.md schreibt zwar 'Offen/Teilbezahlt/Bezahlt/Ueberzahlt' fuer Anzeige, aber Backend-Werte bleiben technisch sauber lowercase."
  - "Floating-Point-Toleranz 0.005 EUR (=halber Cent). Grund: SUM(REAL) ueber n Zahlungen kann Floating-Point-Artefakte erzeugen (z.B. 999.99999...). 0.005 = halber kleinster Cent verhindert dass derartige Werte als teilbezahlt klassifiziert werden."
  - "Equality-Check (Math.abs(s-g) < TOL) VOR Null-Check (s < TOL) — sonst gibt derivePaymentStatus(0,0) faelschlich 'offen' statt 'bezahlt'. Behavior-Test 9 erzwang diese Reihenfolge."
  - "Saldo-Aggregation in JS-Status-Logik statt komplettem CASE im SQL — tradeoff fuer Lesbarkeit und Refactoring der Toleranzgrenzen."
  - "Detail-Endpoint nutzt eigene aggregate queryOne (statt LEFT JOIN wie Liste) — Detail braucht nur eine ID, kein GROUP BY, einfachere SQL."
  - "Math.round((Number(saldo) || 0) * 100) / 100 fuer 2-Nachkommastellen-Rundung — Frontend muss sich nicht um Floating-Point-Display kuemmern."
  - "Bestehender invoices.status (Entwurf/Offen/Bezahlt/Storniert/Mahnstufe...) bleibt unangetastet im Response unter 'status' — payment_status ist additiv. Plan 05-02 entscheidet, ob die Liste den manuellen Status oder den abgeleiteten Status anzeigt."

patterns-established:
  - "Aggregat-basierte Statusableitung: Statt manuell gepflegtem Status liest die API ihn aus der Bewegungs-Historie ab (single source of truth = invoice_payments)."
  - "Floating-Point-toleranter Equality-Vergleich fuer Geldbetraege via Konstante TOL=0.005 EUR (halber Cent)."
  - "Status-Mapping-Layer: Backend liefert technische Werte (lowercase, kein Umlaut), Frontend macht Display-Mapping in der jeweiligen Plan-Phase."

requirements-completed: [PAY-STAT-01, PAY-STAT-02, PAY-API-06]

duration: 5min
completed: 2026-04-28
---

# Phase 05 Plan 01: Status-Logik Backend Summary

**Abgeleiteter Rechnungs-Zahlungsstatus aus invoice_payments-Saldo: derivePaymentStatus()-Helper plus erweiterte GET /api/invoices und GET /api/invoices/:id Handler liefern payment_saldo (number, 2 NK) und payment_status (string) — berechnet in einer einzigen SQL-Query mit LEFT JOIN + GROUP BY und Floating-Point-toleranten Vergleichen (TOL=0.005 EUR).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-28T10:31:33Z
- **Completed:** 2026-04-28T10:36:30Z
- **Tasks:** 3 (alle TDD: Red -> Green)
- **Files modified:** 1 (server.js, 3 Editierungen)
- **Files created:** 1 (deferred-items.md fuer pre-existing vat_rate-Bug)

## Accomplishments

- derivePaymentStatus(saldo, total_gross) als reine JS-Helper-Funktion mit 9/9 Behavior-Tests gruen (PAY-STAT-01, PAY-STAT-02)
- GET /api/invoices erweitert: LEFT JOIN invoice_payments + GROUP BY i.id liefert payment_saldo pro Rechnung in EINER Query (PAY-API-06, kein n+1)
- GET /api/invoices/:id erweitert: aggregate queryOne liefert konsistent payment_saldo + payment_status (Phase 6 kann diese Felder direkt konsumieren)
- Math.round-Rundung auf 2 Nachkommastellen verhindert Floating-Point-Artefakte im Frontend
- Bestehender Filter `?status=Entwurf` arbeitet weiterhin auf invoices.status (manueller Status unangetastet)
- Bestehende Felder (invoice_number, customer_name, total_gross, status, items[], ...) bleiben in jedem Response erhalten
- E2E live verifiziert: 5 Status-Wechsel-Szenarien (offen -> teilbezahlt -> bezahlt -> ueberzahlt -> bezahlt) gegen laufenden Server

## Task Commits

Each task was committed atomically:

1. **Task 1: derivePaymentStatus()-Helper-Funktion mit Floating-Point-Toleranz hinzufuegen** - `aa3af4e` (feat)
2. **Task 2: GET /api/invoices um payment_saldo + payment_status erweitern (LEFT JOIN + GROUP BY)** - `67b311c` (feat)
3. **Task 3: GET /api/invoices/:id ebenfalls um payment_saldo + payment_status erweitern** - `7395480` (feat)

**Plan metadata:** [pending final commit] (docs: complete plan)

## Files Created/Modified

- `server.js`:
  - Zeile 1308-1325: NEUE Helper-Funktion `function derivePaymentStatus(saldo, total_gross)` zwischen `generateInvoiceNumber()` und `app.get('/api/invoices', ...)`
  - Zeile 1327-1359: Erweiterter GET /api/invoices Handler mit LEFT JOIN invoice_payments + GROUP BY i.id, COALESCE(SUM(...))-Saldo-Berechnung, Math.round-Rundung, derivePaymentStatus-Aufruf
  - Zeile 1363-1380: Erweiterter GET /api/invoices/:id Handler mit eigener aggregate queryOne fuer Saldo, Math.round-Rundung, items[]-Array UND payment_saldo + payment_status im Spread
- `.planning/phases/05-status-logik-listen/deferred-items.md`: Pre-existing Bug `vat_rate=0` in invoice-items-Endpoints dokumentiert (Out-of-Scope)

## Decisions Made

- **Lowercase Status-Strings ohne Umlaut** — Backend liefert `'offen','teilbezahlt','bezahlt','ueberzahlt'`. Frontend in Plan 05-02 macht Display-Capitalize+Umlaut-Mapping (z.B. `'ueberzahlt' -> 'Überzahlt'`). REQUIREMENTS.md Zeile 29 dokumentiert die Display-Form, das Backend bleibt technisch sauber.
- **Floating-Point-Toleranz 0.005 EUR (halber Cent)** — TOL=0.005 als Konstante. SUM(REAL) ueber n Zahlungen erzeugt manchmal Werte wie 999.9999999... — ohne Toleranz wuerden diese als 'teilbezahlt' statt 'bezahlt' klassifiziert.
- **Equality-Check VOR Null-Check** — Behavior-Test 9 (`derivePaymentStatus(0,0) === 'bezahlt'`) erzwang die Reihenfolge: erst `Math.abs(s-g) < TOL`, dann `s < TOL`. Sonst wuerde Saldo=0 mit Brutto=0 als 'offen' eingestuft, obwohl die Rechnung praktisch null-bezahlt ist.
- **Status-Logik in JS statt SQL** — Aggregation (SUM) im SQL, Klassifikation (offen/teilbezahlt/...) in JS. Vorteil: Refactoring der Toleranzgrenzen aendert genau eine Konstante in der Helper-Funktion, nicht 2-3 SQL-Statements.
- **Detail-Endpoint mit eigener aggregate queryOne** — statt LEFT JOIN wie in der Liste. Detail braucht nur eine Rechnungs-ID, kein GROUP BY, einfacheres SQL. n+1 wird hier nicht relevant, weil es genau EIN aggregate-Query plus EIN items-Query gibt (= 3 Queries total: invoice + items + saldo).
- **Math.round(saldo * 100) / 100 fuer Display** — verhindert dass Frontend Werte wie `400.00000000001` zu rendern bekommt. Saldo bleibt im Backend exakt, der Display-Wert ist auf 2 NK gerundet.
- **Bestehender invoices.status unangetastet** — Manueller Status (Entwurf/Offen/Bezahlt/Storniert/Mahnstufe...) bleibt im Response unter `status`. payment_status ist ein **additives** Feld. Plan 05-02 entscheidet, welcher Status in welcher UI-Spalte steht.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reihenfolge der Status-Checks korrigiert**
- **Found during:** Task 1 (RED->GREEN — Behavior-Test 9)
- **Issue:** Plan-Pseudocode hatte `if (s < TOL) return 'offen'` VOR dem `Math.abs(s - g) < TOL`-Check. Test 9 (`derivePaymentStatus(0, 0) === 'bezahlt'`) schlug fehl, weil 0 < 0.005 zu 'offen' fuehrte, obwohl Saldo=0 und Brutto=0 nach Behavior-Spec 'bezahlt' bedeutet (beide null = praktisch ausgeglichen).
- **Fix:** Equality-Check `Math.abs(s - g) < TOL` als ERSTE Klausel, dann `s < TOL` als zweite. Damit greift die "saldo praktisch gleich brutto"-Regel auch fuer den Edge-Case "beide null".
- **Files modified:** server.js (Helper-Funktion derivePaymentStatus)
- **Verification:** 9/9 Behavior-Tests gruen
- **Committed in:** aa3af4e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — Rule 1)
**Impact on plan:** Auto-fix war notwendig, weil das `<behavior>`-Block des Plans als Vertragsbasis Test 9 verbindlich macht und der Pseudocode dazu inkonsistent war. Keine Scope-Aenderung, nur Reihenfolge der Pruefungen.

## Out-of-Scope Discovery (logged, not fixed)

**vat_rate=0 fallback bug in invoice-items endpoints**
- POST /api/invoices/:id/items und PUT /api/invoice-items/:id verwenden `const rate = Number(vat_rate) || 0.19;` — Body `{vat_rate:0}` faellt damit auf 0.19 zurueck.
- Pre-existing aus Phase 1/2, nicht durch Phase 5 verursacht.
- Dokumentiert in `.planning/phases/05-status-logik-listen/deferred-items.md`.
- Auswirkung auf Phase 5 E2E: Test-Rechnung hatte total_gross=1190 statt 1000 — E2E-Szenarien mit echtem Saldo nachgezogen, alle 5 Transitions gruen.

## Issues Encountered

- **vat_rate=0 wurde von POST /api/invoices/:id/items ignoriert** — fuehrte zu total_gross=1190 statt geplantem 1000. Geloest durch Anpassung der E2E-Test-Amounts an den realen total_gross. Bug in deferred-items.md festgehalten (out-of-scope).
- **Server-Restart noetig** — wie in Plan 04-02 schon erwaehnt: nach Backend-Aenderungen `taskkill //F //IM node.exe && node server.js` notwendig, sonst trifft curl die alte Code-Version. Pattern aus user-MEMORY ("Server nach Backend-Aenderungen immer selbst neustarten") angewendet.

## E2E-Verifikation (Live-Server gegen Test-Rechnung)

**Setup:** Rechnung 9 mit Position {description:"Test", quantity:1, unit_price:1000} -> total_gross=1190 (vat_rate-Bug; siehe Issues).

| Test | Erwartung | Ergebnis |
|------|-----------|----------|
| GET /api/invoices (Rechnung leer) | payment_saldo=0, payment_status='offen', total_gross=1190 | PASS |
| POST Eingang 400 EUR -> Liste | payment_saldo=400, payment_status='teilbezahlt' | PASS |
| POST Eingang 790 EUR -> Liste (Saldo=1190=brutto) | payment_saldo=1190, payment_status='bezahlt' | PASS |
| POST Eingang 100 EUR -> Liste (Saldo=1290>brutto) | payment_saldo=1290, payment_status='ueberzahlt' | PASS |
| POST Ausgang 100 EUR -> Liste (Saldo=1190=brutto) | payment_saldo=1190, payment_status='bezahlt' | PASS |
| GET /api/invoices?status=Entwurf | nur Rechnungen mit status='Entwurf' im Response (Filter unveraendert) | PASS |
| GET /api/invoices Response-Felder | customer_name, invoice_number, total_gross, status weiterhin vorhanden | PASS |
| GET /api/invoices/:id (Detail leer) | payment_saldo=0, payment_status='offen', items[] vorhanden | PASS |
| GET /api/invoices/:id nach Eingang 500 EUR | payment_saldo=500, payment_status='teilbezahlt' | PASS |
| GET /api/invoices/99999 (unbekannt) | HTTP 404 + {error:'Rechnung nicht gefunden'} | PASS |
| n+1-Guard: queryAll-Calls im /api/invoices-Handler-Block | EXAKT 1 (kein n+1) | PASS |
| node --check server.js | exit 0 (Syntax-OK) | PASS |
| 9/9 Helper-Behavior-Tests | alle Erwartungswerte aus dem Plan erreicht | PASS |

## User Setup Required

None — keine externe Service-Konfiguration noetig. Bestehende Auth-Pattern (x-user-permission/x-user-name Header) werden weiterhin verwendet, GET-Endpoints brauchen ohnehin keine Permission-Guards (Lesezugriff offen).

## Next Phase Readiness

- **Plan 05-02 (Frontend-Listen):** Liste-API liefert payment_saldo (number, 2 NK) und payment_status (string) — Frontend kann beide Felder direkt rendern. Display-Mapping (lowercase->Capitalize, 'ueberzahlt'->'Überzahlt') ist die naechste Implementierungsaufgabe.
- **Phase 6 (Detail-UI):** Detail-API liefert payment_saldo + payment_status konsistent — Detail-UI kann eine prominente Status-Badge ohne weitere Backend-Anfragen anzeigen.
- **Refactoring-Hinweis:** Falls die Toleranz spaeter angepasst werden muss, die Konstante `TOL = 0.005` in `derivePaymentStatus()` ist der einzige Aenderungspunkt.
- **Bestehende Endpoints unangetastet:** POST/PUT/DELETE /api/invoices, /api/invoice-items, /api/invoices/:id/payments und alle Plan-04-02-Endpoints unveraendert.

---
*Phase: 05-status-logik-listen*
*Completed: 2026-04-28*

## Self-Check: PASSED

- FOUND: server.js modified (3 Editierungen: derivePaymentStatus, GET /api/invoices, GET /api/invoices/:id)
- FOUND: 05-01-SUMMARY.md created at `.planning/phases/05-status-logik-listen/`
- FOUND: deferred-items.md created (vat_rate=0 pre-existing bug logged)
- FOUND: commit aa3af4e in git log (Task 1 — derivePaymentStatus helper)
- FOUND: commit 67b311c in git log (Task 2 — GET /api/invoices erweitert)
- FOUND: commit 7395480 in git log (Task 3 — GET /api/invoices/:id erweitert)
- FOUND: `function derivePaymentStatus` present in server.js
- FOUND: `LEFT JOIN invoice_payments` present in server.js
- FOUND: `GROUP BY i.id` present in server.js
- FOUND: `payment_saldo, payment_status` Spread im Detail-Handler present
- FOUND: `node --check server.js` exit 0 (kein Syntaxfehler)
- FOUND: 9/9 Helper-Behavior-Tests gruen
- FOUND: Live-Server-E2E 12/12 Tests passed
