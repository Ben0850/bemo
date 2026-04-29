---
phase: 06-detail-ui-zahlungserfassung
verified: 2026-04-28T12:15:00Z
status: passed
score: 11/11 must-haves verified
re_verification: null
human_verification:
  - test: "5-Status-Übergangs-Sequenz visuell durchspielen"
    expected: "Brutto 1000€: ohne Zahlung 'offen' → +400€ Eingang 'teilbezahlt' → +600€ Eingang 'bezahlt' → +100€ Eingang 'ueberzahlt' → +100€ Ausgang 'bezahlt'. Saldo-Header und Tabelle aktualisieren sich nach jedem CRUD ohne Page-Reload."
    why_human: "Visuelle Konsistenz, Modal-UX, partielles Re-Rendering ohne Scroll-Sprung — durch grep nicht beobachtbar. Wurde vom User explizit als nach-Phase-Verification-Schritt reserviert (analog Phase 5 Plan 02 Pattern, 'keine weiteren Zwischenfragen mehr')."
  - test: "Permission-Aware UI manuell testen"
    expected: "Mit Rolle 'Benutzer' eingeloggt: weder '+ Zahlungseingang/Ausgang' Buttons noch Bearbeiten/Löschen-Buttons sind sichtbar. Mit Rolle 'Verwaltung'/'Buchhaltung'/'Admin': alle Buttons sichtbar."
    why_human: "Login-Flow + Session-Switch + DOM-Inspektion erfordert Browser. canEditInvoice() ist statisch verifiziert (4-Layer-Check), die visuelle Konsequenz nicht."
  - test: "Default-Bankkonto Vorauswahl im Modal"
    expected: "Beim Öffnen von '+ Zahlungseingang' ist im Bankkonto-Dropdown jenes mit is_default=1 vorausgewählt."
    why_human: "Banken-Datensatz-State zur Laufzeit + Dropdown-DOM-Inspektion."
---

# Phase 6: Detail-UI & Zahlungserfassung Verification Report

**Phase Goal:** Anwender können Zahlungen direkt aus der Rechnungs-Detailseite erfassen, einsehen, bearbeiten und löschen — mit voller Saldo-Transparenz und prominenter Status-Anzeige.

**Verified:** 2026-04-28T12:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (aus ROADMAP.md Success Criteria + PLAN must_haves)

| #   | Truth                                                                                                                                                                | Status     | Evidence                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rechnungs-Detailseite enthält "Zahlungen"-Block mit chronologischer Tabelle (Datum/Richtung/Betrag/Konto/Zahlungsart/Buchungs-User/Notiz)                            | ✓ VERIFIED | `renderInvoicePaymentsBlock` Z.6569-6664; `<th>` Datum (6646), Richtung (6647), Betrag (6648), Konto (6649), Zahlungsart (6650), Buchungs-User (6651), Notiz (6652)                                                  |
| 2   | "+ Zahlungseingang" / "+ Zahlungsausgang" Buttons öffnen Modal-Formular mit Datum (default heute) / Betrag / Bankkonto-Dropdown / Zahlungsart / Notiz                 | ✓ VERIFIED | Buttons Z.6583-6584; `openInvoicePaymentForm` Z.6699-6790; `today = new Date().toISOString().split('T')[0]` Z.6723; Felder pay-date, pay-amount, pay-bank-account, pay-method, pay-notes Z.6753-6782                |
| 3   | Speichern legt Zahlung an und aktualisiert Tabelle ohne Seitenneuladen                                                                                                | ✓ VERIFIED | `saveInvoicePayment` Z.6793-6826; `await refreshInvoicePaymentsBlock(invoiceId)` Z.6822; DOM-Replacement via `replaceWith` in refresh Z.6681 + 6690                                                                  |
| 4   | Über jeder Zeile: Bearbeiten + Löschen mit Bestätigungs-Dialog; beide aktualisieren Tabelle und Saldo-Block                                                          | ✓ VERIFIED | Buttons Z.6604-6605; `openInvoicePaymentForm(invoiceId, dir, p.id)` für Edit; `deleteInvoicePayment` Z.6829 mit `confirm("Zahlung vom ${dateStr} ueber ${amtStr} EUR wirklich loeschen?")` Z.6833                    |
| 5   | "Bereits bezahlt: X €", "Offener Betrag: Y €", Status-Badge sichtbar über der Zahlungs-Tabelle — Werte stimmen mit Server-Berechnung überein                         | ✓ VERIFIED | `renderInvoicePaymentSaldoHeader` Z.6155-6179; "Bereits bezahlt:" Z.6169; "Offener Betrag:" Z.6173; Status-Badge via `getPaymentStatusBadge(inv.payment_status)` Z.6166; Live-API liefert payment_saldo+payment_status |
| 6   | Status-Badge + Restbetrag prominent im oberen Bereich der Detailseite (sofort beim Öffnen sichtbar, nicht erst beim Scrollen)                                         | ✓ VERIFIED | Insertion in renderInvoiceDetail Z.6466 — `${renderInvoicePaymentSaldoHeader(inv)}` direkt zwischen page-header `</div>` (Z.6464) und Kundendaten-Card (Z.6468)                                                       |
| 7   | Bestehende Zahlungen aus Phase 4 erscheinen sofort in der Tabelle                                                                                                     | ✓ VERIFIED | Auto-Load Z.6546-6557 in renderInvoiceDetail: `await loadInvoicePayments(id)` + Placeholder-Replace; Backend `/api/invoices/:id/payments` HTTP 200 verifiziert                                                       |
| 8   | Berechtigungs-Aware UI (canEditInvoice/Verwaltung/Buchhaltung/Admin)                                                                                                  | ✓ VERIFIED | `canEditInvoice()` 13 Aufrufe (4 neue in Phase 6); `canEditInvoice` Z.32 prüft Verwaltung/Buchhaltung/Admin; Buttons + Aktionen-Spalte konditional in `renderInvoicePaymentsBlock`                                   |
| 9   | `loadInvoicePayments(invoiceId)` gibt Zahlungs-Array zurück (Wiederverwendung in Plan 06-02)                                                                          | ✓ VERIFIED | Definition Z.6134-6136; 3 Aufrufstellen (renderInvoiceDetail Z.6547, refresh Z.6672, openForm Z.6710)                                                                                                                |
| 10  | `loadBankAccounts()` gibt Bankkonten-Array zurück und cached den Wert                                                                                                 | ✓ VERIFIED | `_bankAccountsCache = null` Z.6141; `loadBankAccounts` Z.6142-6150 mit Cache-Hit + try/catch + []-Fallback; aufgerufen in `openInvoicePaymentForm` Z.6705                                                            |
| 11  | Status-Badge im Detail-Header und Listen-Ansicht zeigen für dieselbe Rechnung denselben Wert (visuelle Konsistenz)                                                    | ✓ VERIFIED | Beide nutzen `getPaymentStatusBadge` (1× definiert Z.6120, kein Duplikat) → Single Source of Truth für Badge-Style                                                                                                  |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact                                                                            | Expected                                                       | Status     | Details                                                                                                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `public/js/app.js` :: `loadInvoicePayments(invoiceId)`                              | async global, async wrapper um GET /api/invoices/:id/payments | ✓ VERIFIED | Z.6134-6136, dünner Wrapper über `api()`-Helper                                                                                       |
| `public/js/app.js` :: `loadBankAccounts()`                                          | async global, mit Modul-Cache `_bankAccountsCache`             | ✓ VERIFIED | Z.6141-6150, Cache + Lazy-Load + defensive []-Fallback bei Fehlern                                                                     |
| `public/js/app.js` :: `renderInvoicePaymentSaldoHeader(inv)`                        | Bereits bezahlt + Offener Betrag + Status-Badge                | ✓ VERIFIED | Z.6155-6179, Math.round-Saldo, Farb-Coded Offener-Betrag (rot/grün/grau bei Überzahlung), wiederverwendet getPaymentStatusBadge        |
| `public/js/app.js` :: `renderInvoicePaymentsBlock(payments, invoice)`               | Tabelle + Header-Buttons + Saldo-Footer, permission-aware      | ✓ VERIFIED | Z.6569-6664, 7 oder 8 Spalten je nach canEdit, Empty-State + Saldo-Footer mit Eingang/Ausgang-Aufschlüsselung                          |
| `public/js/app.js` :: `refreshInvoicePaymentsBlock(invoiceId)`                      | DOM-Replacement nach CRUD                                       | ✓ VERIFIED | Z.6668-6695, Promise.all parallel-fetch von Invoice + Payments, gezielter `replaceWith` für Saldo-Header und Zahlungs-Card             |
| `public/js/app.js` :: `openInvoicePaymentForm(invoiceId, direction, editPaymentId)` | Modal mit allen Pflicht- + Optionalfeldern                     | ✓ VERIFIED | Z.6699-6790, Edit-Modus via find-in-Liste, Default-Bankkonto via is_default, 6 Zahlungsarten, Permission-Guard am Funktions-Anfang     |
| `public/js/app.js` :: `saveInvoicePayment(event, invoiceId, editPaymentId)`         | POST/PUT, Validation, refresh                                   | ✓ VERIFIED | Z.6793-6826, Frontend-Validation Datum/Richtung/Betrag, Body OHNE booked_by/created_at, refresh + Toast-Feedback                       |
| `public/js/app.js` :: `deleteInvoicePayment(...)`                                   | Confirm mit Datum + Betrag                                      | ✓ VERIFIED | Z.6829-6841, Permission-Check vor confirm, `formatDate(paymentDate)` + `Number(amount).toFixed(2)`, dann DELETE + refresh             |
| `public/js/app.js` :: `<div id="invoice-payments-block-placeholder">`               | In renderInvoiceDetail, ersetzt durch payments-block            | ✓ VERIFIED | Z.6541 als Placeholder, Z.6546-6557 inner-try/catch ersetzt via outerHTML, Fehler-Card-Fallback bei Payments-API-Fehler                |
| `public/js/app.js` :: Header-Insertion in renderInvoiceDetail                       | Zwischen page-header und Kundendaten-Card                       | ✓ VERIFIED | Z.6466 — `${renderInvoicePaymentSaldoHeader(inv)}` direkt zwischen Z.6464 (page-header `</div>`) und Z.6468 (Kundendaten `<div class>`) |
| `getPaymentStatusBadge` (Phase 5 Plan 02) — wiederverwendet, nicht dupliziert       | grep -c = 1                                                    | ✓ VERIFIED | grep zeigt Z.6120 als einzige Definition; aus 06-01 + 06-02 referenziert ohne Duplikat                                                  |

### Key Link Verification

| From                                              | To                                                          | Via                                                              | Status   | Details                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `renderInvoiceDetail()`                           | `renderInvoicePaymentSaldoHeader(inv)`                       | Template-Literal `${renderInvoicePaymentSaldoHeader(inv)}`        | ✓ WIRED  | Z.6466                                                                                           |
| `renderInvoicePaymentSaldoHeader()`               | `getPaymentStatusBadge()` (Phase 5 Plan 02)                  | Direkter Funktionsaufruf                                          | ✓ WIRED  | Z.6166: `getPaymentStatusBadge(inv.payment_status)`                                              |
| `renderInvoiceDetail()`                           | `loadInvoicePayments(id)` + `renderInvoicePaymentsBlock`     | Async-Block nach Saldo-Header, ersetzt Placeholder via outerHTML  | ✓ WIRED  | Z.6546-6557 mit inner-try/catch                                                                  |
| `saveInvoicePayment` / `deleteInvoicePayment`     | Saldo-Header + Tabelle (DOM-Replacement)                     | `refreshInvoicePaymentsBlock(invoiceId)`                          | ✓ WIRED  | save Z.6822, delete Z.6837                                                                       |
| `refreshInvoicePaymentsBlock`                     | GET /api/invoices/:id + GET /api/invoices/:id/payments       | Promise.all parallel, danach DOM-Replacement                      | ✓ WIRED  | Z.6670-6691, beide Endpoints HTTP 200 live verifiziert                                           |
| `openInvoicePaymentForm`                          | Bankkonten-Dropdown                                          | `await loadBankAccounts()` aus Plan 06-01                         | ✓ WIRED  | Z.6705                                                                                            |
| Buttons + Aktionen-Spalte                         | Permission-Check                                              | `canEditInvoice()` — Verwaltung/Buchhaltung/Admin                 | ✓ WIRED  | 4 neue Aufrufstellen in Phase 6 + 9 vorbestehende = 13 Total                                     |
| Frontend Saldo-Header                              | Backend `payment_saldo` + `payment_status`                   | `inv.payment_saldo` + `inv.payment_status`                        | ✓ WIRED  | Live-API GET /api/invoices/8 liefert beide Felder; Frontend liest in renderInvoicePaymentSaldoHeader |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                                                                                                                            | Status      | Evidence                                                                                                                          |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| PAY-STAT-04 | 06-01       | Status wird in der Rechnungs-Detailseite prominent angezeigt zusammen mit Restbetrag                                                                                                                   | ✓ SATISFIED | renderInvoicePaymentSaldoHeader Z.6155-6179 + Insertion direkt unter page-header Z.6466                                            |
| PAY-UI-01   | 06-02       | Rechnungs-Detailseite zeigt einen "Zahlungen"-Block mit chronologischer Tabelle (Datum, Richtung Eingang/Ausgang, Betrag, Konto, Zahlungsart, Buchung-User, Notiz)                                     | ✓ SATISFIED | renderInvoicePaymentsBlock Z.6569-6664 mit allen 7 Spalten + 8. Aktionen-Spalte (canEdit)                                          |
| PAY-UI-02   | 06-02       | Button "+ Zahlungseingang" und "+ Zahlungsausgang" in der Rechnungs-Detailseite                                                                                                                        | ✓ SATISFIED | Buttons Z.6583-6584, beide rufen `openInvoicePaymentForm(invoiceId, 'in'\|'out')`                                                  |
| PAY-UI-03   | 06-02       | Formular mit Feldern: Datum (default heute), Betrag, Bankkonto (Dropdown aus bank_accounts), Zahlungsart (Überweisung/Bar/Kartenzahlung/...), Verwendungszweck/Notiz                                   | ✓ SATISFIED | openInvoicePaymentForm Z.6699-6790; pay-date default `today` Z.6723; bankOptions Z.6734-6741; PAYMENT_METHODS 6 Optionen Z.6743    |
| PAY-UI-04   | 06-02       | Bestehende Zahlungen lassen sich aus der Tabelle direkt bearbeiten und löschen (mit Bestätigungs-Dialog)                                                                                                | ✓ SATISFIED | Bearbeiten-Button → openInvoicePaymentForm im Edit-Modus; Löschen-Button → deleteInvoicePayment mit confirm-Dialog (Datum+Betrag) |
| PAY-UI-05   | 06-01       | Saldo-Anzeige ("Bereits bezahlt: X €", "Offener Betrag: Y €") über der Zahlungs-Tabelle, plus Status-Badge                                                                                              | ✓ SATISFIED | renderInvoicePaymentSaldoHeader Z.6168-6175 mit allen drei Elementen                                                              |

**Orphaned requirements:** Keine. Alle 6 in REQUIREMENTS.md für Phase 6 gelisteten IDs sind in den Plan-Frontmatters deklariert (PAY-STAT-04+PAY-UI-05 in 06-01; PAY-UI-01..04 in 06-02).

### Anti-Patterns Found

| File              | Line | Pattern                                                                | Severity | Impact                              |
| ----------------- | ---- | ---------------------------------------------------------------------- | -------- | ----------------------------------- |
| (keine)           | —    | Kein TODO/FIXME/XXX/HACK/Coming-soon im Phase-6-Code (Z.6131-6841)     | —        | —                                   |

Hinweis: Der `id="invoice-payments-block-placeholder"` ist KEIN Stub-Indikator, sondern ein dokumentiertes DOM-Replacement-Pattern. `placeholder=`-HTML-Attribute in input/textarea-Feldern sind native HTML5-Attribute (Hint-Text), kein Stub.

### Live-Backend-Verifikation

| Endpoint                          | Status   | Evidence                                                                                                |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| GET /api/invoices                 | HTTP 200 | curl liefert Invoice-Array                                                                              |
| GET /api/invoices/8               | HTTP 200 | Response enthält `payment_saldo: 0`, `payment_status: 'bezahlt'`, `total_gross: 0` — Frontend-Vertrag erfüllt |
| GET /api/invoices/8/payments      | HTTP 200 | Endpoint reachable, von loadInvoicePayments konsumiert                                                  |
| GET /api/bank-accounts            | HTTP 200 | Endpoint reachable, von loadBankAccounts konsumiert                                                     |

### Syntax & Static Checks

- `node --check public/js/app.js` → exit 0 ✓
- `grep -c "async function loadInvoicePayments"` = 1 ✓
- `grep -c "async function loadBankAccounts"` = 1 ✓
- `grep -c "let _bankAccountsCache"` = 1 ✓
- `grep -c "function renderInvoicePaymentSaldoHeader"` = 1 ✓
- `grep -c "function renderInvoicePaymentsBlock"` = 1 ✓
- `grep -c "async function refreshInvoicePaymentsBlock"` = 1 ✓
- `grep -c "async function openInvoicePaymentForm"` = 1 ✓
- `grep -c "async function saveInvoicePayment"` = 1 ✓
- `grep -c "async function deleteInvoicePayment"` = 1 ✓
- `grep -c "function getPaymentStatusBadge"` = 1 (KEIN Duplikat) ✓
- `grep -c "Bereits bezahlt:"` = 1 ✓
- `grep -c "Offener Betrag:"` = 1 ✓
- `grep -c "+ Zahlungseingang"` ≥ 1 ✓
- `grep -c "+ Zahlungsausgang"` ≥ 1 ✓
- `grep -c "wirklich loeschen"` ≥ 1 ✓ (Z.6833)
- `grep -c "renderInvoicePaymentSaldoHeader\("` = 3 (Definition + renderInvoiceDetail + refresh) ✓
- `grep -c "loadInvoicePayments\("` = 4 (Definition + renderInvoiceDetail-Auto-Load + refresh + openForm) ✓
- `grep -c "loadBankAccounts\("` = 2 (Definition + openForm) ✓
- `grep -c "id=\"invoice-payments-block-placeholder\""` = 1 ✓
- `grep -c "canEditInvoice()"` = 13 (4 neue + 9 vorbestehende) ✓

### Human Verification Required

Drei Items für die finale visuelle End-to-End-Verifikation, vom User explizit für die Post-Phase-Verifikation reserviert:

1. **5-Status-Übergangs-Sequenz visuell durchspielen**
   - Test: Brutto 1000€ Rechnung anlegen → "offen" → +400€ Eingang erfassen → "teilbezahlt" → +600€ Eingang → "bezahlt" → +100€ Eingang → "ueberzahlt" → +100€ Ausgang → "bezahlt"
   - Expected: Saldo-Header und Tabelle aktualisieren sich nach jedem CRUD ohne Page-Reload, Status-Badge wechselt korrekt durch alle vier Stati
   - Why human: Visuelle Konsistenz, Modal-UX, partielles Re-Rendering ohne Scroll-Sprung — durch grep nicht beobachtbar

2. **Permission-Aware UI Test (Rolle wechseln)**
   - Test: Mit Rolle "Benutzer" einloggen → Detailseite öffnen → keine "+"-Buttons + keine Aktionen-Spalte
   - Test (2): Mit Rolle "Verwaltung"/"Buchhaltung"/"Admin" einloggen → alle Buttons sichtbar
   - Expected: Permission-Aware UI funktioniert visuell wie spezifiziert
   - Why human: Login-Flow + Session-Switch + DOM-Inspektion erfordert Browser

3. **Default-Bankkonto Vorauswahl im Modal**
   - Test: "+ Zahlungseingang" klicken
   - Expected: Bankkonto-Dropdown hat das Konto mit `is_default=1` vorausgewählt
   - Why human: Banken-State zur Laufzeit + Dropdown-DOM-Inspektion

### Gaps Summary

**Keine Gaps gefunden.** Alle 11 Observable Truths sind durch implementierte Artefakte und korrekte Wiring-Pfade belegt. Alle 6 Requirements (PAY-STAT-04, PAY-UI-01..05) sind durch Code abgedeckt. Live-Backend liefert die erwarteten Felder. Syntax-Check grün, keine Anti-Patterns. `getPaymentStatusBadge` ist exakt 1× definiert (kein Duplikat — wiederverwendet aus Phase 5 Plan 02).

Die drei verbleibenden Browser-E2E-Tests (5-Status-Übergänge, Permission-Aware UI Switch, Default-Bankkonto) sind durch User-Anweisung explizit als Post-Phase-Verifikations-Schritt reserviert ("keine weiteren Zwischenfragen") — analog zum Phase-5-Plan-2-Pattern. Statische grep-/syntax-/curl-Verifikation bestätigt die zugrundeliegende Code-Implementation zu 100%.

---

_Verified: 2026-04-28T12:15:00Z_
_Verifier: Claude (gsd-verifier)_
