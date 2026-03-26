# Coding Conventions

**Analysis Date:** 2026-03-26

## Naming Patterns

**Files:**
- Snake case for utility files: `import-fix.js`, `fix-dates.js`
- PascalCase not used; simple lowercase names in `public/js/app.js`, `server.js`
- Database module: `db.js`
- Configuration inline in files, not separate config files

**Functions:**
- camelCase for all function declarations: `getDb()`, `queryAll()`, `renderDashboard()`
- Async functions prefix with action verb: `async function renderCustomers()`, `async function saveCustomer()`
- Helper functions prefixed with name or underscore: `formatDate()`, `escapeHtml()`, `customerDisplayName()`
- Internal state variables use underscore prefix: `_customerData`, `_customerSort`
- Handler functions named with `on` prefix: `onsubmit="doLogin(event)"`, `onclick="openCustomerForm()"`

**Variables:**
- camelCase for all local and module variables: `currentPage`, `loggedInUser`, `autoRefreshTimer`
- Constants in UPPER_SNAKE_CASE at top of files: `STATIONS`, `VEHICLE_TYPES`, `CUSTOMER_TYPES`, `DB_PATH`
- Boolean variables prefixed with `is` or `has`: `isAdmin()`, `isVerwaltung()`, `hasVisibleChild`, `has_calendar`
- Underscore prefix for private/state variables: `_scanReturnTo`

**Database Columns:**
- snake_case in schema: `first_name`, `last_name`, `customer_id`, `permission_level`
- Timestamps use `created_at`, `updated_at` pattern

**Types:**
- No TypeScript; pure JavaScript throughout
- No explicit type annotations
- Objects use destructuring: `const { name, role, station } = req.body`
- Type implied through naming: `isActive`, `hasChildren`

## Code Style

**Formatting:**
- No formal formatter configured
- 2-space indentation (observed throughout)
- Semicolons used consistently
- Single quotes in JavaScript strings (observed in conditions)
- Double quotes in HTML strings and JSON

**Linting:**
- No ESLint configured in project root
- Package.json has no linting dependencies
- Dependencies show sql.js, PDFKit, Express, Azure MSAL, AWS SDK, sharp, cors

**Line Length:**
- Long lines common (>100 chars): see `server.js` lines 423, 437 with multi-parameter function calls
- No enforced maximum line length

## Import Organization

**Order (observed in server.js):**
1. Built-in Node modules: `const express`, `const cors`, `const path`, `const fs`, `const crypto`
2. Third-party packages: `const PDFDocument`, `const msal`, `const { S3Client }`, `const { getSignedUrl }`
3. Local modules: `const { getDb, queryAll, queryOne, execute }`

**Path Aliases:**
- Not used; all imports relative to current file or absolute `__dirname` paths
- Example: `const DB_PATH = path.join(__dirname, 'data', 'bemo.db')`

## Error Handling

**Patterns:**

1. **Fetch API errors (client):**
```javascript
const res = await fetch(url, config);
const data = await res.json();
if (!res.ok) throw new Error(data.error || 'Fehler bei der Anfrage');
return data;
```

2. **Try-catch with silent fallback (client):**
```javascript
try {
  const timeStatus = await api('/api/time/status').catch(() => ({ stamped_in: false, on_pause: false, current_entry: null }));
} catch (err) {
  main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
}
```

3. **Silent error swallowing for auto-refresh:**
```javascript
try {
  await renderDashboard();
} catch (e) { /* silent */ }
```

4. **Validation with error return (server):**
```javascript
function validatePassword(pw) {
  if (!pw || pw === '') return null;
  if (pw.length < 8) return 'Passwort muss mindestens 8 Zeichen haben';
  return null;
}
if (pwError) return res.status(400).json({ error: pwError });
```

5. **Try-catch for database migrations (server):**
```javascript
try {
  db.run('ALTER TABLE vehicles ADD COLUMN last_station TEXT DEFAULT ""');
} catch (e) { /* column already exists */ }
```

6. **Try-catch with JSON response (server):**
```javascript
try {
  const staffId = Number(req.params.id);
  // ... logic
} catch (err) {
  res.status(500).json({ error: err.message || 'Serverfehler' });
}
```

**Response pattern (server):**
- Success: `res.json({ message: 'Text', ...data })`
- Error: `res.status(code).json({ error: 'Error message' })`
- Status codes: 400 for validation, 403 for auth, 500 for server errors

**Toast notifications (client):**
```javascript
function showToast(message, type = 'success') {
  // type: 'success' | 'error' | other
}
```

## Logging

**Framework:** `console` only (no logging library)

**Patterns:**
- `console.error('Scan-Fehler:', err)` in `server.js:904` - only production error logged
- Minimal logging; most errors handled silently in client code
- No structured logging, debug levels, or log aggregation

**When to log:**
- Critical errors only: vision API failures, email failures
- Most errors displayed to user via Toast or modal instead of logged

## Comments

**When to Comment:**
- Section headers: `// ===== CUSTOMERS =====`
- Non-obvious logic: `// Build new content in detached element to avoid flicker`
- Business logic: `// DB-03: new format per PROJECT.md`
- State management: `// CAL_STATIONS removed - calendar is now staff-based`
- Workarounds: `/* column already exists */`

**Style:**
- Section headers use `// ===== SECTION NAME =====` pattern
- Inline comments use `//` with space after
- No JSDoc / TSDoc
- Comments often reference requirement codes: `// DB-03/DB-04:`, `// AUTH-02:`, `// GoBD:`

**Examples from server.js:**
```javascript
// Helper: current date/time in Europe/Berlin timezone
function berlinNow() { ... }

// Duplicate check: find customers by name (exact + similar)
app.get('/api/customers/check-duplicate', (req, res) => { ... }

// GoBD: Firmendaten-Snapshot bei Erstellung einfrieren
// AUTH-04: invoice_date und invoice_number sind nach Erstellung unveränderbar.
```

## Function Design

**Size:**
- Range: 5-80 lines typical
- Shorter functions for rendering (renderCustomers ~45 lines)
- Longer functions for complex business logic (server.js `app.get('/api/pdf/invoice'...)` ~150+ lines)

**Parameters:**
- Destructuring objects preferred: `const { name, role, station } = req.body`
- Array parameters for batch operations: `yearDays` array in `/api/staff/:id/vacation-days`
- Optional parameters with defaults: `options = {}`, `type = 'success'`

**Return Values:**
- JSON objects with `{ message, data }`
- Promise for async functions
- HTML strings for render functions
- `null` for not found, rarely empty objects `{}`
- Errors thrown rather than returned

## Module Design

**Exports (db.js):**
```javascript
module.exports = { getDb, queryAll, queryOne, execute, save };
```

**Exports (server.js):**
- Not exported; creates and runs express server
- Exports all endpoints via app.get/post/put/delete

**Barrel Files:**
- No barrel files (index.js pattern not used)
- Each file is standalone

**State Management:**
- Client: global variables at file scope (`currentPage`, `loggedInUser`, `_customerData`)
- Server: in-memory database object `db` cached from `getDb()`
- No classes, prototypes, or formal state containers

**Singletons:**
- Database: `getDb()` caches and returns same instance
- Express app: single instance in `server.js`
- HTML elements queried repeatedly from DOM

## HTML Inline Patterns

**Event handlers:**
- Inline onclick/onsubmit in HTML: `onclick="openCustomerForm()"`, `onsubmit="doLogin(event)"`
- String templates for HTML generation: `` main.innerHTML = `<div>...</div>` ``
- Direct innerHTML assignment; no templating library

**Data attributes:**
- `data-page="dashboard"` for navigation routing
- Used in queries: `document.querySelector(`.nav-link[data-page="${page}"]`)`

## Common Patterns

**Render pattern:**
1. Get DOM container: `const main = document.getElementById('main-content')`
2. Fetch data: `const data = await api('/api/...')`
3. Set innerHTML: `main.innerHTML = `<markup>`
4. Attach event listeners

**API pattern (client):**
```javascript
async function api(url, options = {}) {
  const config = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (loggedInUser) {
    config.headers['X-User-Permission'] = loggedInUser.permission_level;
    config.headers['X-User-Id'] = String(loggedInUser.id);
  }
  const res = await fetch(url, config);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler bei der Anfrage');
  return data;
}
```

**Route pattern (server):**
```javascript
app.get('/api/customers', (req, res) => {
  const { search, station } = req.query;
  // ... query building
  res.json(queryAll(sql, params));
});
```

**Modal pattern:**
```javascript
function openModal(title, bodyHtml, extraClass) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}
```

---

*Convention analysis: 2026-03-26*
