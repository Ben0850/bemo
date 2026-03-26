# Phase 2: Detailseite & Formular — Research

**Researched:** 2026-03-27
**Domain:** Vanilla JS SPA full-page detail view, enriched REST endpoint, search-dropdown pickers
**Confidence:** HIGH (all findings from direct codebase inspection)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Akten-Detailseite als Vollseite (kein Modal), erreichbar per Klick aus der Akten-Liste | `navigate()` + `renderAkteDetail()` pattern fully documented; row onclick change identified at line 9676 |
| UI-02 | Kundendaten-Block mit vollständiger Kontaktanzeige (Name, Telefon, E-Mail) | Enriched `GET /api/akten/:id` joins `customers` table; fallback to `a.kunde` text for legacy records |
| UI-03 | Unfalldaten-Block (Unfalldatum, Unfallort, Polizei vor Ort Ja/Nein) | Columns `unfalldatum`, `unfallort`, `polizei_vor_ort` confirmed in db.js; column names verified in Phase 1 |
| UI-04 | Mietvorgang-Block (Mietbeginn, Mietende, Fahrzeug Kennzeichen + Bezeichnung, Mietdauer in Tagen) | `GET /api/rentals` already JOINs `fleet_vehicles`; enriched endpoint adds rental sub-query |
| UI-05 | Mietart-Anzeige (Reparaturmiete / Totalschadenmiete) und Wiedervorlagedatum | Columns `mietart`, `wiedervorlage_datum` confirmed in db.js Phase 1 |
| UI-06 | Vermittler-Daten-Block | `fetchStammdatenById('/api/vermittler/:id')` helper needed; null → "Nicht verknüpft" badge |
| UI-07 | Versicherungs-Daten-Block | `fetchStammdatenById('/api/insurances/:id')` helper needed; null → "Nicht verknüpft" badge |
| UI-08 | Akten-Formular mit Dropdown/Suche für Kunde, Vermittler, Versicherung (statt Freitext) | search-dropdown pattern from invoice/credit pickers; parallel load of all picker data |
| UI-09 | Mietvorgang aus Vermietkalender verknüpfen (Auswahl bestehender Mietvorgänge) | `GET /api/rentals` returns id, license_plate, manufacturer, model, start_date, end_date, customer_name |
</phase_requirements>

---

## Summary

Phase 2 is entirely frontend + one backend endpoint upgrade. Phase 1 already delivered every schema column Phase 2 needs. No new db.js work is required.

The implementation follows one canonical pattern used by three existing pages (`renderCustomerDetail`, `renderInvoiceDetail`, `renderFuhrparkDetail`): a row click calls `navigate('akte-detail', id)`, the render function makes one API call, the backend assembles an enriched JSON object, and the function writes the full page via `main.innerHTML`. No architectural exceptions are needed.

The form upgrade uses the established `search-dropdown` + `search-selected` CSS pattern already used in the invoice and credit-note customer pickers. The same pattern works for Vermittler and Versicherung (both come from Stammdaten proxy endpoints that already exist). For the Mietvorgang picker, the `GET /api/rentals` endpoint already returns joined vehicle data and is suitable for a simple `<select>` with a search-filter input.

**Primary recommendation:** Replace `GET /api/akten/:id` with an async enriched handler, add `fetchStammdatenById()` helper, implement `renderAkteDetail()` following the customer-detail template, and upgrade `openAkteForm()` with four search-dropdown pickers.

---

## Standard Stack

No new libraries. Everything uses what is already in the project.

### Core (already present)

| Component | Location | Purpose | Note |
|-----------|----------|---------|------|
| `navigate(page, data)` | app.js line 159 | SPA routing | Add `case 'akte-detail'` |
| `main.innerHTML` rendering | app.js pattern | Full-page render | No virtual DOM |
| `api(url, opts)` | app.js utility | Fetch wrapper | Returns parsed JSON, throws on error |
| `openModal(title, body)` | app.js utility | Modal container | Still used for edit form |
| `escapeHtml(str)` | app.js utility | XSS prevention | Required for every interpolated value |
| `formatDate(str)` | app.js line 216 | DE date formatting (dd.mm.yyyy) | Use for all date display |
| `.search-dropdown` + `.search-dropdown-item` | style.css line 1488 | Typeahead dropdown shell | Already styled |
| `.search-selected` | style.css line 1518 | Selected-entity chip | Already styled |
| `.back-link` | style.css line 1208 | Navigation link above page header | Already styled |
| `.customer-info-grid` / `.info-item` / `.info-label` / `.info-value` | style.css line 1185 | Key-value grid layout | Use for all detail blocks |
| `http` / `https` (Node built-in) | server.js line 2777 | Already required for proxy | Reuse for internal fetch helper |

### Installation

None required.

---

## Architecture Patterns

### Recommended Project Structure (no changes)

The project is a single-file SPA. All new functions go into `public/js/app.js` in the Akten section (~line 9544). New server code goes in `server.js` in the Akten section (~line 2647).

### Pattern 1: Full-Page Detail View via navigate()

**What:** `navigate('akte-detail', id)` → `renderAkteDetail(id)` → one `api()` call → `main.innerHTML = ...`

**When to use:** All entity detail pages in this codebase.

**Navigate dispatch (app.js line 184 switch statement):**
```javascript
// Add after case 'akten':
case 'akte-detail': renderAkteDetail(data); break;
```

**Global state variable (near app.js line 17):**
```javascript
let currentAkteId = null;
```

**Render function skeleton:**
```javascript
async function renderAkteDetail(id) {
  const main = document.getElementById('main-content');
  currentAkteId = id;
  try {
    const a = await api(`/api/akten/${id}`);
    main.innerHTML = `
      <a class="back-link" onclick="navigate('akten')">&larr; Zurück zur Aktenliste</a>
      <div class="page-header">
        <h2>Akte ${escapeHtml(a.aktennummer || '#' + a.id)}</h2>
        <div>
          ${(isAdmin() || isVerwaltung() || isBuchhaltung())
            ? `<button class="btn btn-primary" onclick="openAkteForm(${id})">Bearbeiten</button>` : ''}
        </div>
      </div>
      <!-- six content blocks follow -->
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler beim Laden: ${escapeHtml(err.message)}</p></div>`;
  }
}
```

**Note on edit button permission:** The existing `openAkteForm()` guard (server-side) allows Admin + Verwaltung + Buchhaltung. The detail page edit button should match: show for `isAdmin() || isVerwaltung() || isBuchhaltung()`. The current list page only shows it for `isAdmin()` — this may be an existing inconsistency to preserve as-is or fix, but the detail page button should be consistent with the server guard.

### Pattern 2: Enriched GET /api/akten/:id

**What:** Replace the existing synchronous no-join handler at server.js line 2661 with an async handler that assembles all related data before responding.

**Current handler (server.js line 2661-2665) — synchronous, no enrichment:**
```javascript
app.get('/api/akten/:id', (req, res) => {
  const row = queryOne('SELECT * FROM akten WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});
```

**Replacement (async enriched):**
```javascript
app.get('/api/akten/:id', async (req, res) => {
  const row = queryOne('SELECT * FROM akten WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Local FK joins (synchronous, in-memory SQLite)
  if (row.customer_id) {
    row.customer = queryOne(
      'SELECT id, first_name, last_name, phone, email, company_name, customer_type FROM customers WHERE id = ?',
      [row.customer_id]
    ) || null;
  }
  if (row.rental_id) {
    row.rental = queryOne(
      `SELECT r.id, r.start_date, r.end_date, fv.license_plate, fv.manufacturer, fv.model
       FROM rentals r
       JOIN fleet_vehicles fv ON r.vehicle_id = fv.id
       WHERE r.id = ?`,
      [row.rental_id]
    ) || null;
  }

  // External Stammdaten (parallel, non-blocking)
  const [vermittlerData, versicherungData] = await Promise.all([
    row.vermittler_id ? fetchStammdatenById(`/api/vermittler/${row.vermittler_id}`) : Promise.resolve(null),
    row.versicherung_id ? fetchStammdatenById(`/api/insurances/${row.versicherung_id}`) : Promise.resolve(null)
  ]);
  row.vermittler_obj = vermittlerData;
  row.versicherung_obj = versicherungData;

  res.json(row);
});
```

**Important:** The column names from Phase 1 are `unfalldatum`, `unfallort`, `polizei_vor_ort`, `wiedervorlage_datum` (verified in db.js lines 489-493 and server.js lines 2680-2688). The ARCHITECTURE.md research doc uses different casing (`unfallDatum`, `unfallOrt`, `polizei`) in its JSON example — those were design proposals, not what Phase 1 actually delivered. Use the actual db column names when referencing `row.*` fields in the frontend.

### Pattern 3: fetchStammdatenById() Helper

**What:** New private async function for server-side Stammdaten sub-requests. Must be placed before the Akten endpoint block in server.js (near line 2647).

**Why needed:** The existing `proxyStammdatenRequest()` (line 2780) writes directly to an Express `res` object and cannot return a value for internal use.

```javascript
// Place above app.get('/api/akten/:id') in server.js
async function fetchStammdatenById(urlPath) {
  return new Promise((resolve) => {
    const fullUrl = `${STAMMDATEN_API_URL}${urlPath}`;
    const proto = fullUrl.startsWith('https') ? https : http;
    let data = '';
    const req = proto.get(fullUrl, (proxyRes) => {
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
  });
}
```

**Note:** `STAMMDATEN_API_URL`, `http`, and `https` are already declared at line 2776-2778. The helper must be placed after those declarations or the variables won't be in scope. The safe placement is directly above the `app.get('/api/akten/:id')` handler, which is after line 2778.

### Pattern 4: Block Layout in Detail Page

**What:** Each data section uses a `<div class="card">` with a `card-header` and either `.customer-info-grid` (for key-value grids) or the Vermittler modal block style (`background:var(--bg)` sub-sections).

**Template (from renderCustomerDetail, app.js line 1079):**
```javascript
// Key-value grid block
`<div class="card">
  <div class="card-header"><h3>Kundendaten</h3></div>
  <div class="customer-info-grid">
    <div class="info-item">
      <div class="info-label">Telefon</div>
      <div class="info-value">
        ${a.customer.phone
          ? `<a href="tel:${escapeHtml(a.customer.phone)}">${escapeHtml(a.customer.phone)}</a>`
          : '-'}
      </div>
    </div>
    <!-- more info-items -->
  </div>
</div>`
```

**Template (Vermittler-style, app.js line 9417):**
```javascript
// Section block with var(--bg) background
`<div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px;">
  <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Reparaturdaten</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">
    ${cell('Straße', fmt(v.strasse))}
  </div>
</div>`
```

**Recommendation:** Use `.customer-info-grid` + `.info-item` for the main detail blocks (Kerndaten, Unfalldaten, Kundendaten, Mietvorgang) — these are proper CSS classes. Use the inline `var(--bg)` sub-section style for the Vermittler and Versicherungs blocks to visually separate them, matching the existing Vermittler modal.

### Pattern 5: "Nicht verknüpft" Badge for Null FK Records

**What:** When a FK is null, show a graceful fallback rather than an empty block or an error.

```javascript
// Kundendaten block
const customerHtml = a.customer
  ? `<div class="info-item">
       <div class="info-label">Name</div>
       <div class="info-value">${escapeHtml(a.customer.first_name)} ${escapeHtml(a.customer.last_name)}</div>
     </div>`
  : a.kunde && a.kunde.trim()
    ? `<div class="info-item">
         <div class="info-label">Kunde (Altdaten)</div>
         <div class="info-value">${escapeHtml(a.kunde)} <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;">nicht verknüpft</span></div>
       </div>`
    : `<div class="info-item"><div class="info-value" style="color:var(--text-muted);">Kein Kunde hinterlegt</div></div>`;

// Mietart: limited known values
const MIETART_OPTIONS = ['Reparaturmiete', 'Totalschadenmiete'];
```

### Pattern 6: search-dropdown Picker (Customer, Vermittler, Versicherung)

**What:** Type-ahead input with absolute-positioned dropdown. Three existing implementations: `searchInvoiceCustomer()` (line 5485), `searchCreditCustomer()` (line 6027), `searchFleetCustomer()` (line ~6940).

**Structure (from openNewInvoiceModal, line 5444):**
```javascript
// In the form HTML:
`<div class="form-group" style="position:relative;">
  <label>Kunde suchen</label>
  <input type="text" id="akte-customer-search"
    placeholder="Name oder Firma eingeben..."
    oninput="searchAkteCustomer()" autocomplete="off">
  <div class="search-dropdown" id="akte-customer-dropdown"></div>
</div>
<div id="akte-customer-selected" style="display:none;margin-bottom:16px;"></div>
<input type="hidden" id="akte-customer-id" value="${a.customer_id || ''}">`
```

**Search function (matches invoice/credit pattern exactly):**
```javascript
async function searchAkteCustomer() {
  const term = document.getElementById('akte-customer-search').value.trim();
  const dropdown = document.getElementById('akte-customer-dropdown');
  if (term.length < 2) { dropdown.style.display = 'none'; return; }
  try {
    const customers = await api(`/api/customers?search=${encodeURIComponent(term)}`);
    dropdown.innerHTML = customers.length === 0
      ? '<div class="search-dropdown-item" style="color:var(--text-muted);">Keine Kunden gefunden</div>'
      : customers.slice(0, 10).map(c => {
          const name = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt')
            ? c.company_name
            : `${c.last_name}, ${c.first_name}`;
          const sub = c.city ? ` — ${c.city}` : '';
          return `<div class="search-dropdown-item"
            onclick="selectAkteCustomer(${c.id}, '${escapeHtml(name + sub)}')"
          >${escapeHtml(name + sub)}</div>`;
        }).join('');
    dropdown.style.display = 'block';
  } catch { dropdown.style.display = 'none'; }
}
```

**Select function:**
```javascript
function selectAkteCustomer(id, displayName) {
  document.getElementById('akte-customer-id').value = id;
  document.getElementById('akte-customer-dropdown').style.display = 'none';
  document.getElementById('akte-customer-search').style.display = 'none';
  document.getElementById('akte-customer-selected').style.display = '';
  document.getElementById('akte-customer-selected').innerHTML = `
    <div class="search-selected">
      <span>${escapeHtml(displayName)}</span>
      <button class="btn btn-sm btn-secondary" type="button" onclick="clearAkteCustomer()">Ändern</button>
    </div>`;
}
```

**For Vermittler and Versicherung:** Same pattern, but source list is loaded once at form open (not searched live) because there are far fewer records than customers. Build a `<select>` populated from `api('/api/vermittler')` and `api('/api/insurances')` arrays, or use the same search-dropdown against `/api/vermittler?search=...` if the Stammdaten service supports that query param. Given the Stammdaten proxy passes through all query params, a live-search approach works if the service supports it — or load-and-filter client-side.

**Simplest reliable approach for Vermittler/Versicherung:** Load all records at form open (both lists are typically < 200 items), then use a filterable `<select>` or a client-side search-dropdown backed by the pre-loaded array. No extra API calls during typing.

### Pattern 7: Mietvorgang Picker (rental_id)

**What:** `GET /api/rentals` returns id, vehicle_id, license_plate, manufacturer, model, customer_name, start_date, end_date. Build a `<select>` populated from this list.

**API response shape (server.js line 2118):**
```json
{
  "id": 12,
  "vehicle_id": 3,
  "license_plate": "AC-BM-100",
  "manufacturer": "VW",
  "model": "Passat",
  "customer_name": "Mustermann",
  "start_date": "2026-01-15",
  "end_date": "2026-02-12"
}
```

**Form element:**
```javascript
`<div class="form-group">
  <label>Mietvorgang</label>
  <select id="akte-rental-id">
    <option value="">— kein Mietvorgang —</option>
    ${rentals.map(r => `
      <option value="${r.id}" ${a.rental_id === r.id ? 'selected' : ''}>
        ${escapeHtml(r.license_plate)} ${escapeHtml(r.manufacturer)} ${escapeHtml(r.model)}
        · ${formatDate(r.start_date)}–${formatDate(r.end_date)}
        ${r.customer_name ? '· ' + escapeHtml(r.customer_name) : ''}
      </option>`).join('')}
  </select>
</div>`
```

Note: If there are many rentals, adding a search input above the select to filter it client-side improves usability but is not required for v1.0.

### Pattern 8: saveAkte() — Extended Request Body

```javascript
async function saveAkte(e, editId) {
  e.preventDefault();
  const data = {
    aktennummer: document.getElementById('akte-nummer').value,
    datum: document.getElementById('akte-datum').value,
    zahlungsstatus: document.getElementById('akte-zahlungsstatus').value,
    status: document.getElementById('akte-status').value,
    notizen: document.getElementById('akte-notizen').value,
    anwalt: document.getElementById('akte-anwalt').value,
    vorlage: document.getElementById('akte-vorlage').value,
    // Legacy text fields — still saved for backwards compat
    kunde: document.getElementById('akte-kunde-text')?.value || '',
    vermittler: document.getElementById('akte-vermittler-text')?.value || '',
    // FK fields
    customer_id: Number(document.getElementById('akte-customer-id').value) || null,
    vermittler_id: Number(document.getElementById('akte-vermittler-id').value) || null,
    versicherung_id: Number(document.getElementById('akte-versicherung-id').value) || null,
    rental_id: Number(document.getElementById('akte-rental-id').value) || null,
    // Unfall fields
    unfalldatum: document.getElementById('akte-unfalldatum').value,
    unfallort: document.getElementById('akte-unfallort').value,
    polizei_vor_ort: document.getElementById('akte-polizei').checked ? 1 : 0,
    // Miet fields
    mietart: document.getElementById('akte-mietart').value,
    wiedervorlage_datum: document.getElementById('akte-wiedervorlage-datum').value
  };
  // ... rest of save logic unchanged
}
```

### Pattern 9: List Row Click Change

**Current (app.js line 9676):**
```javascript
onclick="openAkteDetail(${a.id})"
```

**Change to:**
```javascript
onclick="navigate('akte-detail', ${a.id})"
```

The action column buttons already use `event.stopPropagation()` to prevent the row click from firing when clicking Bearbeiten/Löschen — no change needed there.

### Anti-Patterns to Avoid

- **Multiple frontend API calls for detail page:** Do not fetch customer, rental, Vermittler, Versicherung separately from the frontend. One call to `/api/akten/:id` returns everything. Consistent with all other detail pages.
- **Reusing proxyStammdatenRequest() for internal calls:** It writes to `res` directly and cannot return a value. Use the new `fetchStammdatenById()` helper.
- **FK REFERENCES in new column additions:** Not applicable in Phase 2 (no new columns needed). Phase 1 already added all columns.
- **Separate HTML page for detail view:** Breaks SPA session model. Stay within `#main-content` pattern.
- **Dropping the legacy `kunde`/`vermittler` TEXT fields:** They contain live data for pre-Phase-1 records. Never remove them; display with "nicht verknüpft" badge as fallback.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type-ahead search UI | Custom dropdown component | `.search-dropdown` + `.search-dropdown-item` CSS classes already in style.css | Exact same pattern used in invoices, credit notes, fleet rental |
| Key-value display layout | Custom grid CSS | `.customer-info-grid`, `.info-item`, `.info-label`, `.info-value` | Already defined in style.css line 1185 |
| Back navigation link | Custom styled anchor | `.back-link` CSS class | Already defined in style.css line 1208 |
| Internal HTTP call to Stammdaten | Inline http.request in endpoint | `fetchStammdatenById(path)` helper | Reusable, returns null on error, handles both http/https |
| Date formatting | Manual `.split('-').reverse().join('.')` | `formatDate(dateStr)` (app.js line 216) | Already handles ISO and datetime strings |
| Mietdauer calculation | Manual date math | JS `Date` diff: `Math.round((new Date(end) - new Date(start)) / 86400000)` | One-liner, no library needed |

---

## Common Pitfalls

### Pitfall 1: Column Name Mismatch (Phase 1 actual vs. ARCHITECTURE.md proposal)

**What goes wrong:** ARCHITECTURE.md (pre-Phase-1 research doc) used proposed column names like `unfallDatum`, `unfallOrt`, `polizei` in its JSON examples. Phase 1 actually used `unfalldatum`, `unfallort`, `polizei_vor_ort`, `wiedervorlage_datum` (snake_case, matching db.js lines 489-493 and server.js line 2704-2709 TRACKED_FIELDS).

**How to avoid:** Always use `row.unfalldatum`, `row.unfallort`, `row.polizei_vor_ort`, `row.wiedervorlage_datum` in both the backend enrichment handler and the frontend render function.

**Verified column names (db.js lines 489-493, server.js TRACKED_FIELDS):**
- `unfalldatum` (TEXT)
- `unfallort` (TEXT)
- `polizei_vor_ort` (INTEGER, 0/1)
- `mietart` (TEXT)
- `wiedervorlage_datum` (TEXT)
- `customer_id`, `vermittler_id`, `versicherung_id`, `rental_id` (INTEGER, nullable)

### Pitfall 2: fetchStammdatenById Placement in server.js

**What goes wrong:** Placing `fetchStammdatenById()` before line 2776-2778 where `STAMMDATEN_API_URL`, `http`, and `https` are declared causes a ReferenceError at runtime (function hoisting doesn't help with `const` variables).

**How to avoid:** Place `fetchStammdatenById()` after line 2778 (`const https = require('https');`) and before `app.get('/api/akten/:id')` at line 2661. Concretely: insert it between the Akten endpoint block and the Stammdaten proxy block, or inline just before the enriched GET handler uses it. Best placement: right above `app.get('/api/akten/:id')` after moving it past the `const http/https` declarations.

**Current code order in server.js:**
```
line 2647: // ===== Akten =====
line 2648: app.get('/api/akten', ...)
line 2661: app.get('/api/akten/:id', ...)   ← replace this
line 2667: app.post('/api/akten', ...)
line 2693: app.put('/api/akten/:id', ...)
line 2763: app.delete('/api/akten/:id', ...)
line 2775: // ===== Stammdaten Proxy =====
line 2776: const STAMMDATEN_API_URL = ...
line 2777: const http = require('http');
line 2778: const https = require('https');
line 2780: function proxyStammdatenRequest(req, res) {...}
```

`fetchStammdatenById` must be placed at line 2779 (after the const declarations, before or after `proxyStammdatenRequest`). The async enriched `GET /api/akten/:id` handler that calls it can stay at its current position (line 2661) because `fetchStammdatenById` is a function declaration, but `STAMMDATEN_API_URL` is a `const` — the function will be called at request time, not at parse time, so the `const` will be defined by then regardless of placement. **Confirmed safe:** place `fetchStammdatenById` anywhere after line 2778 and call it from the enriched handler — the `const` will be defined by the time any request arrives.

### Pitfall 3: openAkteForm() — Form Opens Before Data Loads

**What goes wrong:** The current `openAkteForm()` opens a modal synchronously with no loading state. Extending it to `await` four parallel API calls means the modal appears blank or the function must show a loading indicator first.

**How to avoid:** Show a temporary loading state or a disabled form before awaiting the parallel `Promise.all`. Pattern from `openVermittlerForm()` (line 9453): it just `await api(...)` with a try/catch + showToast on error. Apply the same approach — show a "Laden..." modal first, then replace with the real form HTML.

### Pitfall 4: `polizei_vor_ort` Display as Boolean

**What goes wrong:** The column stores `0` or `1` (INTEGER). Displaying it directly shows "0" or "1".

**How to avoid:**
```javascript
const polizeiText = a.polizei_vor_ort
  ? '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:#d1fae5;color:#065f46;">Ja</span>'
  : '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:var(--border);color:var(--text-muted);">Nein</span>';
```
This badge pattern is already used in the Vermittler form for DEKRA/DRS (app.js line 9443).

### Pitfall 5: Stammdaten Service Unavailable During Development

**What goes wrong:** If the Stammdaten service on port 3010 is not running, `fetchStammdatenById()` resolves to `null`. The detail page must render without errors even when `vermittler_obj` and `versicherung_obj` are null.

**How to avoid:** The null-check fallback pattern handles this gracefully:
```javascript
const vermittlerHtml = a.vermittler_obj
  ? /* show contact data */
  : a.vermittler && a.vermittler.trim()
    ? /* show legacy text + badge */
    : `<span style="color:var(--text-muted);">Nicht verknüpft</span>`;
```

### Pitfall 6: renderAkten() Not Re-called After Form Save

**What goes wrong:** After saving an Akte from the detail page edit form, `closeModal(); renderAkten()` sends the user back to the list. This is the existing `saveAkte()` behavior. When a user edits from the detail page, they likely expect to return to the detail page after save.

**How to avoid:** Pass context to `saveAkte()` so it knows where to navigate after save. Simplest approach: check `currentAkteId` after save and call `renderAkteDetail(currentAkteId)` if it's set, otherwise `renderAkten()`.

---

## Code Examples

All verified from direct codebase inspection.

### Display Name for Customer

```javascript
// Source: app.js customerDisplayName() pattern used throughout
const displayName = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt')
  ? c.company_name
  : `${c.first_name} ${c.last_name}`;
```

### Mietdauer Calculation

```javascript
// Calculate rental duration in full days
function mietdauerTage(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  return Math.max(0, Math.round((end - start) / 86400000));
}
```

### Akten form parallel data load

```javascript
// Source: pattern from ARCHITECTURE.md (Section 8) — adapted to match actual API names
async function openAkteForm(editId) {
  let a = {
    aktennummer: '', datum: '', kunde: '', anwalt: '', vorlage: '',
    zahlungsstatus: 'offen', vermittler: '', status: 'offen', notizen: '',
    customer_id: null, vermittler_id: null, versicherung_id: null, rental_id: null,
    unfalldatum: '', unfallort: '', polizei_vor_ort: 0, mietart: '', wiedervorlage_datum: ''
  };
  let customers = [], vermittlerList = [], versicherungen = [], rentals = [];

  try {
    [customers, vermittlerList, versicherungen, rentals] = await Promise.all([
      api('/api/customers'),
      api('/api/vermittler'),
      api('/api/insurances'),
      api('/api/rentals')
    ]);
    if (editId) a = await api('/api/akten/' + editId);
  } catch (err) {
    showToast('Fehler beim Laden der Formulardaten', 'error');
    return;
  }
  // Build modal with picker fields
  openModal(editId ? 'Akte bearbeiten' : 'Neue Akte', `
    <form onsubmit="saveAkte(event, ${editId || 'null'})">
      ...
    </form>
  `, 'modal-wide');
}
```

### Enriched response fields used in renderAkteDetail

```javascript
// All field names verified from db.js Phase 1 migrations:
a.aktennummer      // TEXT
a.datum            // TEXT (date)
a.zahlungsstatus   // TEXT
a.status           // TEXT
a.notizen          // TEXT
a.mietart          // TEXT ('Reparaturmiete' | 'Totalschadenmiete' | '')
a.wiedervorlage_datum  // TEXT (date)
a.unfalldatum      // TEXT (date)
a.unfallort        // TEXT
a.polizei_vor_ort  // INTEGER (0 or 1)
a.kunde            // TEXT (legacy fallback)
a.vermittler       // TEXT (legacy fallback)
a.customer         // object | null (enriched from customers table)
a.rental           // object | null (enriched from rentals + fleet_vehicles JOIN)
a.vermittler_obj   // object | null (from Stammdaten service)
a.versicherung_obj // object | null (from Stammdaten service)
```

---

## State of the Art

| Old Approach | Current Approach | Since | Impact |
|--------------|-----------------|-------|--------|
| `openAkteDetail(id)` — read-only modal from cached list data | `renderAkteDetail(id)` — full page with live API fetch | Phase 2 | Shows new FK fields (customer, rental, Vermittler, Versicherung) that the list doesn't load |
| Freitext-Felder für Kunde/Vermittler | search-dropdown + FK-Speicherung + Freitext-Fallback | Phase 2 | Staff picks from real records; legacy records keep their text display |
| `GET /api/akten/:id` — synchronous, no joins | `GET /api/akten/:id` — async, enriched with all related entities | Phase 2 | One round-trip returns everything the detail page needs |

---

## Open Questions

1. **Edit button visibility on detail page — Admin only or Admin+Verwaltung+Buchhaltung?**
   - What we know: Server guards allow Admin+Verwaltung+Buchhaltung to PUT. Current list page shows edit button for Admin only. `isVerwaltung()` and `isBuchhaltung()` functions exist in app.js.
   - What's unclear: Intentional inconsistency or oversight?
   - Recommendation: Match the server guard — show for `isAdmin() || isVerwaltung() || isBuchhaltung()`. This is the safe, consistent choice.

2. **Stammdaten service endpoint paths for `/api/vermittler/:id` and `/api/insurances/:id`**
   - What we know: The proxy routes `GET /api/vermittler/:id` to `http://stammdaten-service:3010/api/vermittler/:id` (server.js line 2818). The same path format works for `fetchStammdatenById('/api/vermittler/3')`.
   - What's unclear: Whether the Stammdaten service returns a 404 with JSON or an empty body when an ID doesn't exist. `fetchStammdatenById` handles parse errors by resolving `null`, so any non-JSON 404 response is safe.
   - Recommendation: No action needed. The `resolve(null)` fallback covers all error cases.

3. **Mietvorgang picker — all rentals or only recent ones?**
   - What we know: `GET /api/rentals` returns all rentals (no pagination). If there are thousands, the `<select>` becomes unwieldy.
   - What's unclear: Current count of rental records in production.
   - Recommendation: Load all for v1.0. If the list is large, add a client-side search input above the select. Do not add server-side pagination to the rentals endpoint in this phase.

4. **After-save navigation from detail page edit**
   - What we know: `saveAkte()` currently calls `renderAkten()` after save.
   - What's unclear: Whether users expect to return to detail page or list after editing from detail.
   - Recommendation: Check `currentAkteId` in `saveAkte()` — if non-null (edit from detail page), navigate to `renderAkteDetail(currentAkteId)` after save. If null or saving a new record, navigate to `renderAkten()`.

---

## Validation Architecture

`nyquist_validation` is `true` in `.planning/config.json`. Include this section.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — no jest.config, no vitest.config, no test/ directory in codebase |
| Config file | None |
| Quick run command | Manual: verify via browser devtools + network tab |
| Full suite command | Manual: full end-to-end test in browser |

No automated test infrastructure exists in this project. All validation is manual.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Klick auf Akte-Zeile öffnet Vollseite (kein Modal), URL/state zeigt 'akte-detail' | manual | n/a | n/a |
| UI-02 | Kundendaten-Block zeigt Name, Telefon (clickable tel:), E-Mail (clickable mailto:) | manual | n/a | n/a |
| UI-03 | Unfalldaten-Block zeigt formatiertes Datum, Ort, Polizei Ja/Nein Badge | manual | n/a | n/a |
| UI-04 | Mietvorgang-Block zeigt Kennzeichen, Fahrzeugname, Mietbeginn, Mietende, Mietdauer in Tagen | manual | n/a | n/a |
| UI-05 | Mietart-Block zeigt 'Reparaturmiete'/'Totalschadenmiete', Wiedervorlagedatum formatiert | manual | n/a | n/a |
| UI-06 | Vermittler-Block zeigt Kontaktdaten ODER "nicht verknüpft"-Badge (kein JS-Fehler bei null) | manual | n/a | n/a |
| UI-07 | Versicherungs-Block zeigt Kontaktdaten ODER "nicht verknüpft"-Badge (kein JS-Fehler bei null) | manual | n/a | n/a |
| UI-08 | Formular zeigt search-dropdown für Kunde, filterbaren Select für Vermittler+Versicherung | manual | n/a | n/a |
| UI-09 | Mietvorgang-Select enthält bestehende Mietvorgänge; Auswahl wird in rental_id gespeichert | manual | n/a | n/a |

### Sampling Rate

- **Per task commit:** Load Akten detail page in browser, confirm no JS console errors
- **Per wave merge:** Full manual smoke test — open detail page, open form, save, verify data persists
- **Phase gate:** All 5 success criteria from ROADMAP.md verified manually before `/gsd:verify-work`

### Wave 0 Gaps

None — no automated test infrastructure exists and none is expected in this project. All verification is manual browser testing.

---

## Sources

### Primary (HIGH confidence)

All findings from direct codebase inspection. No inference or external sources used.

- `public/js/app.js` lines 159-213 — `navigate()` switch statement
- `public/js/app.js` lines 1060-1166 — `renderCustomerDetail()` template
- `public/js/app.js` lines 5424-5528 — invoice customer search-dropdown pattern
- `public/js/app.js` lines 5990-6059 — credit note customer search-dropdown pattern
- `public/js/app.js` lines 9402-9451 — `openVermittlerDetail()` block styling
- `public/js/app.js` lines 9544-9800 — full current Akten module
- `server.js` lines 2647-2773 — Akten CRUD endpoints
- `server.js` lines 2116-2154 — rentals endpoints (GET returns vehicle JOIN)
- `server.js` lines 2775-2821 — Stammdaten proxy pattern
- `server.js` lines 64-87 — customers endpoint with `?search=` support
- `db.js` lines 466-576 — akten table definition, Phase 1 migrations, akten_history table
- `public/css/style.css` lines 1185-1221 — `.customer-info-grid`, `.info-item`, `.back-link`
- `public/css/style.css` lines 1488-1526 — `.search-dropdown`, `.search-selected`
- `.planning/research/ARCHITECTURE.md` — pre-Phase-1 design proposals (used for structure, column names superseded by Phase 1 actuals)
- `.planning/phases/01-schema-sicherheit/01-VERIFICATION.md` — confirmed Phase 1 deliverables

### Secondary (MEDIUM confidence)

None required. All findings from direct code inspection.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries/patterns already exist in the codebase
- Architecture: HIGH — enriched endpoint pattern copied from existing `GET /api/customers/:id` and `GET /api/fleet-vehicles/:id`; picker pattern copied from invoice/credit note pickers
- Pitfalls: HIGH — identified from actual Phase 1 artifacts (column naming, placement constraints)

**Research date:** 2026-03-27
**Valid until:** Until app.js or server.js are significantly restructured (stable single-file architecture)
