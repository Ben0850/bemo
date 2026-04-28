# Deferred Items — Phase 05

## Pre-existing bug: invoice-items vat_rate=0 falls back to 0.19

**Found during:** Phase 05 Plan 01 E2E verification
**Location:** server.js POST /api/invoices/:id/items (~line 1438), PUT /api/invoice-items/:id (~line 1462)
**Code:** `const rate = Number(vat_rate) || 0.19;`
**Issue:** Body `{vat_rate:0}` is converted to 0, then `0 || 0.19` evaluates to `0.19`. So a position with vat_rate=0 is silently saved with vat_rate=0.19.
**Why deferred:** Pre-existing in invoice-items endpoints (Phase 1/2), not introduced by Phase 5 changes. Out of scope per GSD scope boundary rules.
**Recommended fix (later):** `const rate = (vat_rate === 0 || vat_rate === '0') ? 0 : (Number(vat_rate) || 0.19);` or use nullish coalescing `Number(vat_rate ?? 0.19)`.
**Impact on Phase 05 E2E:** Test amounts adjusted to use real total_gross=1190 instead of 1000. Status-logic itself is correct.
