# Architecture

**Analysis Date:** 2026-03-26

## Pattern Overview

**Overall:** Monolithic full-stack application with integrated frontend and backend

**Key Characteristics:**
- Single Express.js server serving REST API and static frontend
- SQLite database with sql.js (in-memory with file persistence)
- Client-side state management with vanilla JavaScript
- Permission-based access control enforced at API endpoints
- Role-based authorization (Admin, Verwaltung, Buchhaltung, Benutzer)

## Layers

**Presentation Layer:**
- Purpose: User interface for business management (customers, vehicles, time tracking, invoices)
- Location: `public/`
- Contains: HTML markup, CSS styling, JavaScript application logic
- Depends on: REST API endpoints at `/api/*`
- Used by: Browser clients (authenticated users)

**API Layer:**
- Purpose: REST endpoints for all business operations
- Location: `server.js` (primary, ~2763 lines)
- Contains: Request handlers, business logic, database operations
- Depends on: Database layer (`db.js`), external services (AWS S3, Azure MSAL, Stammdaten API)
- Used by: Frontend application, external systems

**Data Access Layer:**
- Purpose: Database initialization, schema management, query execution
- Location: `db.js` (~522 lines)
- Contains: SQLite table definitions, migrations, query helpers
- Depends on: sql.js library, filesystem
- Used by: API layer for CRUD operations

**Storage Layer:**
- Purpose: Persistent data storage and file uploads
- Database: SQLite (sql.js) - `data/bemo.db`
- File Storage: AWS S3 bucket with presigned URLs
- Caching: In-memory database (loaded from disk on startup)

## Data Flow

**User Authentication:**
1. User submits username/password via login form (`public/index.html`)
2. Frontend calls `POST /api/login` with credentials
3. Backend queries `staff` table, validates password, returns user metadata
4. Frontend stores user in session (`loggedInUser` object)
5. Subsequent requests include `X-User-Id` and `X-User-Permission` headers

**CRUD Operations (Example: Customer Management):**
1. User interacts with UI (`renderCustomers()` in `public/js/app.js`)
2. Frontend calls API: `GET /api/customers` with search/filter params
3. Backend executes SQL query with parameters, returns JSON array
4. Frontend renders results in DOM, enables edit/delete interactions
5. User submits form → Frontend calls `PUT /api/customers/:id`
6. Backend validates permissions (`X-User-Permission` header), executes UPDATE, returns success
7. Frontend updates UI or shows error toast

**File Upload & Storage:**
1. User uploads file via form
2. Frontend sends `POST /api/files/upload` with file data (base64 or multipart)
3. Backend:
   - Generates S3 bucket key with timestamp
   - Uploads to AWS S3 using signed URL
   - Returns file metadata (key, URL)
4. Frontend displays download/share links
5. Downloads use presigned URLs from S3 for secure access

**Time Tracking Flow:**
1. Staff member clicks "Zeitstempel" (time stamp) on dashboard
2. Frontend calls `POST /api/time/stamp`
3. Backend:
   - Checks if open entry exists for staff member (end_time = '')
   - If yes: closes entry (sets end_time, calculates duration)
   - If no: creates new entry (start_time = current time)
4. Frontend refreshes dashboard, shows current status

**Invoice Generation:**
1. User creates invoice via form
2. Frontend calls `POST /api/invoices` with metadata
3. Backend:
   - Creates invoice record with auto-incremented number
   - Returns invoice ID and header data
4. User adds line items via `POST /api/invoices/:id/items`
5. Backend recalculates totals (net, gross, VAT)
6. User requests PDF via `GET /api/invoices/:id/pdf`
7. Backend uses pdfkit to render invoice, returns PDF stream

## Key Abstractions

**Permission Model:**
- Location: Headers passed in all requests (`X-User-Permission`, `X-User-Id`)
- Levels: Admin (full access), Verwaltung (administration), Buchhaltung (accounting), Benutzer (user)
- Pattern: Each endpoint checks permission level before executing (lines 51-60 in `server.js`)
- Example: DELETE requests blocked unless Admin or specific exemptions

**Database Query Helpers:**
- Location: `db.js` exports `queryAll()`, `queryOne()`, `execute()`
- Pattern: Parameterized queries prevent SQL injection
- Usage: `queryAll(sql, params)` returns array; `queryOne(sql, params)` returns single row or null

**API Response Pattern:**
- Success: `{ id: number, message: string }` for mutations; data array/object for queries
- Errors: `{ error: string }` with appropriate HTTP status codes (400, 403, 404, 500)
- Example: `res.status(403).json({ error: 'Keine Berechtigung' })`

**Frontend State Management:**
- Global variables: `currentPage`, `currentCustomerId`, `loggedInUser`, `autoRefreshTimer`
- Auto-refresh: Polls `GET /api/...` every 10 seconds for dashboard/calendar/time-tracking
- Modal system: Centralized modal for forms, opens via `openModal(title, html)`

## Entry Points

**Application Startup:**
- Location: `server.js` (line 2741+)
- Process:
  1. Express app initialization with CORS and JSON middleware
  2. Database initialization: `getDb()` loads or creates SQLite database
  3. Routes registered (all endpoints defined)
  4. Server listens on PORT (default 3001)
- Environment: `NODE_ENV` (development/production), `PORT`, `HOST`

**User Session Entry:**
- Location: `public/index.html` login screen
- Triggers: Page load (checks browser session)
- Flow: User enters username → calls `doLogin()` → authenticates → shows app UI

**Frontend Page Navigation:**
- Mechanism: Sidebar links with `data-page` attributes
- Handler: `showPage(page)` in `public/js/app.js` renders page content
- Pages: dashboard, calendar, customers, vehicles, staff, invoices, time-tracking, settings, etc.

## Error Handling

**Strategy:** Explicit error checking with HTTP status codes

**Patterns:**
- Validation errors return 400 with descriptive message
- Authentication/permission errors return 401/403
- Not found errors return 404
- Conflicts/validation return 400 (e.g., duplicate customer check)
- Server errors return 500 with error message

**Examples:**
```javascript
// Validation error (server.js line 181-183)
if (type === 'Privatkunde') {
  if (!first_name || !last_name) return res.status(400).json({ error: 'Vor- und Nachname sind Pflichtfelder' });
}

// Permission error (line 268-269)
if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
```

**Frontend error handling:** `api()` function throws error on non-ok response (line 72 in `public/js/app.js`), caught by callers with try/catch

## Cross-Cutting Concerns

**Logging:**
- No structured logging framework
- Errors logged to console in development
- Timestamps available via berlinNow(), berlinToday(), berlinTime() helpers (lines 18-29 in `server.js`)

**Validation:**
- Input validation at API layer (required fields checked before INSERT/UPDATE)
- Frontend validation before submission (form field checks)
- Password validation: minimum 8 chars, uppercase, special character (line 406-411 in `server.js`)
- Duplicate checking available for customers (VIN, name) and vehicles (license plate)

**Authentication:**
- Credentials stored in `staff` table (username, password fields)
- Optional Azure MSAL integration for O365 mailbox access (`/api/o365/*` endpoints)
- Login via username + password, no session tokens (state stored in frontend localStorage)
- Password reset requires old password verification

**Authorization:**
- Permission level header (`X-User-Permission`) checked at request time
- Role-based access: Admin can modify permissions, Verwaltung can manage staff
- Calendar and time entries have special exemptions for non-admin deletion

**Data Security:**
- Settings encryption using crypto (SETTINGS_ENCRYPTION_KEY derived from env var)
- AWS S3 uploads with signed URLs (temporary access)
- CORS enabled for frontend access
- Proxy reverse pattern for Stammdaten API calls (line 2699-2740)

---

*Architecture analysis: 2026-03-26*
