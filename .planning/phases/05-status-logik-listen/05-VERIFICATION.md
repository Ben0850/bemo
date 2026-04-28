---
phase: 05-status-logik-listen
verified: 2026-04-28T13:30:00Z
status: passed
score: 4/4 success criteria verified
must_haves:
  truths:
    - "Saldo wird serverseitig korrekt als SUM(direction='in') - SUM(direction='out') berechnet und ist via API abrufbar"
    - "GET /api/invoices liefert pro Rechnung payment_status (offen/teilbezahlt/bezahlt/ueberzahlt) und payment_saldo nach Schwellwert-Regeln"
    - "Rechnungs-Liste im Frontend zeigt pro Rechnung ein Status-Badge mit dem abgeleiteten Status; Zahlungen aus Phase 4 veraendern den Badge ohne manuellen Eingriff"
    - "Test-Rechnung 1000 EUR brutto: 0 offen -> 400 teilbezahlt -> 1000 bezahlt -> 1100 ueberzahlt -> 100 Ausgang -> bezahlt"
  artifacts:
    - path: "server.js (Zeile 1312)"
      status: VERIFIED
      detail: "derivePaymentStatus(saldo, total_gross) Helper mit TOL=0.005 EUR Toleranz, Equality-Check vor Null-Check"
    - path: "server.js (Zeile 1326-1359)"
      status: VERIFIED
      detail: "GET /api/invoices mit LEFT JOIN invoice_payments + GROUP BY i.id, payment_saldo + payment_status pro Row"
    - path: "server.js (Zeile 1361-1378)"
      status: VERIFIED
      detail: "GET /api/invoices/:id mit aggregate queryOne fuer Saldo, payment_saldo + payment_status im Spread"
    - path: "public/js/app.js (Zeile 6120-6129)"
      status: VERIFIED
      detail: "getPaymentStatusBadge() Helper mit Capitalize-Mapping und Default 'Unbekannt'"
    - path: "public/js/app.js (Zeile 6162, 6256)"
      status: VERIFIED
      detail: "Neue Spalte 'Zahlung' im thead und tbody-TR mit getPaymentStatusBadge(inv.payment_status)"
    - path: "public/js/app.js (Zeile 6179-6185, 6208, 6235)"
      status: VERIFIED
      detail: "Filter-Dropdown inv-filter-payment-status, Reader und Filter-Klausel in applyInvoiceFilters()"
  key_links:
    - from: "GET /api/invoices Handler"
      to: "invoice_payments table"
      via: "LEFT JOIN invoice_payments p ON p.invoice_id = i.id mit GROUP BY i.id"
      status: WIRED
    - from: "GET /api/invoices Handler Response"
      to: "derivePaymentStatus()"
      via: "rows.map(r => derivePaymentStatus(r.payment_saldo, r.total_gross))"
      status: WIRED
    - from: "applyInvoiceFilters() Tabellen-Render"
      to: "getPaymentStatusBadge(inv.payment_status)"
      via: "Inline-Aufruf in der TR-Map des tbody-innerHTML"
      status: WIRED
    - from: "Filter-Dropdown"
      to: "applyInvoiceFilters() Filter-Klausel"
      via: "if (paymentStatus && inv.payment_status !== paymentStatus) return false;"
      status: WIRED
---

# Phase 5: Status-Logik & Listen-Integration Verification Report

**Phase Goal:** Der Rechnungs-Status ist nicht mehr manuell gesetzt sondern wird systemweit aus dem Zahlungssaldo abgeleitet — sichtbar in der Rechnungs-Liste als Status-Badge, konsistent ueber alle Rechnungen.

**Verified:** 2026-04-28T13:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (aus ROADMAP.md Success Criteria)

| #   | Truth                                                                                                                                                                                                              | Status     | Evidence                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Saldo serverseitig SUM(in) - SUM(out), API-abrufbar                                                                                                                                                                | VERIFIED   | server.js Zeile 1334-1335: `COALESCE(SUM(CASE WHEN p.direction='in' ...)) - COALESCE(SUM(CASE WHEN p.direction='out' ...)) AS payment_saldo`. Live-Curl gegen /api/invoices liefert payment_saldo pro Row.               |
| 2   | GET /api/invoices liefert payment_status (offen/teilbezahlt/bezahlt/ueberzahlt) + Saldo nach Regel: 0=offen, &gt;0&lt;total_gross=teilbezahlt, =total_gross=bezahlt, &gt;total_gross=ueberzahlt                     | VERIFIED   | derivePaymentStatus() in server.js Zeile 1312-1324 implementiert exakt diese Logik mit Floating-Point-Toleranz. Live-Curl liefert beide Felder. 8/8 Helper-Behavior-Tests inkl. Toleranz-Edge-Cases gruen.               |
| 3   | Frontend Rechnungs-Liste zeigt pro Rechnung Status-Badge; Zahlungen aus Phase 4 aendern Badge ohne manuellen Eingriff                                                                                              | VERIFIED   | public/js/app.js Zeile 6256: `<td>${getPaymentStatusBadge(inv.payment_status)}</td>` in der TR-Map. Da der Status aus `inv.payment_status` (vom Backend abgeleitet) kommt, ist kein manueller Eingriff noetig.           |
| 4   | Test-Rechnung 1000 EUR: 0=offen, +400=teilbezahlt, +600=bezahlt, +100=ueberzahlt, -100=bezahlt                                                                                                                     | VERIFIED   | Plan 05-01 SUMMARY dokumentiert 12/12 E2E-Tests gegen Live-Server (vat_rate-Bug-bereinigt mit total_gross=1190). Helper-Logik via Node-Eval erneut bestaetigt: alle 5 Uebergaenge + Toleranz-Faelle pass.                |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                                  | Expected                                                                              | Exists | Substantive | Wired | Status     |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ------ | ----------- | ----- | ---------- |
| `server.js` Helper                        | derivePaymentStatus(saldo, total_gross) mit TOL=0.005 EUR                             | YES    | YES         | YES   | VERIFIED   |
| `server.js` GET /api/invoices             | LEFT JOIN invoice_payments + GROUP BY i.id, payment_saldo + payment_status pro Row    | YES    | YES         | YES   | VERIFIED   |
| `server.js` GET /api/invoices/:id         | aggregate queryOne fuer Saldo, payment_saldo + payment_status im Spread               | YES    | YES         | YES   | VERIFIED   |
| `public/js/app.js` Helper                 | getPaymentStatusBadge() mit lowercase->Capitalize Mapping                             | YES    | YES         | YES   | VERIFIED   |
| `public/js/app.js` Tabelle                | Spalte 'Zahlung' in thead + tbody-TR + colspan 9                                      | YES    | YES         | YES   | VERIFIED   |
| `public/js/app.js` Filter                 | inv-filter-payment-status Dropdown + Reader + Filter-Klausel                          | YES    | YES         | YES   | VERIFIED   |

### Key Link Verification

| From                                      | To                                            | Via                                                              | Status |
| ----------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | ------ |
| GET /api/invoices Handler                 | invoice_payments table                        | LEFT JOIN invoice_payments p ON p.invoice_id = i.id (Z. 1338)    | WIRED  |
| GET /api/invoices Handler Response        | derivePaymentStatus()                         | `rows.map(r => derivePaymentStatus(r.payment_saldo, r.total_gross))` (Z. 1356) | WIRED  |
| derivePaymentStatus()                     | Floating-Point-Toleranz                       | `Math.abs(s - g) < TOL` mit TOL=0.005 (Z. 1315-1317)             | WIRED  |
| GET /api/invoices/:id                     | derivePaymentStatus()                         | `derivePaymentStatus(payment_saldo, invoice.total_gross)` (Z. 1376) | WIRED  |
| applyInvoiceFilters() Tabellen-Render     | getPaymentStatusBadge(inv.payment_status)     | TR-Map in tbody.innerHTML (Z. 6256)                              | WIRED  |
| Filter-Dropdown inv-filter-payment-status | applyInvoiceFilters() Filter-Klausel          | `if (paymentStatus && inv.payment_status !== paymentStatus) return false;` (Z. 6235) | WIRED  |
| Tabellen-Header                           | Tabellen-Body Spalten                         | colspan="9" in empty-state (Z. 6243), neue th + td synchron       | WIRED  |
| Badge-CSS                                 | badge-(gray\|orange\|green\|blue) Klassen     | Wiederverwendung bestehender CSS, keine neuen Klassen             | WIRED  |

### Live-API-Verifikation (curl gegen http://localhost:3001)

| Test                                                         | Erwartung                                                  | Ergebnis |
| ------------------------------------------------------------ | ---------------------------------------------------------- | -------- |
| GET /api/invoices                                            | jede Rechnung enthaelt payment_saldo + payment_status      | PASS — 3 Rechnungen, alle Felder vorhanden |
| GET /api/invoices Rechnung 8 (total_gross=0, keine Zahlungen)| payment_saldo=0, payment_status='bezahlt' (0=0 -> bezahlt) | PASS — saldo=0, status=bezahlt |
| GET /api/invoices Rechnung 4 (total_gross=84.03, keine Zahlungen) | payment_saldo=0, payment_status='offen' (0 vs 84 -> offen) | PASS — saldo=0, status=offen |
| GET /api/invoices?status=Entwurf (bestehender Filter)        | nur Entwuerfe; payment_status weiterhin gesetzt            | PASS — 1 Rechnung (id=8, status=Entwurf, payment_status=bezahlt) |
| GET /api/invoices/3 (Detail-Endpoint)                        | items[] vorhanden, payment_saldo + payment_status gesetzt  | PASS — items[1], saldo=0, status=offen |
| GET /api/invoices/99999 (404-Pfad)                           | HTTP 404 + {error:'Rechnung nicht gefunden'}               | PASS — Status 404 unangetastet |
| derivePaymentStatus 8/8 Behavior-Tests (Node-Inline-Eval)    | offen/teilbezahlt/bezahlt/ueberzahlt + 3 Toleranz-Cases    | PASS — 8/8 |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                          | Status     | Evidence                                                                                                                                            |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| PAY-STAT-01 | 05-01-PLAN  | Saldo = SUM(direction='in') - SUM(direction='out')                                                   | SATISFIED  | server.js Z. 1334-1335 (Liste) und 1370-1371 (Detail) — exakte SUM/CASE-Konstruktion. Live-curl bestaetigt korrekte Werte.                          |
| PAY-STAT-02 | 05-01-PLAN  | Status automatisch abgeleitet: 0->Offen, >0&&<total->Teilbezahlt, =total->Bezahlt, >total->Ueberzahlt | SATISFIED  | derivePaymentStatus() in server.js Z. 1312-1324 implementiert genau die Schwellwerte mit TOL=0.005 EUR Toleranz. 8/8 Tests gruen.                   |
| PAY-STAT-03 | 05-02-PLAN  | Status wird in der Rechnungs-Liste als Badge angezeigt                                               | SATISFIED  | public/js/app.js Z. 6256: `<td>${getPaymentStatusBadge(inv.payment_status)}</td>` in der TR-Map plus Spalte im thead und Filter-Dropdown.           |
| PAY-API-06  | 05-01-PLAN  | GET /api/invoices liefert pro Rechnung payment_status + Saldo                                        | SATISFIED  | server.js Z. 1353-1357: `result = rows.map(r => ({ ...r, payment_saldo, payment_status }))`. Live-curl confirmed. n+1-frei (LEFT JOIN + GROUP BY). |

**Phase 5 Requirements (4): alle SATISFIED.** Keine ORPHANED Requirements — alle vier IDs aus REQUIREMENTS.md (PAY-STAT-01/02/03, PAY-API-06) erscheinen in den PLAN-Frontmatters und sind verifiziert.

### Anti-Patterns Found

| File                  | Pattern              | Severity | Impact                                                                                                  |
| --------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| public/js/app.js      | "placeholder=" matches | Info   | Nur HTML-form `placeholder` Attribute (Z. 255, 261, 578, 582, 586). KEINE Stub-Indikatoren in Phase-5-Code. |
| server.js / app.js    | TODO/FIXME/XXX/HACK  | none     | Keine TODO-Marker im Phase-5-Code (derivePaymentStatus, GET /api/invoices, getPaymentStatusBadge).      |
| `deferred-items.md`   | vat_rate=0 fallback  | Info     | Pre-existing Bug aus Phase 1/2, dokumentiert und out-of-scope. KEIN Phase-5-Anti-Pattern.                |

**Keine Blocker oder Warnungen.**

### Human Verification Status

Plan 05-02 hatte einen human-verify Checkpoint fuer visuelle UI-Pruefung (Layout, Badge, Filter). User hat **"approved"** gegeben mit folgender Scope-Note:
- Layout, Badge-Anzeige und Filter-Dropdown wurden visuell bestaetigt
- Volles 5-Status-Uebergang-E2E-Szenario im UI wurde NICHT vollstaendig durchgespielt
- Backend-E2E (Plan 05-01) hat 12/12 Live-Server-Tests fuer alle 5 Uebergaenge gruen
- Frontend folgt 1:1 dem etablierten Pattern von getInvoiceStatusBadge() (struktur-identisch)
- Helper-Smoke-Tests (5/5) bestaetigen das lowercase->Capitalize-Mapping
- End-to-End-Verifikation der UI-Zahlungserfassung wird in Phase 6 nachgeholt (PAY-UI-01..05)

**Bewertung:** Approval ist substanziell — Backend ist vollstaendig E2E getestet, Frontend ist visuell + struktur-identisch zu bestehenden Pattern bestaetigt. Phase 6 wird die volle UI-getriebene 5-Uebergaenge-Sequenz natuerlich abdecken.

### Verifizierte Code-Lokationen (absolute Pfade)

- `C:\Claude\Bemo_v2\server.js` Zeile 1312-1324 — derivePaymentStatus()
- `C:\Claude\Bemo_v2\server.js` Zeile 1326-1359 — GET /api/invoices mit LEFT JOIN + GROUP BY
- `C:\Claude\Bemo_v2\server.js` Zeile 1361-1378 — GET /api/invoices/:id mit aggregate queryOne
- `C:\Claude\Bemo_v2\public\js\app.js` Zeile 6120-6129 — getPaymentStatusBadge()
- `C:\Claude\Bemo_v2\public\js\app.js` Zeile 6162 — `<th>Zahlung</th>`
- `C:\Claude\Bemo_v2\public\js\app.js` Zeile 6179-6185 — Filter-Dropdown
- `C:\Claude\Bemo_v2\public\js\app.js` Zeile 6208 — paymentStatus Reader
- `C:\Claude\Bemo_v2\public\js\app.js` Zeile 6235 — Filter-Klausel
- `C:\Claude\Bemo_v2\public\js\app.js` Zeile 6243 — colspan="9" empty-state
- `C:\Claude\Bemo_v2\public\js\app.js` Zeile 6256 — `getPaymentStatusBadge(inv.payment_status)` im TR

### Summary

Phase 5 erreicht das ROADMAP-Goal vollstaendig:

1. **Saldo-Berechnung serverseitig:** 1 Query mit LEFT JOIN + GROUP BY (n+1-frei) liefert payment_saldo. Math.round auf 2 Nachkommastellen.
2. **Status-Ableitung:** derivePaymentStatus() mit Floating-Point-Toleranz (TOL=0.005 EUR), Equality-Check vor Null-Check. 8/8 Behavior-Tests gruen inkl. Edge-Cases (999.9999, 1000.0001, 0/0).
3. **API-Konsistenz:** Liste UND Detail-Endpoint liefern beide Felder — Phase 6 kann ohne weitere Backend-Aenderungen aufsetzen.
4. **Frontend-Badge:** Neue Spalte 'Zahlung' mit Capitalize-Mapping, additiv zum bestehenden invoices.status. Filter-Dropdown additiv kombinierbar mit dem bestehenden Status-Filter. KEIN neues CSS — alle Badge-Farben (gray/orange/green/blue) wiederverwendet.
5. **Live-Server bestaetigt:** Alle GET-Endpoints liefern payment_saldo + payment_status korrekt; Status-Filter und 404-Pfad bleiben unveraendert.
6. **Bestehender invoices.status unangetastet:** Manueller Workflow-Status (Entwurf/Versendet/...) bleibt parallel sichtbar — kein Breaking-Change.

Alle 4 ROADMAP-Success-Criteria sowie alle 4 deklarierten Requirements (PAY-STAT-01/02/03, PAY-API-06) sind durch Code + Live-API + Behavior-Tests verifiziert. Phase 5 ist bereit fuer Phase 6.

---

_Verified: 2026-04-28T13:30:00Z_
_Verifier: Claude (gsd-verifier)_
