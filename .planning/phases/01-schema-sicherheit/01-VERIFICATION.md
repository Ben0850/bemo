---
phase: 01-schema-sicherheit
verified: 2026-03-27T12:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "DELETE /api/akten/:id with x-user-permission: Verwaltung"
    expected: "Per inline guard in handler: 200 OK. But global middleware at line 52-60 will return 403 first. Effective behavior: Verwaltung CANNOT delete akten. This matches DB-04 spirit but the PLAN comment 'this adds Verwaltung/Buchhaltung' is factually wrong."
    why_human: "Logic conflict between global DELETE middleware and inline guard — behavior diverges from documented intent but does not affect any PLAN truth (the only DELETE truth is 'Benutzer returns 403', which passes). A deliberate policy decision is needed: should Verwaltung/Buchhaltung be able to delete akten or not? Code currently says no."
---

# Phase 1: Schema & Sicherheit Verification Report

**Phase Goal:** Datenbank und Endpoints sind produktionssicher, bevor irgendeine UI FK-Daten speichert
**Verified:** 2026-03-27T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | akten-Tabelle enthält FK-Spalten customer_id, vermittler_id, versicherung_id, rental_id neben bestehenden TEXT-Feldern (kein Datenverlust) | VERIFIED | db.js lines 485-488: 4 ALTER TABLE try/catch blocks; table reconstruction copies all original columns via INSERT...SELECT |
| 2 | akten-Tabelle enthält Felder unfalldatum, unfallort, polizei_vor_ort, mietart, wiedervorlage_datum | VERIFIED | db.js lines 489-493: 5 ALTER TABLE try/catch blocks; all 5 fields also present in akten_new CREATE TABLE definition |
| 3 | aktennummer-Spalte hat UNIQUE-Constraint — zweiter INSERT mit gleicher Aktennummer wird abgefangen | VERIFIED | db.js line 510: `aktennummer TEXT NOT NULL DEFAULT '' UNIQUE` in akten_new; idempotency guard via PRAGMA index_list (line 497-501); DROP/RENAME completes the reconstruction |
| 4 | Jeder Schreibversuch auf POST/PUT/DELETE /api/akten von Rolle "Benutzer" wird mit HTTP 403 abgelehnt | VERIFIED | server.js: POST line 2670, PUT line 2696, DELETE line 2766 — all three handlers check `!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)` and return 403. Additionally, global DELETE middleware (line 55) blocks non-Admin deletes independently. |
| 5 | Jede PUT-Anfrage auf /api/akten/:id erzeugt einen Eintrag in akten_history mit Nutzer-ID, Zeitstempel und den geänderten Feldern | VERIFIED | server.js lines 2704-2733: TRACKED_FIELDS loop, diff with norm(), INSERT INTO akten_history with akte_id, changed_by (from x-user-id), changed_at (berlinToday+berlinTime), field_name, old_value, new_value |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `db.js` | Schema migration: 9 new columns, UNIQUE constraint, akten_history table | VERIFIED | All migration blocks present at lines 484-574; ordered correctly (ALTER TABLE -> reconstruction -> akten_history -> save()); save() at line 576 follows all migrations |
| `server.js` | Permission-guarded akten write endpoints with history tracking | VERIFIED | POST (line 2667), PUT (line 2693), DELETE (line 2763) all contain guards; PUT contains full audit trail diff logic |

**Artifact level checks:**

- **Exists:** Both files present
- **Substantive:** No stubs — all handlers contain real logic, not placeholders
- **Wired:** akten_history INSERT is inside the active PUT handler; migration runs inside getDb() which is called at server startup

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `db.js` akten migration | akten table in SQLite | Table reconstruction inside getDb() | VERIFIED | `CREATE TABLE akten_new` at line 508, `PRAGMA index_list(akten)` idempotency guard at line 497, `PRAGMA foreign_keys = OFF` at line 504 precedes `BEGIN TRANSACTION` at line 505 (correct ordering) |
| `server.js PUT /api/akten/:id` | akten_history table | execute() INSERT for each changed field | VERIFIED | `INSERT INTO akten_history` at line 2729; called inside the diff loop for each field where `oldVal !== newVal` |
| `server.js POST /api/akten` | akten table | execute() INSERT with all new columns | VERIFIED | INSERT at line 2680-2683 explicitly names customer_id, vermittler_id, versicherung_id, rental_id, unfalldatum, unfallort, polizei_vor_ort, mietart, wiedervorlage_datum — 18 columns, 18 `?` placeholders |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DB-01 | 01-01-PLAN.md | FK-Spalten customer_id, vermittler_id, versicherung_id, rental_id zur akten-Tabelle | SATISFIED | db.js lines 485-488: 4 ALTER TABLE blocks; present in reconstruction at lines 516-519 |
| DB-02 | 01-01-PLAN.md | Neue Spalten unfalldatum, unfallort, polizei_vor_ort | SATISFIED | db.js lines 489-491: 3 ALTER TABLE blocks; present in reconstruction at lines 520-522 |
| DB-03 | 01-01-PLAN.md | Neue Spalten mietart, wiedervorlage_datum | SATISFIED | db.js lines 492-493: 2 ALTER TABLE blocks; present in reconstruction at lines 523-524 |
| DB-04 | 01-01-PLAN.md | UNIQUE Constraint auf aktennummer | SATISFIED | db.js line 510: `aktennummer TEXT NOT NULL DEFAULT '' UNIQUE`; reconstruction guarded by PRAGMA index_list check |
| DB-05 | 01-01-PLAN.md + 01-02-PLAN.md | akten_history Tabelle + Audit-Trail write logic | SATISFIED | Table: db.js lines 563-574 (7 columns, 2 FK references). Write: server.js lines 2704-2733 (TRACKED_FIELDS diff loop, INSERT per changed field) |
| SEC-01 | 01-02-PLAN.md | Permission-Guards auf allen Akten-Endpoints (POST, PUT, DELETE) — nur Verwaltung/Buchhaltung/Admin dürfen schreiben | SATISFIED | server.js: POST line 2670, PUT line 2696, DELETE line 2766 all have `!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)` guard returning 403 |

**Orphaned requirements check:** REQUIREMENTS.md maps DB-01 through DB-05 and SEC-01 all to Phase 1. All 6 IDs appear in plan frontmatter. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| server.js | 2764-2768 | Inline DELETE guard comment says "this adds Verwaltung/Buchhaltung" but global middleware (line 55) will reject Verwaltung/Buchhaltung before reaching the inline guard. The inline guard is effectively dead code for those roles. | Warning | Policy ambiguity: Verwaltung/Buchhaltung CANNOT delete akten at runtime, but the code comment implies they can. Does not block any PLAN truth — the only DELETE truth is Benutzer returns 403, which is satisfied by the global middleware. |

No placeholder comments (TODO/FIXME) in the modified sections. No stub return values. No empty handlers.

---

### Human Verification Required

#### 1. DELETE permission behavior for Verwaltung/Buchhaltung

**Test:** Send `DELETE /api/akten/1` with `x-user-permission: Verwaltung`
**Expected (per handler comment):** 200 OK (allowed)
**Actual (per global middleware):** 403 "Nur Admins dürfen Einträge löschen"
**Why human:** This is a policy decision, not a code bug. The current effective behavior (only Admin can delete) may be intentional, but the inline guard comment says otherwise. The team should confirm whether Verwaltung/Buchhaltung should or should not be able to delete akten, and either update the global middleware or remove the misleading inline comment.

#### 2. akten_history rows created correctly on PUT

**Test:** PUT /api/akten/:id with two changed fields (e.g., mietart and status), check akten_history table
**Expected:** Two rows inserted — one per changed field, each with correct akte_id, changed_by (matching x-user-id header), changed_at timestamp, field_name, old_value, new_value
**Why human:** Requires a running server + live DB write + query to confirm the diff logic works correctly end-to-end with real data.

#### 3. UNIQUE constraint enforcement at DB level

**Test:** POST /api/akten with aktennummer "TEST-001", then POST again with the same aktennummer
**Expected:** Second POST returns 400 or 500 — SQLite UNIQUE violation
**Why human:** Requires a running server to confirm the constraint is live in the database (not just in migration code).

---

### Gaps Summary

No gaps. All 5 success criteria from ROADMAP.md are verified in the codebase.

The one notable finding is a **policy ambiguity** (not a gap): the global DELETE middleware at line 52-60 restricts all DELETE operations to Admin only (except /api/calendar/, /api/time/, /api/files/). The inline DELETE guard in the akten handler allows Admin + Verwaltung + Buchhaltung, but this code is unreachable for Verwaltung/Buchhaltung because the global middleware fires first and returns 403. The comment in the handler ("explicit — global middleware only allows Admin, this adds Verwaltung/Buchhaltung") is factually incorrect.

This does not cause the phase goal to fail — the PLAN's only DELETE truth is "Benutzer gets 403", which is satisfied. However, the intended intent (Verwaltung/Buchhaltung can delete) is not implemented.

---

_Verified: 2026-03-27T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
