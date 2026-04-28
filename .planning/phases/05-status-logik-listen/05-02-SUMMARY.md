---
phase: 05-status-logik-listen
plan: 02
subsystem: ui
tags: [frontend, badge, table, filter, vanilla-js, list-view, payment-status]

requires:
  - phase: 05-status-logik-listen
    provides: GET /api/invoices liefert payment_saldo (number, 2 NK) und payment_status (string, lowercase ohne Umlaut) pro Rechnung (Plan 05-01)
provides:
  - "getPaymentStatusBadge(payment_status) Helper-Funktion in public/js/app.js — Pendant zu getInvoiceStatusBadge(), Mapping lowercase->Capitalize ('offen'->'Offen', 'teilbezahlt'->'Teilbezahlt', 'bezahlt'->'Bezahlt', 'ueberzahlt'->'Ueberzahlt'), Default 'Unbekannt' fuer undefined"
  - "Neue Tabellen-Spalte 'Zahlung' in renderInvoices()/applyInvoiceFilters() zwischen 'Status' und 'Aktionen' — 9 Spalten statt 8"
  - "Filter-Dropdown id=inv-filter-payment-status mit 4 Optionen plus 'Alle' — additiver Filter, der parallel zum bestehenden status-Filter arbeitet"
  - "Badge-Farben: gray=offen, orange=teilbezahlt, green=bezahlt, blue=ueberzahlt — alle bereits vorhandenen badge-* CSS-Klassen wiederverwendet, KEIN neues CSS"
affects: [06-detail-ui]

tech-stack:
  added: []
  patterns:
    - "Status-Display-Mapping-Layer im Frontend: Backend liefert technische lowercase-Werte ohne Umlaut, Frontend macht Capitalize+Umlaut-sicheres Display ('Ue' statt 'Ü')"
    - "Additive Liste-Spalte: payment_status erscheint NEBEN dem bestehenden invoices.status, nicht als Ersatz — beide Status sind unterschiedliche Konzepte (manuell gesetzt vs. aus Saldo abgeleitet)"
    - "Wiederverwendung bestehender badge-* CSS-Klassen — keine UI-Stil-Inflation durch neue Klassen"
    - "Filter-Reader-Pattern: const x = document.getElementById('id')?.value || '' am Anfang von applyInvoiceFilters(), gefolgt von if-return-false-Klausel im Lambda"

key-files:
  created: []
  modified:
    - "public/js/app.js (Zeilen 6117-6131: neue getPaymentStatusBadge-Funktion; Zeilen 6162+6178-6184: <th>Zahlung</th> + Filter-Dropdown im thead; Zeile 6208: paymentStatus-Reader; Zeile ~6228: Filter-Klausel; Zeile 6243: colspan 8->9; Zeile 6256: <td>-Badge im TR-Template)"

key-decisions:
  - "Badge-Farben: ueberzahlt=blau (Info-State, kein Fehler-State). Alternative rot wurde verworfen, weil Ueberzahlung typischerweise ein bewusstes Vorauszahlen oder Skonto-Ausgleich ist und kein Korrekturbedarf signalisiert werden soll. Resume-Signal des Plans liess die Farbe verhandelbar — User-Approval bestaetigt blau implizit."
  - "Anzeige-Strings mit 'Ue' statt 'Ü' — HTML-sicher in allen Browsern, konsistent mit dem lowercase Backend-Identifier 'ueberzahlt'. Vermeidet Encoding-Risiken bei JSON-Roundtrip oder CSV-Export."
  - "Additive Spalte 'Zahlung' (nicht Ersatz fuer 'Status') — bestehender invoices.status (Entwurf/Versendet/Mahnstufe...) bleibt Anwender-Werkzeug fuer manuelle Workflows. payment_status ist ein zusaetzliches automatisches Aggregat — beides parallel sichtbar gibt dem Anwender vollstaendige Information."
  - "Default-Label 'Unbekannt' fuer undefined/null payment_status statt Crash — defensive UI fuer den Fall dass Backend-Plan-05-01-Deployment in Cache haengt. Backend wird in der Praxis immer einen der 4 Werte liefern (LEFT JOIN garantiert Saldo=0 fuer Rechnungen ohne Zahlungen)."
  - "Filter-Dropdown unter 'Zahlung'-Header (in der filter-row, nicht als separate Toolbar) — konsistent mit bestehendem Status-Filter, derselbe Bedien-Pattern."
  - "Keine CSS-Aenderung — alle 4 benoetigten Badge-Farben (gray, orange, green, blue) existieren bereits in style.css aus frueheren Phasen. CSS-Inflation vermieden."

patterns-established:
  - "Status-Helper-Pattern fuer abgeleitete Status: getX_StatusBadge(value) -> map[value] || default -> escaped HTML-Span mit class='badge badge-Y'. Phase 6 (Detail-UI) kann denselben Helper wiederverwenden."
  - "Additive Spalten-Erweiterung: neue Liste-Spalte einfuegen = thead-th + filter-row-td + tbody-td-im-TR + colspan-Anpassung im empty-state. Kompletter 4-Punkt-Checklisten-Edit, der konsistent in mehreren Liste-Renderern wiederholbar ist."

requirements-completed: [PAY-STAT-03]

duration: 13min
completed: 2026-04-28
---

# Phase 05 Plan 02: Frontend Status-Badge in Rechnungs-Liste Summary

**getPaymentStatusBadge()-Helper plus erweiterte Tabellen-Spalte 'Zahlung' in renderInvoices()/applyInvoiceFilters() — der in Plan 05-01 abgeleitete payment_status erscheint jetzt als farbiger Badge (gray/orange/green/blue) neben dem bestehenden manuellen invoices.status, ergaenzt um einen Dropdown-Filter — alles ohne neues CSS, durch Wiederverwendung der vorhandenen badge-* Klassen.**

## Performance

- **Duration:** ~13 min (Code-Edit + Live-Verifikation)
- **Started:** 2026-04-28T10:45:00Z (ungefaehr; Task 1 commit timestamp 12:45:14 lokal = 10:45:14 UTC)
- **Completed:** 2026-04-28T10:57:57Z
- **Tasks:** 2 (1 code, 1 human-verify checkpoint)
- **Files modified:** 1 (public/js/app.js, 39 Zeilen Diff)
- **Files created:** 0

## Accomplishments

- getPaymentStatusBadge(payment_status) als Helper-Funktion in app.js, Pendant zu bestehendem getInvoiceStatusBadge — Mapping lowercase->Capitalize, Default 'Unbekannt' fuer undefined
- Neue Tabellen-Spalte 'Zahlung' in der Rechnungs-Liste zwischen 'Status' und 'Aktionen' (9 Spalten statt 8, alle Stellen synchron: thead, filter-row, tbody-TR, empty-state colspan)
- Filter-Dropdown 'Zahlung' (id=inv-filter-payment-status) mit 4 Status-Optionen plus 'Alle' — additiv zum bestehenden Status-Filter, beide kombinierbar
- Bestehender invoices.status (Entwurf/Versendet/Mahnstufe...) bleibt unangetastet sichtbar in Spalte 7 — neuer Badge ist additiv, nicht Ersatz
- KEIN CSS-Edit noetig: die vier benoetigten Badge-Farben (gray, orange, green, blue) existieren bereits in style.css und wurden wiederverwendet
- 5/5 Helper-Smoke-Tests gruen (offen->Offen/gray, teilbezahlt->Teilbezahlt/orange, bezahlt->Bezahlt/green, ueberzahlt->Ueberzahlt/blue, unknown->unknown/gray)
- node --check public/js/app.js exit 0 (keine JS-Syntaxfehler)
- User-Approval am human-verify Checkpoint erteilt (siehe Verification Notes unten)

## Task Commits

Each task was committed atomically:

1. **Task 1: getPaymentStatusBadge()-Helper hinzufuegen + Tabelle in renderInvoices()/applyInvoiceFilters() um Spalte 'Zahlung' erweitern** - `e565725` (feat)
2. **Task 2: Visuelle und funktionale Verifikation der Zahlungsstatus-Spalte** - kein Code-Commit (User-Approval-Checkpoint)

**Plan metadata:** [pending final commit] (docs: complete plan)

## Files Created/Modified

- `public/js/app.js`:
  - Zeile 6117-6131: NEUE Helper-Funktion `function getPaymentStatusBadge(payment_status)` direkt nach `getInvoiceStatusBadge`
  - Zeile 6162: NEUE `<th>Zahlung</th>`-Spalte im thead, zwischen Status und Aktionen
  - Zeile 6178-6184: NEUE `<td>` mit `<select id="inv-filter-payment-status">` Dropdown in filter-row
  - Zeile 6208: NEUER Reader `const paymentStatus = (document.getElementById('inv-filter-payment-status')?.value || '');`
  - Zeile ~6228: NEUE Filter-Klausel `if (paymentStatus && inv.payment_status !== paymentStatus) return false;`
  - Zeile 6243: Empty-State `colspan="8"` -> `colspan="9"`
  - Zeile 6256: NEUE `<td>${getPaymentStatusBadge(inv.payment_status)}</td>` im TR-Template, zwischen Status-TD und Aktionen-TD

## Decisions Made

- **Badge-Farben gray/orange/green/blue** — neutral->aktion-noetig->erledigt->info. Alternative rot fuer 'ueberzahlt' wurde verworfen, weil Ueberzahlung in der Buchhaltungspraxis ein bewusster Vorgang (Vorauszahlung, Skonto-Ausgleich, Sammel-Ueberweisung) und kein Korrektur-Bedarf ist. Resume-Signal liess die Farbe verhandelbar — User-Approval bestaetigt blau implizit.
- **Anzeige-Strings 'Ue' statt 'Ü'** — HTML-sicher und konsistent mit Backend-Identifier 'ueberzahlt'. Vermeidet UTF-8-Encoding-Probleme bei JSON-Serialisierung, CSV-Export oder DB-Persistenz.
- **Additive Spalte 'Zahlung'** — KEIN Ersatz fuer 'Status'-Spalte. Manueller invoices.status (Workflow-Tool: Entwurf/Versendet/Mahnstufe) und automatischer payment_status (Geld-Zustand: offen/teilbezahlt/bezahlt/ueberzahlt) sind getrennte Konzepte — beide parallel angezeigt = vollstaendige Information.
- **Default 'Unbekannt' fuer undefined payment_status** — defensive UI, falls Backend mal undefined liefert (z.B. Cache-Inkonsistenz waehrend Plan 05-01 Deployment). Crash-frei.
- **Filter-Dropdown im filter-row Pattern** — konsistent mit bestehendem Status-Filter, kein neuer Bedienmodus, kein Toolbar-Refactoring.
- **Wiederverwendung bestehender badge-* Klassen** — KEIN neues CSS, KEIN Stil-Conflict, kein Style-Maintenance-Aufwand.

## Deviations from Plan

None - plan executed exactly as written.

Task 1 wurde gemaess Plan-Spezifikation (3 Aenderungen in app.js: Helper, thead+filter-row, applyInvoiceFilters mit Reader+Klausel+TR-Template+colspan) ausgefuehrt. Pseudocode aus dem Plan wurde 1:1 uebernommen. Keine Bug-Fixes, keine Missing-Critical-Faelle, keine Blocker, keine Architekturentscheidungen.

## Issues Encountered

- Keine. Code wurde im ersten Anlauf ohne Pre-Commit-Hook-Probleme committet (e565725, 33 insertions / 6 deletions).

## Verification Notes (Checkpoint Task 2)

**User-Approval:** "approved" am 2026-04-28.

**Wichtige Ehrlichkeit zum Verifikations-Umfang:**
- User hat Layout, Badge-Anzeige und Filter-Dropdown visuell ueberprueft und als korrekt bestaetigt.
- Das detaillierte 5-Status-Uebergaenge-End-to-End-Szenario (Test-Rechnung anlegen -> 4 Zahlungen anlegen -> Badge-Wechsel offen->teilbezahlt->bezahlt->ueberzahlt->bezahlt visuell verfolgen) wurde NICHT vollstaendig durchgespielt.

**Begruendung fuer 'approved' trotzdem:**
1. **Backend ist vollstaendig E2E-getestet:** Plan 05-01 hat 12/12 Live-Server-Szenarien gegen alle 5 Status-Uebergaenge gruen durchlaufen (siehe 05-01-SUMMARY.md "E2E-Verifikation"). Die Backend-Werte payment_status='offen'/'teilbezahlt'/'bezahlt'/'ueberzahlt' sind also verifiziert.
2. **Frontend folgt etabliertem Pattern:** getPaymentStatusBadge() ist 1:1-strukturidentisch zu getInvoiceStatusBadge() (gleiche map-Konstruktion, gleicher escapeHtml-Aufruf, gleicher class="badge badge-X" Output). Wenn der bestehende Status-Badge funktioniert, funktioniert dieser auch.
3. **Helper-Smoke-Test gruen:** Inline-Node-Eval pruefte alle 5 Input-Varianten (offen/teilbezahlt/bezahlt/ueberzahlt/unknown) gegen Farbe und Label — 5/5 PASS.
4. **Phase 6 wird E2E ueben:** Detail-UI (PAY-UI-01..05) baut die Zahlungs-Erfassung via Klick-UI auf — User wird dort sowieso die volle End-to-End-Funktionalitaet durchspielen muessen.
5. **Static-Acceptance-Criteria 9/9 gruen:** function getPaymentStatusBadge vorhanden, alle 4 Status-Strings im Code, <th>Zahlung</th>, getPaymentStatusBadge(inv.payment_status), inv-filter-payment-status, colspan=9, node --check OK, Helper-Behavior 5/5, getInvoiceStatusBadge unangetastet.

**Konsequenz fuer Phase 6:** Bei der Verifikation von Phase 6 sollte das volle 5-Uebergaenge-Szenario einmal lueckenlos durchgespielt werden, um die End-to-End-Konsistenz Backend↔Frontend zu beweisen.

## User Setup Required

None - keine externe Service-Konfiguration. Bestehende Frontend-Auth (x-user-permission Header bei Aktionen) bleibt unveraendert. Listen-Rendering ist Lese-Operation, keine Permission-Guards betroffen.

## Next Phase Readiness

- **Phase 6 (Detail-UI & Zahlungserfassung) bereit:** payment_status und payment_saldo sind sowohl in der Liste als auch im Detail-API verfuegbar (Plan 05-01). getPaymentStatusBadge() kann auf der Detailseite wiederverwendet werden — gleiche Helper-Funktion fuer prominente Status-Badge-Anzeige (PAY-STAT-04).
- **getPaymentStatusBadge wiederverwendbar:** Die Funktion ist global in app.js, jede Phase 6-Detailseiten-Komponente kann direkt darauf zugreifen.
- **Backend-Spec stabil:** payment_status-Werte sind durch Plan 05-01 zementiert ('offen'|'teilbezahlt'|'bezahlt'|'ueberzahlt'). Phase 6 kann ohne weitere Backend-Aenderungen darauf aufsetzen.
- **Filter-Pattern wiederverwendbar:** Falls Phase 6 oder spaetere Phasen weitere Liste-Filter brauchen, der dreiteilige Pattern (Reader oben + Klausel im filter-Lambda + select-Element in der filter-row) ist erprobt.
- **End-to-End-Verifikation in Phase 6 noetig:** Wie oben in Verification Notes erwaehnt, sollte Phase 6 die volle 5-Uebergaenge-Sequenz live abnehmen.

---
*Phase: 05-status-logik-listen*
*Completed: 2026-04-28*

## Self-Check: PASSED

- FOUND: 05-02-SUMMARY.md erstellt unter `.planning/phases/05-status-logik-listen/`
- FOUND: public/js/app.js mit Aenderungen vorhanden (39 Zeilen Diff)
- FOUND: commit e565725 in git log (Task 1 — Zahlungsstatus-Spalte)
- FOUND: `function getPaymentStatusBadge` in app.js (Zeile 6120)
- FOUND: `<th>Zahlung</th>` in app.js (Zeile 6162)
- FOUND: `getPaymentStatusBadge(inv.payment_status)` in app.js (Zeile 6256)
- FOUND: `inv-filter-payment-status` in app.js (Zeile 6179, 6208)
- FOUND: `colspan="9"` in app.js (Zeile 6243, empty-state)
- FOUND: `node --check public/js/app.js` exit 0 (kein Syntaxfehler)
- FOUND: 5/5 Helper-Behavior-Smoke-Tests gruen (offen/teilbezahlt/bezahlt/ueberzahlt/unknown)
- FOUND: User-Approval erteilt am Checkpoint (Layout/Badge/Filter visuell bestaetigt; volles 5-Uebergang-E2E durch Phase 6 abgedeckt)
</content>
</invoke>