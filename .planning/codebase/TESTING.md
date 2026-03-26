# Testing Patterns

**Analysis Date:** 2026-03-26

## Test Framework

**Status:**
- No test framework installed or configured
- No test files (*.test.js, *.spec.js) found in codebase
- No testing dependencies in package.json
- No jest.config.js, vitest.config.js, or similar

**Current approach:**
- Manual testing only
- Development run: `npm run dev` starts server on port 3001
- No automated test suite

## Manual Testing Approach

**Development server:**
```bash
npm run dev          # Runs: node server.js
npm start            # Runs: node server.js
```

**Testing strategy (implicit):**
- Start server: `node server.js` (listens on PORT 3001 or 3000)
- Manual navigation of web UI
- API endpoints tested via curl/Postman or browser

**Environment file:**
- `.env` file present (contains configuration; not read)
- `.env.example` shows required variables
- Local SQLite database: `data/bemo.db`

## API Testing

**Manual endpoint testing patterns:**

Server exposes REST endpoints organized by domain:

**Customers API:**
```
GET /api/customers                    # List all customers
GET /api/customers?search=...         # Search customers
GET /api/customers/check-duplicate    # Find duplicate customers
GET /api/vehicles/search              # Search vehicles by plate/VIN
GET /api/vehicles/check-duplicate     # Find vehicles by VIN
POST /api/customers                   # Create customer
PUT /api/customers/:id                # Update customer
DELETE /api/customers/:id             # Delete customer
```

**Staff API:**
```
GET /api/staff                        # List staff
POST /api/staff                       # Create staff
PUT /api/staff/:id                    # Update staff
DELETE /api/staff/:id                 # Delete staff
PUT /api/staff/:id/password           # Change password
GET /api/staff/:id/vacation-days      # Get vacation days per year
PUT /api/staff/:id/vacation-days      # Update vacation days
POST /api/staff/:id/vacation-days/bonus # Add bonus vacation days
```

**Invoices API:**
```
GET /api/invoices                     # List invoices
POST /api/invoices                    # Create invoice
PUT /api/invoices/:id                 # Update invoice
DELETE /api/invoices/:id              # Delete invoice (draft only)
POST /api/invoices/:id/items          # Add invoice item
PUT /api/invoices/:id/items/:itemId   # Update invoice item
DELETE /api/invoices/:id/items/:itemId # Delete invoice item
GET /api/pdf/invoice/:id              # Generate PDF
```

**Client-side API helper (app.js):**
```javascript
async function api(url, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (loggedInUser) {
    config.headers['X-User-Permission'] = loggedInUser.permission_level || 'Benutzer';
    config.headers['X-User-Id'] = String(loggedInUser.id || '');
  }
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(url, config);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler bei der Anfrage');
  return data;
}
```

## Frontend Testing

**No framework; manual DOM testing:**

**Render functions tested by:**
- Navigating to page in UI
- Verifying HTML appears in `<div id="main-content">`
- Checking table renders with correct data
- Clicking buttons to verify onclick handlers work

**Example render function (app.js):**
```javascript
async function renderCustomers() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <h2>Kunden</h2>
      ...
    </div>
  `;
  document.querySelectorAll('#customer-search, #vehicle-search-plate, #vehicle-search-vin').forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') executeSearch(); });
  });
  loadCustomerTable('');
}
```

**Event binding patterns:**
- Inline handlers: `onclick="navigate('dashboard')"`
- EventListener attachment in render functions
- No event delegation framework

## Database Testing

**Direct SQL.js testing:**

Database module uses sql.js (SQLite in-memory):
```javascript
const initSqlJs = require('sql.js');
const SQL = await initSqlJs();
db = new SQL.Database(buffer);  // Load from file or create new
```

**Manual DB testing:**
- Import/export scripts: `import.js`, `import-fix.js`, `fix-dates.js`
- Database state checked by querying tables via app UI
- Schema validated by checking table creation in `db.js:getDb()`

**Test data:**
- Development database: `data/bemo.db` (checked into git for local development)
- Migrations run automatically on startup via try-catch blocks
- No fixtures or factory functions

## Validation Testing

**Input validation patterns (server):**

```javascript
function validatePassword(pw) {
  if (!pw || pw === '') return null;
  if (pw.length < 8) return 'Passwort muss mindestens 8 Zeichen haben';
  if (!/[A-Z]/.test(pw)) return 'Passwort muss mindestens einen Großbuchstaben enthalten';
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Passwort muss mindestens ein Sonderzeichen enthalten';
  return null;
}
```

**Usage:**
```javascript
const pwError = validatePassword(password);
if (pwError) return res.status(400).json({ error: pwError });
```

**Client-side validation:**
- HTML `required` attribute
- No JavaScript validation before submit
- Server validation enforced; errors returned as `{ error: 'message' }`

## Error Scenarios

**API error handling (client):**
```javascript
try {
  const data = await api('/api/customers');
  // ... use data
} catch (err) {
  main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
}
```

**Silent failures (auto-refresh):**
```javascript
try {
  await renderDashboard();
} catch (e) { /* silent */ }
```

**Database error handling (server):**
```javascript
try {
  db.run('ALTER TABLE vehicles ADD COLUMN last_station TEXT DEFAULT ""');
} catch (e) { /* column already exists */ }
```

## Integration Patterns

**Office 365 / Graph API:**
- Endpoint: `POST /api/office365/get-token`
- Manual testing via UI settings panel
- No automated tests for OAuth flow

**AWS S3 integration:**
- Upload endpoints at `/api/files/...`
- Pre-signed URLs generated for uploads
- No test fixtures for S3

**OpenAI Vision (vehicle document scanning):**
- Endpoint: `POST /api/scan` with base64 image
- Manual testing via scan button in UI
- Error handling: try-catch with `console.error`

## Coverage

**Current coverage:**
- Not measured or enforced
- No coverage reporting tool configured

**Testing gaps (untested areas):**

1. **PDF generation:** `app.get('/api/pdf/invoice/:id')` - 150+ lines of PDF drawing code untested
2. **Calendar sync:** Microsoft Graph integration untested
3. **Invoice numbering:** `generateInvoiceNumber()` uses format MMJJJJXXX; edge cases untested
4. **Vacation calculation:** Complex date/holiday logic untested
5. **Overtime deductions:** Calculation logic untested
6. **Permission checks:** Auth middleware tested manually only
7. **Database constraints:** Foreign key cascades untested

## Test Data Management

**Import scripts:**
```
import.js          # Import customer/vehicle data
import-fix.js      # Fix imported data
fix-dates.js       # Repair date formats
Datenimport/       # Directory with data files
```

**Pattern:**
- Manual data import from CSV/JSON
- No automated seeding
- Development database committed for consistency

## What Is Tested Manually

**Happy path scenarios:**
- Login with username/password
- Create customer (private and company)
- Add vehicle to customer
- Search customers and vehicles
- Create and edit invoices
- Generate invoice PDF
- Calendar appointments
- Vacation requests
- Time tracking clock in/out
- Mobile navigation
- Permission-based visibility

**Admin/Verwaltung features:**
- Staff management
- Settings editing
- Permission level assignment
- Delete operations (guarded by permission check)

## Recommended Testing Strategy

If tests were to be added:

**Unit tests (Jest/Vitest):**
- Password validation rules
- Date formatting utilities
- Invoice number generation
- Vacation day calculations
- Currency/amount formatting

**Integration tests:**
- Database CRUD operations
- Permission checks on routes
- API error responses
- Data validation and constraints

**E2E tests (Playwright/Cypress):**
- Login flow
- Customer creation and search
- Invoice creation and PDF generation
- Calendar and vacation workflows

---

*Testing analysis: 2026-03-26*
