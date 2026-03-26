---
phase: 1
slug: schema-sicherheit
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification (no test framework in project) |
| **Config file** | none |
| **Quick run command** | `node -e "require('./db'); console.log('DB OK')"` |
| **Full suite command** | `curl -s http://localhost:3001/api/akten | head -c 200` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick DB check
- **After every plan wave:** Verify schema + endpoint behavior
- **Before `/gsd:verify-work`:** Full manual verification of all 5 success criteria
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | DB-01 | schema | `sqlite3 check or node script` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | DB-02 | schema | `sqlite3 check or node script` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | DB-03 | schema | `sqlite3 check or node script` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | DB-04 | constraint | `INSERT duplicate test` | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 1 | DB-05 | schema | `table exists check` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | SEC-01 | endpoint | `curl with Benutzer permission` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements (schema changes verified via DB load, endpoint behavior via curl).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| akten_history records changes | DB-05 | Requires PUT request + DB query | 1. PUT /api/akten/:id with changed field 2. Query akten_history for entry |
| UNIQUE blocks duplicates | DB-04 | Requires second INSERT attempt | 1. POST /api/akten with aktennummer X 2. POST again with same X 3. Expect error |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
