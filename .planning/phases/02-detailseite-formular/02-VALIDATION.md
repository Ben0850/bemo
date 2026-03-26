---
phase: 2
slug: detailseite-formular
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification (no test framework in project) |
| **Config file** | none |
| **Quick run command** | `node -e "require('./server')"` (syntax check) |
| **Full suite command** | Manual browser testing of Akten detail page |
| **Estimated runtime** | ~30 seconds (manual) |

---

## Sampling Rate

- **After every task commit:** Syntax check via node require
- **After every plan wave:** Manual browser verification of affected UI
- **Before `/gsd:verify-work`:** Full manual walkthrough of all 5 success criteria
- **Max feedback latency:** 5 seconds (syntax), 60 seconds (manual)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 02-01-01 | 01 | 1 | UI-01 | manual | grep renderAkteDetail app.js | ⬜ pending |
| 02-01-02 | 01 | 1 | UI-02,03,04,05,06,07 | manual | browser check | ⬜ pending |
| 02-02-01 | 02 | 2 | UI-08 | manual | grep search-dropdown app.js | ⬜ pending |
| 02-02-02 | 02 | 2 | UI-09 | manual | browser check | ⬜ pending |

---

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements (UI changes verified via browser, API via curl).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full-page navigation | UI-01 | Requires browser DOM | Click Akte in list, verify full page loads |
| Data blocks render | UI-02-07 | Visual verification | Check all 6 data blocks visible on detail page |
| Dropdown search | UI-08 | Interactive UI | Type customer name, verify dropdown appears |
| Mietvorgang link | UI-09 | Interactive UI | Select rental in form, verify it saves and displays |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
