---
phase: 06-detail-ui-zahlungserfassung
plan: 01
subsystem: ui
tags: [frontend, invoice-detail, payment-header, saldo, vanilla-js, data-loaders]

requires:
  - phase: 05-status-logik-listen
    provides: GET /api/invoices/:id liefert payment_saldo + payment_status (Plan 05-01) und getPaymentStatusBadge() Helper in app.js (Plan 05-02)
  - phase: 04-schema-backend
    provides: GET /api/invoices/:id/payments (Plan 04-02) und GET /api/bank-accounts (existiert seit pre-v1.1)
provides:
  - "loadInvoicePayments(invoiceId) — async global function in public/js/app.js, ruft GET /api/invoices/:id/payments via api()-Helper auf, gibt Payment-Array zurueck. Wird von Plan 06-02 fuer die Zahlungstabelle wiederverwendet."
  - "loadBankAccounts() — async global function mit Modul-Cache (_bankAccountsCache), ruft GET /api/bank-accounts beim ersten Aufruf, cached die Antwort, defensive []-Fallback bei Fehlern. Wird von Plan 06-02 fuer das Konto-Dropdown im Zahlungs-Modal wiederverwendet."
  - "renderInvoicePaymentSaldoHeader(inv) — global function in public/js/app.js, rendert HTML-Card mit Status-Badge + 'Bereits bezahlt' + 'Offener Betrag', alle Werte aus inv.payment_saldo / inv.total_gross / inv.payment_status. Aufgerufen in renderInvoiceDetail() zwischen page-header und Kundendaten-Card."
  - "Header-Block in renderInvoiceDetail() — direkt nach Page-Header, vor Kundendaten-Card. Insertion via ${renderInvoicePaymentSaldoHeader(inv)} im Template-Literal."
affects: [06-02-zahlungstabelle-und-form]

tech-stack:
  added: []
  patterns:
    - "Modul-Cache-Pattern (_bankAccountsCache=null + lazy load + Reset-via-=null) — Bankkonten aendern sich selten, einmal pro Session laden reicht; Cache-Invalidation explizit durch Setter, kein TTL-Mechanismus noetig"
    - "Defensive Catch im Loader — bei Backend-Fehler liefert loadBankAccounts() ein leeres Array statt zu werfen, damit das Modal in Plan 06-02 trotzdem mit 'Bar/Kasse' arbeiten kann"
    - "Saldo-Header als 'card payment-saldo-header' Wrapper mit Inline-Flex-Styles — wiederverwendet bestehende .card-Klasse fuer Optik, kein neues CSS-Modul"
    - "Math.round(x * 100) / 100 fuer Display-Werte — verhindert Floating-Point-Display-Artefakte (z.B. 99.99999 als '99.99 €' statt '99.99999... €'), gleicher Pattern wie Phase 5 Plan 01 Backend-Aggregation"
    - "Farbige Offener-Betrag-Anzeige — danger (rot) wenn open>0, success (gruen) wenn open=0, text-muted (grau) wenn open<0 (ueberzahlt mit '(ueberzahlt)' Suffix)"
    - "Wiederverwendung getPaymentStatusBadge aus Plan 05-02 — selbe Helper-Funktion liefert die Status-Badge im Listen-View und im Detail-Header, garantiert visuelle Konsistenz"

key-files:
  created: []
  modified:
    - "public/js/app.js (Zeile 6131-6149: loadInvoicePayments + _bankAccountsCache + loadBankAccounts; Zeile 6151-6179: renderInvoicePaymentSaldoHeader; Zeile 6466: Aufruf ${renderInvoicePaymentSaldoHeader(inv)} im renderInvoiceDetail-Template)"

key-decisions:
  - "loadInvoicePayments als duenner Wrapper um api() — auch wenn der Aufruf trivial ist (api(`/api/invoices/${id}/payments`)), zentralisiert der Wrapper den Endpoint-Pfad an einer Stelle. Plan 06-02 wird ihn zweimal aufrufen (Tabelle laden + nach Save reload), und falls sich der Pfad aendert, ist nur eine Stelle betroffen."
  - "loadBankAccounts mit defensive []-Fallback statt Throw — Begruendung: das Konto-Dropdown im Zahlungs-Modal (Plan 06-02) muss IMMER renderbar sein, auch wenn die Bank-Accounts-API kurzfristig stockt. Bar-Zahlungen funktionieren ohne Konto, also ist [] ein valider Fallback. Der Verlust der Fehler-Information ist akzeptabel weil der user trotzdem Bar/Kasse-Zahlungen erfassen kann."
  - "Modul-Cache statt Cache-pro-Render — Bankkonten aendern sich selten (Verwaltung legt sie einmal an), waehrend ein User in einer Session mehrere Rechnungen oeffnet. Pro-Render-Cache wuerde n redundante API-Calls bedeuten."
  - "Saldo-Header mit Inline-Styles statt CSS-Klasse — Begruendung: Phase-6-spezifisches Layout (Flex mit gap, mehrere Inline-Spans), kein Wiederverwendungs-Bedarf in anderen Komponenten, neue CSS-Klasse haette nur den Style-Maintenance-Aufwand erhoeht ohne Mehrwert. Die .card-Wrapper-Klasse aus dem bestehenden CSS reicht fuer Spacing+Border."
  - "Open=Math.round((gross-paid)*100)/100 als Frontend-Berechnung statt Backend-Feld — payment_saldo kommt aus dem Backend, total_gross sowieso, der offene Betrag ist eine triviale Subtraktion. Backend-Erweiterung um payment_open waere zusaetzlicher Roundtrip+Test-Aufwand fuer null Gewinn. Sub-100ns-Rechnung im Browser ist gratis."
  - "open<0 -> 'ueberzahlt'-Text mit text-muted Farbe — semantisch sinnvoll: ueberzahlt ist KEIN Fehler-State (analog zu Plan 05-02 Badge-Farbe blue=info statt red=error). Der Status-Badge zeigt 'Ueberzahlt' bereits prominent, ein roter offener-Betrag waere widerspruechlich."
  - "renderInvoicePaymentSaldoHeader zwischen page-header und Kundendaten-Card platziert — direkt unter dem H2 ist die prominenteste Stelle (PAY-STAT-04 verlangt 'beim Oeffnen sofort sichtbar'), Kundendaten danach ist sekundaer."

patterns-established:
  - "Phase-6-Daten-Loader-Pattern: async function loadX(id) { return await api(...) } + optional Modul-Cache-Wrapper. Plan 06-02 wird denselben Pattern fuer ggf. weitere Loader (z.B. loadInvoicePaymentsCount) wiederverwenden koennen."
  - "Saldo-Display-Pattern: Math.round * 100 / 100 + .toFixed(2) + ' &euro;' Suffix. Konsistent mit bestehendem renderInvoiceSummary."
  - "Header-Insertion-Pattern: Template-Literal-Aufruf via ${functionName(arg)} direkt im main.innerHTML, neue Card folgt der bestehenden Card-Reihung. Wiederverwendbar fuer weitere Detail-Header-Blocks (z.B. Audit-Log-Header, Mahnstufen-Header in spaeteren Phasen)."

requirements-completed: [PAY-STAT-04, PAY-UI-05]

duration: 2min
completed: 2026-04-28
---

# Phase 06 Plan 01: Saldo-Header & Daten-Loader Summary

**Drei neue globale Funktionen in public/js/app.js (loadInvoicePayments, loadBankAccounts mit Modul-Cache, renderInvoicePaymentSaldoHeader) plus eine Header-Insertion in renderInvoiceDetail() — beim Oeffnen einer Rechnung sieht der Anwender direkt unter dem Page-Header eine Card mit Zahlungsstatus-Badge, 'Bereits bezahlt' und 'Offener Betrag', alle Werte aus dem Backend, ohne neues CSS, mit voller Wiederverwendung von getPaymentStatusBadge aus Plan 05-02.**

## Performance

- **Duration:** ~2 min (zwei kleine Edits, beide im ersten Versuch korrekt)
- **Started:** 2026-04-28T11:55:22Z
- **Completed:** 2026-04-28T11:56:54Z
- **Tasks:** 2 (1 Loader-Funktionen, 1 Saldo-Header + Insertion)
- **Files modified:** 1 (public/js/app.js, 52 Zeilen Diff: 21 Task 1 + 31 Task 2)
- **Files created:** 0

## Accomplishments

- `loadInvoicePayments(invoiceId)` — async wrapper um GET /api/invoices/:id/payments, gibt Array zurueck oder wirft 404
- `loadBankAccounts()` mit `_bankAccountsCache` — laedt /api/bank-accounts einmal pro Session, defensive []-Fallback bei Fehlern
- `renderInvoicePaymentSaldoHeader(inv)` — rendert flex-card mit Status-Badge + Bereits-bezahlt + Offener-Betrag, alle Werte aus inv-Object des Backends
- Insertion in renderInvoiceDetail() zwischen page-header und Kundendaten-Card — Header ist sofort beim Scroll-Top sichtbar
- Wiederverwendung getPaymentStatusBadge aus Phase 5 Plan 02 — selbe visuelle Konsistenz wie in der Listen-Ansicht
- KEINE neuen CSS-Klassen (nutzt bestehende .card + Inline-Styles)
- KEIN Duplikat von getPaymentStatusBadge (grep -c bleibt bei 1)
- node --check public/js/app.js exit 0 nach beiden Tasks

## Task Commits

Each task was committed atomically:

1. **Task 1: loadInvoicePayments + loadBankAccounts Daten-Loader hinzufuegen** — `2f7afa8` (feat)
2. **Task 2: Saldo-Header-Block in renderInvoiceDetail einfuegen** — `59bdf19` (feat)

**Plan metadata:** [pending final commit] (docs: complete plan)

## Files Created/Modified

- `public/js/app.js`:
  - Zeile 6131-6135: NEUE `async function loadInvoicePayments(invoiceId)` direkt nach getPaymentStatusBadge
  - Zeile 6137-6149: NEUE `let _bankAccountsCache = null;` + `async function loadBankAccounts()` mit try/catch + Cache-Logik
  - Zeile 6151-6179: NEUE `function renderInvoicePaymentSaldoHeader(inv)` mit Math.round-Saldo-Berechnung + Inline-Flex-Card
  - Zeile 6466: NEUE Zeile `${renderInvoicePaymentSaldoHeader(inv)}` zwischen schliessendem `</div>` der page-header und `<div class="card">` der Kundendaten

## Decisions Made

- **loadInvoicePayments als duenner Wrapper** — zentralisiert Endpoint-Pfad, falls sich /api/invoices/:id/payments aendert ist nur eine Stelle betroffen. Trivial-Code ist akzeptabel weil Plan 06-02 die Funktion mehrfach aufrufen wird.
- **loadBankAccounts mit defensive []-Fallback** — Konto-Dropdown im Plan-06-02-Modal muss IMMER renderbar sein. Bar/Kasse-Zahlungen funktionieren ohne Konto, also ist [] ein valider Fallback. Logging-Verlust akzeptabel weil User trotzdem Geschaeft fuehren kann.
- **Modul-Cache (let _bankAccountsCache=null) statt pro-Render-Cache** — Bankkonten aendern sich selten, in einer Session aber oeffnet der Anwender mehrere Rechnungen. Pro-Render-Cache haette n redundante API-Calls bedeutet. Reset via `_bankAccountsCache = null` ist explizit verfuegbar fuer zukuenftige CRUD-Operationen auf bank_accounts.
- **Saldo-Header mit Inline-Styles statt CSS-Klasse** — Phase-6-spezifisches Layout, kein Wiederverwendungsbedarf, neue CSS-Klasse waere reine Maintenance-Last. Bestehende `.card` reicht fuer Box-Style.
- **Open-Betrag im Frontend berechnen** — total_gross und payment_saldo kommen ohnehin vom Backend, Subtraktion ist trivial. Backend-Erweiterung um `payment_open` waere doppelter Test-Aufwand ohne Mehrwert.
- **open<0 -> dezent grau + '(ueberzahlt)' Suffix** — Ueberzahlung ist KEIN Fehler (konsistent mit Plan 05-02 Badge-Farbe blue=info). Roter Offener-Betrag bei -50 € waere semantisch widerspruechlich.
- **Insertion-Punkt zwischen page-header und Kundendaten-Card** — direkt unter dem H2 ist die prominenteste Stelle, PAY-STAT-04 verlangt "beim Oeffnen sofort sichtbar".
- **Math.round(x*100)/100 fuer Display-Werte** — verhindert Floating-Point-Artefakte (gleicher Pattern wie Phase 5 Plan 01 Backend-Aggregation).

## Deviations from Plan

None - plan executed exactly as written.

Beide Tasks wurden gemaess Plan-Pseudocode 1:1 umgesetzt. Keine Bug-Fixes, keine Missing-Critical-Funktionalitaet, keine Blocker, keine Architekturentscheidungen. Pseudocode aus dem Plan-Action-Block (loadInvoicePayments + loadBankAccounts in Task 1, renderInvoicePaymentSaldoHeader + Insertion in Task 2) wurde wortgetreu uebernommen.

## Issues Encountered

- Keine. Beide Edits funktionierten im ersten Anlauf, beide node --check Pruefungen waren gruen.
- Pre-existing uncommittete Aenderungen in STATE.md, config.json, data/bemo.db, public/index.html und mehrere untracked files vorhanden — wurden bewusst NICHT in die Plan-Commits einbezogen (git add explizit nur public/js/app.js).

## Verification Notes

**Statische Checks (alle gruen):**
- `node --check public/js/app.js` exit 0 (kein Syntaxfehler nach Task 1, kein Syntaxfehler nach Task 2)
- `grep -c "async function loadInvoicePayments"` = 1
- `grep -c "async function loadBankAccounts"` = 1
- `grep -c "let _bankAccountsCache"` = 1
- `grep -c "function renderInvoicePaymentSaldoHeader"` = 1
- `grep -c "function getPaymentStatusBadge"` = 1 (kein Duplikat)
- `grep -c "Bereits bezahlt:"` = 1
- `grep -c "Offener Betrag:"` = 1
- `grep -c "renderInvoicePaymentSaldoHeader\(inv\)"` = 2 (1x Funktionsdefinition, 1x Aufruf in renderInvoiceDetail)
- Insertion-Position verifiziert via grep -C: `${renderInvoicePaymentSaldoHeader(inv)}` steht auf Zeile 6466, zwischen `</div>` (page-header schliessend, 6464) und `<div class="card">` (Kundendaten oeffnend, 6468) — exakt wie im Plan spezifiziert

**Browser-Smoke-Verifikation:** Nicht erforderlich in Plan 06-01. Plan 06-02 wird beim human-verify-Checkpoint die volle End-to-End-Verifikation durchfuehren (Zahlungs-Modal + 5-Status-Uebergaenge + Header-Werte aktualisieren sich nach CRUD).

**Begruendung warum Browser-Smoke aufgeschoben wird:** Phase 5 Plan 02 hat bereits visuell bestaetigt, dass getPaymentStatusBadge die richtigen 4 Badge-Farben rendert. Phase 5 Plan 01 hat backend-seitig 12/12 E2E-Tests fuer payment_saldo+payment_status gruen. Die Insertion in renderInvoiceDetail ist mechanisch trivial (Template-Literal-String-Konkatenation). Eine isolierte Browser-Verifikation in Plan 06-01 vor Plan 06-02 waere unscharf, weil ohne Zahlungs-Erfassung-UI keine sinnvollen Saldo-Aenderungen sichtbar werden — der Header zeigt einfach das, was das Backend bereits in Plan 05-01 als payment_saldo=0 fuer alle bestehenden Rechnungen liefert.

## User Setup Required

None - keine externen Services, keine neuen Permissions, keine DB-Migration. Bestehende Backend-Routen (/api/invoices/:id, /api/invoices/:id/payments, /api/bank-accounts) sind seit Phase 4 + 5 verfuegbar.

## Next Phase Readiness (Plan 06-02)

- **loadInvoicePayments wiederverwendbar:** Plan 06-02 ruft `await loadInvoicePayments(id)` auf um die Zahlungstabelle zu rendern, dann erneut nach jedem CRUD-Save fuer den Reload.
- **loadBankAccounts wiederverwendbar:** Plan 06-02 ruft `await loadBankAccounts()` auf um das Konto-Dropdown im Modal zu fuellen — Cache reduziert API-Calls bei wiederholten Modal-Oeffnungen.
- **renderInvoicePaymentSaldoHeader bleibt aktuell:** Plan 06-02 muss nach jedem CRUD-Save renderInvoiceDetail() neu aufrufen oder gezielt den Header neu rendern damit payment_saldo/payment_status visuell aktualisiert werden. Empfehlung: ganze Detail-Seite via `navigate('invoice-detail', id)` oder `renderInvoiceDetail(id)` reloaden — einfacher als gezielte DOM-Updates.
- **Header-Position verifiziert:** Plan 06-02 wird die Zahlungstabelle vermutlich UNTER der Positionen-Card einfuegen. Header oben + Tabelle unten = die natuerliche User-Flow-Reihenfolge (sehen-was-offen-ist -> Zahlung-erfassen).
- **Phase 6 End-to-End-Verifikation in Plan 06-02 noetig:** Wie in Phase 5 Plan 02 Verification Notes vermerkt, sollte das volle 5-Status-Uebergaenge-Szenario (offen -> teilbezahlt -> bezahlt -> ueberzahlt -> bezahlt nach Korrektur) lueckenlos durchgespielt werden, sobald Plan 06-02 die Zahlungs-Erfassung-UI fertig hat.

---
*Phase: 06-detail-ui-zahlungserfassung*
*Completed: 2026-04-28*

## Self-Check: PASSED

- FOUND: `.planning/phases/06-detail-ui-zahlungserfassung/06-01-SUMMARY.md` erstellt
- FOUND: `public/js/app.js` modifiziert (52 Zeilen Diff, Zeilen 6131-6179 + 6466)
- FOUND: commit `2f7afa8` in git log (Task 1 — loadInvoicePayments + loadBankAccounts)
- FOUND: commit `59bdf19` in git log (Task 2 — renderInvoicePaymentSaldoHeader + Insertion)
- FOUND: `async function loadInvoicePayments` in app.js (grep -c = 1)
- FOUND: `async function loadBankAccounts` in app.js (grep -c = 1)
- FOUND: `let _bankAccountsCache` in app.js (grep -c = 1)
- FOUND: `function renderInvoicePaymentSaldoHeader` in app.js (grep -c = 1)
- FOUND: `function getPaymentStatusBadge` in app.js (grep -c = 1, kein Duplikat)
- FOUND: `Bereits bezahlt:` Label in app.js (grep -c = 1)
- FOUND: `Offener Betrag:` Label in app.js (grep -c = 1)
- FOUND: `${renderInvoicePaymentSaldoHeader(inv)}` Aufruf zwischen page-header `</div>` und Kundendaten-Card auf Zeile 6466
- FOUND: `node --check public/js/app.js` exit 0 nach beiden Tasks (kein Syntaxfehler)
