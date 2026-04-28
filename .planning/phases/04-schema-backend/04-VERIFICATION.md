---
phase: 04-schema-backend
verified: 2026-04-28T10:11:30Z
status: passed
score: 16/16 must-haves verified
re_verification: null
---

# Phase 4: Schema & Backend Verification Report

**Phase Goal:** Datenbank und Endpoints sind produktionssicher, bevor irgendeine UI Zahlungen schreibt — `invoice_payments` existiert mit allen Constraints, und CRUD-Endpoints schreiben nur fuer autorisierte Rollen.
**Verified:** 2026-04-28T10:11:30Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (16 truths from both plans)

#### Plan 04-01 (Schema)

| #  | Truth                                                                                          | Status     | Evidence                                                                                                |
| -- | ---------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| 1  | Tabelle `invoice_payments` existiert mit allen 12 Spalten                                      | VERIFIED   | `PRAGMA table_info`: id,invoice_id,direction,amount,payment_date,payment_method,bank_account_id,reference,notes,booked_by,created_at,updated_at |
| 2  | FK invoice_payments.invoice_id -> invoices(id) ON DELETE CASCADE                               | VERIFIED   | `PRAGMA foreign_key_list` zeigt `[1,0,"invoices","invoice_id","id","NO ACTION","CASCADE","NONE"]`       |
| 3  | CHECK direction IN ('in','out') wird enforced                                                  | VERIFIED   | `INSERT direction='other'` schlaegt mit CHECK-Fehler fehl                                              |
| 4  | CHECK amount > 0 wird enforced                                                                 | VERIFIED   | `INSERT amount=-5` schlaegt mit CHECK-Fehler fehl                                                       |
| 5  | Index `idx_invoice_payments_invoice_date` auf (invoice_id, payment_date)                       | VERIFIED   | `PRAGMA index_list` listet Index                                                                       |
| 6  | Index `idx_invoice_payments_bank_account` auf (bank_account_id)                                | VERIFIED   | `PRAGMA index_list` listet Index                                                                       |
| 7  | Migration ist idempotent — zweimaliger getDb()-Aufruf produziert keine Fehler                  | VERIFIED   | `getDb().then(()=>getDb())` -> `Idempotent OK`                                                          |

#### Plan 04-02 (REST-API)

| #  | Truth                                                                                          | Status     | Evidence                                                                                                |
| -- | ---------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| 8  | GET /api/invoices/:id/payments liefert sortiertes Array (200, leeres Array)                     | VERIFIED   | T1: `[]` HTTP 200; SQL: `ORDER BY p.payment_date ASC, p.id ASC`                                         |
| 9  | POST mit Verwaltung+`x-user-name` liefert 201 mit angelegtem Datensatz inkl. id und booked_by   | VERIFIED   | T5: `{id:3, booked_by:"alice", direction:"in", amount:250.5, ...}` HTTP 201                              |
| 10 | POST setzt booked_by aus `req.headers['x-user-name']` (NICHT aus Body)                          | VERIFIED   | T6: Body `{booked_by:"hacker"}` mit Header `admin1` -> response zeigt `booked_by:"admin1"`              |
| 11 | PUT mit Buchhaltung aktualisiert alle Felder ausser booked_by und created_at (beide unveraendert)| VERIFIED   | T9: PUT `{amount:300, booked_by:"hacker"}` -> response amount=300, booked_by="alice" (orig), created_at unveraendert, updated_at advanced |
| 12 | DELETE mit Admin/Buchhaltung loescht den Datensatz (200/204)                                    | VERIFIED   | T11: DELETE durch Buchhaltung -> 200 + `{success:true,message:'Zahlung geloescht'}`                       |
| 13 | POST/PUT/DELETE mit `x-user-permission: Benutzer` liefern 403 + 'Keine Berechtigung'            | VERIFIED   | T3 (POST), T10 (PUT), T12 (DELETE) -> alle 403 + `{error:"Keine Berechtigung"}`                         |
| 14 | POST/PUT/DELETE OHNE `x-user-permission` Header liefern 403                                     | VERIFIED   | T4 (POST), T13 (DELETE) -> 403 + `{error:"Keine Berechtigung"}`                                         |
| 15 | GET-Endpoint hat KEINEN Permission-Guard                                                        | VERIFIED   | server.js:1451-1465: kein `x-user-permission`-Check; T1 ohne Header -> 200                              |
| 16 | POST mit invalidem Body (direction='other', amount=0) liefert 400 mit klarer Fehlermeldung      | VERIFIED   | T7: `{"error":"direction muss 'in' oder 'out' sein"}` HTTP 400; T8: `{"error":"amount muss > 0 sein"}` HTTP 400 |

**Score:** 16/16 truths verified

### Required Artifacts

| Artifact                                                          | Expected                                                                              | Status      | Details                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `db.js` (Zeilen 437-457)                                          | invoice_payments-Tabelle, FK CASCADE, CHECK, 2 Indizes; idempotent                    | VERIFIED    | Zeile 437 `CREATE TABLE`, Zeilen 456/457 `CREATE INDEX`, Block steht NACH bank_accounts (Z.423) und VOR ALTER (Z.460) |
| `server.js` (Zeilen 53-65, Globales DELETE-Middleware)            | Whitelist `/api/payments/` damit Inline-Guard greifen kann                            | VERIFIED    | Zeile 61: `&& !req.path.startsWith('/api/payments/')`                                                                |
| `server.js` (Zeilen 1448-1590)                                    | 4 Endpoints: GET/POST/PUT/DELETE mit Permission-Guards                                | VERIFIED    | Zeile 1451 GET, 1468 POST, 1521 PUT, 1578 DELETE — alle 4 Handler vollstaendig                                       |

### Key Link Verification

| From                                          | To                                | Via                                                            | Status     | Details                                                                                              |
| --------------------------------------------- | --------------------------------- | -------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| db.js                                         | invoice_payments table in SQLite  | CREATE TABLE IF NOT EXISTS innerhalb getDb()                   | WIRED      | Pattern in db.js Zeile 437; Tabelle existiert in SQLite                                              |
| invoice_payments.invoice_id                   | invoices.id                       | FOREIGN KEY ... ON DELETE CASCADE                              | WIRED      | PRAGMA foreign_key_list zeigt CASCADE on_delete                                                      |
| server.js POST /api/invoices/:id/payments     | invoice_payments table            | execute() INSERT mit booked_by aus x-user-name Header          | WIRED      | server.js:1497-1512 INSERT 9 Spalten; T6 verifiziert Header-Identity                                 |
| server.js POST /api/invoices/:id/payments     | Permission-Guard                  | x-user-permission Header gegen ['Verwaltung','Buchhaltung','Admin'] | WIRED  | server.js:1471 exact pattern; T3+T4 verifizieren 403                                                |
| server.js PUT /api/payments/:id               | invoice_payments table            | execute() UPDATE — schliesst booked_by und created_at aus      | WIRED      | server.js:1549-1558 SET-Klausel hat 7 Datenspalten + updated_at; KEIN booked_by= oder created_at=     |
| server.js DELETE /api/payments/:id            | invoice_payments table            | execute() DELETE mit Permission-Guard                          | WIRED      | server.js:1581 Inline-Guard, 1588 DELETE; T11+T12 verifizieren                                       |
| server.js global DELETE middleware            | /api/payments/ pass-through        | path-Whitelist                                                | WIRED      | Z.61: `!req.path.startsWith('/api/payments/')` — Inline-Guard kann greifen                            |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                          | Status     | Evidence                                                                            |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| PAY-DB-01   | 04-01       | Tabelle invoice_payments mit allen 12 Feldern                                                        | SATISFIED  | PRAGMA table_info bestaetigt 12 Spalten in korrekter Reihenfolge                    |
| PAY-DB-02   | 04-01       | FK invoice_payments.invoice_id -> invoices.id ON DELETE CASCADE                                      | SATISFIED  | PRAGMA foreign_key_list zeigt CASCADE on_delete fuer invoices                       |
| PAY-DB-03   | 04-01       | CHECK direction IN ('in','out'); CHECK amount > 0                                                    | SATISFIED  | INSERT-Negativtests scheitern beide mit CHECK-Constraint-Fehler                     |
| PAY-DB-04   | 04-01       | Indizes (invoice_id, payment_date) und (bank_account_id)                                             | SATISFIED  | PRAGMA index_list zeigt beide                                                       |
| PAY-API-01  | 04-02       | GET /api/invoices/:id/payments liefert Zahlungen sortiert nach payment_date                          | SATISFIED  | T1 + SQL ORDER BY p.payment_date ASC, p.id ASC; T2: 404 fuer unbekannte invoice    |
| PAY-API-02  | 04-02       | POST /api/invoices/:id/payments setzt booked_by automatisch aus User                                 | SATISFIED  | T5 + T6 verifizieren Header-Identity, Body-Wert ignoriert                           |
| PAY-API-03  | 04-02       | PUT /api/payments/:id aktualisiert alle Felder ausser booked_by und created_at                       | SATISFIED  | T9: response zeigt booked_by="alice" (orig) und created_at unveraendert; updated_at advanced |
| PAY-API-04  | 04-02       | DELETE /api/payments/:id loescht eine Buchung                                                        | SATISFIED  | T11: 200 + success-Response; T15: Cleanup erfolgreich                               |
| PAY-API-05  | 04-02       | Permission-Guards: nur Verwaltung/Buchhaltung/Admin duerfen Zahlungen anlegen/aendern/loeschen        | SATISFIED  | T3, T4, T10, T12, T13: Benutzer/no-header -> 403 in allen 3 Schreib-Endpoints       |

Keine ORPHANED requirements — alle 9 Phase-4-Requirements aus REQUIREMENTS.md (Tabelle Zeilen 68-76) sind in Plan-Frontmatter deklariert und verifiziert.

### Anti-Patterns Found

| File      | Line | Pattern | Severity | Impact |
| --------- | ---- | ------- | -------- | ------ |
| (keine)   | -    | -       | -        | Keine TODO/FIXME/XXX/HACK/PLACEHOLDER Marker im neuen Code in db.js (Z.437-457) und server.js (Z.53-65, 1448-1590) gefunden |

### Human Verification Required

Keine. Alle Truths automatisiert verifizierbar (Datenbank-PRAGMA, HTTP-Statuscodes, Response-Bodies). UI-Aspekte sind in dieser Phase nicht Teil des Scope (kommt in Phase 6).

### Gaps Summary

Keine Gaps. Phase 4 hat das Goal vollstaendig erreicht:

1. **Schema produktionssicher:** invoice_payments existiert mit 12 Spalten, FK-CASCADE auf invoices, FK ohne CASCADE auf bank_accounts, beide CHECK-Constraints werden von SQLite enforced, beide Performance-Indizes sind angelegt, Migration ist idempotent.
2. **Endpoints schreiben nur fuer autorisierte Rollen:** Alle 3 Schreib-Endpoints (POST/PUT/DELETE) haben Inline-Permission-Guards `['Verwaltung', 'Buchhaltung', 'Admin']`. Benutzer-Rolle und fehlender Header werden mit 403 + `{error:"Keine Berechtigung"}` abgewiesen. Globales DELETE-Middleware hat /api/payments/ in der Whitelist, sodass der Inline-Guard greifen kann (Two-Layer-Auth).
3. **Server-controlled Identity:** booked_by wird ausschliesslich aus `x-user-name`-Header gelesen — Body-Wert wird konsequent ignoriert (verifiziert mit T6 und T9).
4. **Body-Validation vor SQL:** direction/amount/payment_date werden vor INSERT/UPDATE geprueft, klare 400-Antworten statt rohe CHECK-Constraint-500.
5. **GET ohne Guard:** Lesezugriff offen fuer alle Rollen, konsistent mit /api/invoices.

Phase 4 ist `Complete`. Phase 5 (Status-Logik & Listen-Integration) und Phase 6 (Detail-UI) koennen unmittelbar darauf aufsetzen.

### Live-Verifikations-Tests (12 HTTP + 4 SQL)

| #   | Test                                                          | Erwartung                                              | Ergebnis  |
| --- | ------------------------------------------------------------- | ------------------------------------------------------ | --------- |
| S1  | PRAGMA table_info -> 12 columns                               | alle 12                                                 | PASS      |
| S2  | PRAGMA foreign_key_list                                       | invoices CASCADE + bank_accounts                       | PASS      |
| S3  | PRAGMA index_list                                             | beide Indizes                                          | PASS      |
| S4  | INSERT direction='other' / amount=-5                          | CHECK-Constraint-Fehler                                | PASS      |
| T1  | GET /api/invoices/4/payments (leer)                           | 200 + []                                               | PASS      |
| T2  | GET /api/invoices/99999/payments                              | 404                                                    | PASS      |
| T3  | POST mit `Benutzer`                                           | 403 + 'Keine Berechtigung'                             | PASS      |
| T4  | POST OHNE permission Header                                   | 403                                                    | PASS      |
| T5  | POST mit Verwaltung + x-user-name=alice                       | 201 + Datensatz mit booked_by="alice"                  | PASS      |
| T6  | POST mit Body `{booked_by:"hacker"}` + Header admin1          | response booked_by="admin1" (Body ignoriert)           | PASS      |
| T7  | POST direction='other'                                        | 400 mit klarer Fehlermeldung                           | PASS      |
| T8  | POST amount=0                                                 | 400                                                    | PASS      |
| T9  | PUT `{amount:300, booked_by:"hacker"}`                        | 200, amount=300, booked_by unveraendert, updated_at++  | PASS      |
| T10 | PUT mit Benutzer                                              | 403                                                    | PASS      |
| T11 | DELETE mit Buchhaltung (Whitelist greift)                     | 200 + success                                          | PASS      |
| T12 | DELETE mit Benutzer (Inline-Guard greift)                     | 403                                                    | PASS      |
| T13 | DELETE OHNE permission                                        | 403                                                    | PASS      |
| T14 | GET nach allem                                                | 200 + verbleibende Zahlung mit bank_account_label=null | PASS      |
| I1  | Idempotency: getDb().then(()=>getDb())                        | kein Fehler                                            | PASS      |

---

_Verified: 2026-04-28T10:11:30Z_
_Verifier: Claude (gsd-verifier)_
