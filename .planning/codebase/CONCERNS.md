# Codebase Concerns

**Analysis Date:** 2026-03-26

## Tech Debt

**Monolithic Backend Structure:**
- Issue: All API endpoints, business logic, and database access code is in a single 2763-line `server.js` file. No separation of concerns between routing, services, and data layers.
- Files: `server.js`
- Impact: Code is difficult to test, maintain, and reuse. Changes in one area risk breaking unrelated endpoints. No middleware composition for common patterns (auth checks are inline in every protected route).
- Fix approach: Extract into layers: `routes/`, `services/`, `db/` directories. Use middleware factories for repeated auth/permission patterns.

**Database Migrations as try-catch Blocks:**
- Issue: Schema migrations are scattered throughout `db.js` as try-catch blocks that silently swallow errors (line 73-380). If an ALTER TABLE fails for an unexpected reason, the app continues with a broken schema.
- Files: `db.js` lines 73-380
- Impact: Silent failures during migration could cause runtime errors later when the app assumes a column exists. No way to track migration status or rollback.
- Fix approach: Implement a proper migration system (Knex.js, db-migrate) with state tracking and validation that the expected schema exists on startup.

**Hardcoded Configuration:**
- Issue: Stations list is hardcoded in `public/js/app.js` line 2-6 (`STATIONS = ['Alsdorf', 'Baesweiler', 'Merkstein', 'Aussendienst']`). Company defaults are hardcoded in `server.js` lines 528-536. Changes require code edits.
- Files: `public/js/app.js` line 2, `server.js` lines 522-536
- Impact: Configuration changes require redeployment. No runtime configurability.
- Fix approach: Load all configuration (stations, company defaults) from database or environment at startup.

**Encryption with Hardcoded Default Key:**
- Issue: Encryption key in `server.js` line 496 defaults to `'bemo-default-key-change-in-prod'` if `SETTINGS_KEY` environment variable is not set. If forgotten in production, all sensitive data (OpenAI API keys, O365 secrets) is encrypted with a public/weak key.
- Files: `server.js` lines 495-503
- Impact: Sensitive API credentials stored in database with weak encryption. If database is leaked, all API keys are recoverable with the default key.
- Fix approach: Require `SETTINGS_KEY` environment variable on startup. Fail fast if missing. Consider moving to environment variables instead of encrypting in database.

## Known Bugs

**Password Storage in Plain Text:**
- Symptoms: User passwords stored unencrypted in `staff.password` column. Visible in database dumps, API responses, and frontend code.
- Files: `db.js` line 88, `server.js` lines 369-370, `public/js/app.js` line 2330
- Trigger: Create a new staff member or change password. Password is stored as-is in database and serialized to frontend JavaScript.
- Workaround: None. This is a fundamental design flaw.
- Fix approach: Hash passwords with bcrypt or Argon2 before storage. Never include passwords in API responses or frontend. Implement password reset tokens instead of returning passwords to UI.

**OpenAI API Key Exposure in Frontend:**
- Symptoms: At line 809-812 of `server.js`, the OpenAI API key from settings is fetched but not masked when returned to frontend. The `/api/scan` endpoint could leak the raw key if accessed without proper auth checks.
- Files: `server.js` lines 807-826
- Trigger: Call `/api/scan` endpoint and monitor network traffic or browser console.
- Workaround: Backend calls OpenAI on behalf of frontend, so key is theoretically safe. But no auth check on `/api/scan` endpoint itself.
- Fix approach: Add explicit permission check at `/api/scan` endpoint. Ensure sensitive API keys never leave the backend. Consider making all AI operations backend-only with no direct API key exposure.

**No Input Validation on Numeric Fields:**
- Symptoms: Many endpoints accept numeric values (quantity, unit_price, km_stand, etc.) but don't validate ranges or type. For example, `unit_price` can be negative (line 1212-1213 of `server.js` only does `Number(unit_price) || 0`).
- Files: `server.js` lines 1209-1216, 2070, 2088
- Impact: Invalid data can be persisted. Negative invoices, zero/negative km stands, invalid quantities create garbage data.
- Fix approach: Add validation function `validateNumeric(value, {min, max, required})` and use it on all numeric inputs before execute().

**Silent Failures in Email Notifications:**
- Symptoms: Email sending failures (O365 Graph API) are caught and reported as `emailSkipReason` but don't fail the request. User thinks vacation request was submitted but admin never receives notification (lines 1000-1033 of `server.js`).
- Files: `server.js` lines 1000-1033, 1035-1070
- Impact: Critical notifications silently fail. Admins miss vacation approvals, staff changes, etc.
- Fix approach: Return partial failure response: `{ success: true, warning: "Request created but email notification failed: ..." }` so frontend can alert user.

## Security Considerations

**Authentication Header Spoofing:**
- Risk: Permission level (`x-user-permission`) and user ID (`x-user-id`) passed as request headers. A compromised frontend or MITM can send any permission level to bypass authorization.
- Files: `server.js` lines 54-55, 267-268, 419-420 (all permission checks read from headers)
- Current mitigation: Reverse proxy (Nginx) is in place but there's no server-side session validation. If frontend is compromised or network is tapped, headers can be forged.
- Recommendations: Use server-signed session tokens (JWT with HMAC or encrypted session IDs) instead of trusting client headers. Validate token on every protected request.

**No CSRF Protection:**
- Risk: State-changing requests (POST, PUT, DELETE) have no CSRF token validation. A malicious website can make requests on behalf of logged-in users.
- Files: All POST/PUT/DELETE endpoints in `server.js`
- Current mitigation: CORS is enabled globally (`app.use(cors())` line 31) without origin restrictions.
- Recommendations: Implement CSRF token validation. Restrict CORS to specific origins only.

**S3 Secret Key Exposure:**
- Risk: S3 secret access key stored in `settings` table and encrypted with hardcoded key (line 2549). If database is leaked and encryption key is compromised, AWS credentials are exposed.
- Files: `server.js` lines 2549-2552, 638-639
- Current mitigation: Encryption is applied, but key is weak.
- Recommendations: Use AWS IAM roles (when running in AWS) instead of storing access keys. If keys must be stored, rotate them regularly and use environment variables for initial setup.

**GraphQL-like Query Injection Risk (minimal but present):**
- Risk: SQL queries use parameterized statements (good), but some complex queries in fleet vehicle endpoints build SQL strings with string interpolation for subqueries (lines 2010-2013). If a future change adds unsafe concatenation, injection is possible.
- Files: `server.js` lines 2006-2018
- Current mitigation: Subqueries are hardcoded strings, not user input, so injection is not currently possible.
- Recommendations: Audit all SQL queries for any string interpolation of user input. Document which queries are safe. Consider using an ORM to eliminate SQL string building entirely.

**No Rate Limiting:**
- Risk: No rate limiting on login endpoint (`/api/login`) or scanning endpoint (`/api/scan`). An attacker can brute-force passwords or exhaust OpenAI quota.
- Files: `server.js` lines 352-377, 807-907
- Impact: Brute-force login attacks are possible. OpenAI API costs could spike if `/api/scan` is called repeatedly by an attacker.
- Recommendations: Add rate limiting middleware (express-rate-limit) on authentication and external API endpoints.

**Unencrypted Data at Rest:**
- Risk: SQLite database (`data/bemo.db`) contains all customer data, invoices, staff records without encryption. If server disk is stolen or backup is compromised, all data is readable.
- Files: `db.js` (SQLite file storage)
- Current mitigation: Docker volume `app-data` is used but no encryption specified.
- Recommendations: Enable SQLite encryption (SQLCipher) or use full-disk encryption on the server. Implement database-level encryption for PII columns.

**API Keys in Plaintext in Database:**
- Risk: OpenAI, O365, S3 credentials stored in `settings` table. Even with encryption, if attacker gains database access, they can call these APIs on behalf of the application.
- Files: `server.js` lines 638-639, `db.js` (settings table schema)
- Current mitigation: Encryption with hardcoded key (weak).
- Recommendations: Store secrets in a secrets management system (Vault, AWS Secrets Manager) instead of database. Rotate keys on a regular schedule.

## Performance Bottlenecks

**N+1 Query Problem in Fleet Vehicles Endpoint:**
- Problem: `/api/fleet-vehicles` (line 2006-2018) uses subqueries to fetch latest km_stand, next_maintenance_date for each vehicle. With 100 vehicles, this creates 300+ subqueries in a single SQL statement. Not an N+1 but a 1+3N problem.
- Files: `server.js` lines 2006-2018
- Cause: Subqueries in SELECT clause are evaluated for every row.
- Improvement path: Fetch vehicles once, then batch-load related data (mileage, maintenance) in separate queries. Cache results for 5-10 seconds since this data doesn't change frequently.

**Full Table Scans on Every Customer Search:**
- Problem: `/api/customers` (line 64-87) with search parameter uses LIKE queries on first_name, last_name, company_name, phone, email, and subqueries on vehicle license_plate/manufacturer. No indexes on these columns means full table scan for every search.
- Files: `server.js` lines 64-87
- Cause: Large customer table (potentially thousands of rows) searched by multiple unindexed columns.
- Improvement path: Add database indexes on commonly searched columns (last_name, company_name, email). Consider full-text search (FTS5) for better performance.

**In-Memory PDF Generation:**
- Problem: PDF generation (lines 1258-1340+) creates entire PDF document in memory before sending. Large invoices with many items or large attachments will consume significant memory.
- Files: `server.js` lines 1258-1340+
- Cause: PDFDocument library holds entire document in memory until doc.end() is called.
- Improvement path: Stream PDF directly to response. For large documents, consider server-side generation job queue (Bull, RabbitMQ).

**Calendar Appointments Not Paginated:**
- Problem: `/api/calendar` (line 930-939) returns all appointments for a single day with no limit. If a station has 1000 appointments booked, all are loaded into memory and sent to frontend.
- Files: `server.js` lines 930-939
- Cause: No LIMIT clause on query.
- Improvement path: Add pagination (limit 50, offset-based) or lazy-loading on frontend.

**No Database Connection Pooling:**
- Problem: sql.js is an in-memory database. It's not a connection pool. Every request to `getDb()` returns the same in-memory database, but there's no concurrency control. Multiple requests could theoretically corrupt the database if they hit the `save()` operation (line 488-493) simultaneously.
- Files: `db.js` lines 10-26, 488-493
- Cause: sql.js is synchronous and in-memory. It's not designed for concurrent access.
- Improvement path: Migrate to a real database (PostgreSQL, MySQL) with connection pooling. If staying with SQLite, add a mutex around write operations.

## Fragile Areas

**Entire Database Model in Single File (db.js):**
- Files: `db.js`
- Why fragile: 522 lines of schema definitions, migrations, and helper functions. A single syntax error breaks the entire app. Migration errors are silently caught. If someone adds a column mid-file, all migrations after it shift positions.
- Safe modification: Use a version-controlled migration system. Don't modify the base schema file directly—add new migrations as separate numbered files.
- Test coverage: No tests for database schema. Manual testing only.

**Authorization Logic Scattered Across Routes:**
- Files: `server.js` (every protected route checks `x-user-permission` or `x-user-id` manually)
- Why fragile: 50+ locations where permission checks are inline. A typo in one check (e.g., missing the Admin check) silently allows unauthorized access. Easy to forget a permission check on a new route.
- Safe modification: Extract permission checks into middleware factories. Use decorators or middleware chains.
- Test coverage: No automated tests for auth. Must be tested manually.

**Email Sending Deeply Integrated with Business Logic:**
- Files: `server.js` lines 1000-1033 (vacation email in POST endpoint), lines 1035-1070 (vacation update email)
- Why fragile: Email sending is not separated from the core request handler. If O365 API changes or times out, the entire request hangs or fails. Frontend doesn't know whether the request succeeded or the email failed.
- Safe modification: Move email sending to async background job queue (Bull, RabbitMQ). Make vacation creation/update succeed first, then send email asynchronously.
- Test coverage: No tests for email logic. Email is live-tested against O365.

**Invoice Number Generation with Race Condition:**
- Files: `server.js` lines 1100-1116
- Why fragile: `generateInvoiceNumber()` queries for the last invoice number with a given prefix, then increments. If two requests arrive simultaneously, both read the same last number and generate duplicate invoice numbers. The UNIQUE constraint on invoice_number will reject one, causing a 500 error (line 1158-1160).
- Safe modification: Use a database trigger or sequence to auto-generate invoice numbers atomically. Or use a Mutex around the entire INSERT operation.
- Test coverage: No concurrent load tests. Bug would be caught only under high traffic.

**Frontend State Management (app.js - 10k+ lines):**
- Files: `public/js/app.js`
- Why fragile: All UI state is global (currentPage, currentCustomerId, loggedInUser, etc. lines 17-20). No state management library. Changes to state in one module can affect unexpected parts of the UI. Render functions are massive and interdependent.
- Safe modification: Implement a proper state management pattern (Redux, Zustand, or just cleaner closures). Break render functions into smaller components.
- Test coverage: No unit tests for frontend logic. All testing is manual or through browser dev tools.

**File Upload Handling with No Size Limits or Validation:**
- Files: `server.js` line 32 (express.json with 25MB limit, but no validation of file types or content)
- Why fragile: If a user uploads a 25MB image when a 2MB icon is expected, memory usage spikes. No file type validation means PDFs, executables, or malicious files could be uploaded.
- Safe modification: Add file size and type validation before processing. Use a dedicated upload library (multer) with strict options.
- Test coverage: No tests for malicious uploads.

## Scaling Limits

**SQLite Database Cannot Handle Concurrent Write:**
- Current capacity: Single server, low concurrent users (<10 simultaneous).
- Limit: SQLite uses file-level locking. Multiple writes will block each other. At 50+ concurrent users with write-heavy workloads, the database becomes the bottleneck and requests start timing out.
- Scaling path: Migrate to PostgreSQL or MySQL with connection pooling. Both scale horizontally with read replicas and sharding. Phase 1: Docker-compose file already has placeholders for multi-service setup; replace SQLite with Postgres container.

**In-Memory Database Size:**
- Current capacity: SQLite in-memory (sql.js) can handle ~50MB of data (customer records, invoices, appointments, etc.).
- Limit: For Bemo (multi-location dispatch/invoice system), archive data older than 2-3 years should be moved to cold storage. Without archiving, db size will grow unbounded.
- Scaling path: Implement data retention policy. Archive invoices >3 years old to a separate archive database or S3. Implement a nightly cleanup job.

**Frontend Bundle Size:**
- Current capacity: `public/js/app.js` is 10,034 lines (single file). Likely 300-400KB minified.
- Limit: Mobile users on slow networks will experience slow page loads. Adding more features will bloat the bundle further.
- Scaling path: Split into separate modules using ES6 imports and a bundler (Webpack, Vite). Tree-shake unused code. Lazy-load feature pages on demand.

**CPU Bound Operations (PDF Generation, Image Processing):**
- Current capacity: PDFKit is synchronous. Generating a complex invoice with multiple pages will block the entire Node.js event loop for 100-200ms. At 10 concurrent PDF requests, users see 1-2 second delays.
- Limit: No horizontal scaling without external PDF service or worker processes.
- Scaling path: Offload PDF generation to a separate service (Bull queue + worker process) or use a cloud service (AWS Lambda, Google Cloud Functions). Queue requests and notify users when PDFs are ready.

## Dependencies at Risk

**sql.js Maintenance Risk:**
- Risk: sql.js is a SQLite port to WASM. Fewer updates than native SQLite. If a critical bug is discovered in SQLite, sql.js may lag in patching.
- Impact: Security or data integrity bug could persist longer in the app than in native implementations.
- Migration plan: Plan to migrate to PostgreSQL or MySQL. sql.js was the right choice for MVP/prototype, but a production system needs a real database with proper transaction support, locking, and recovery.

**pdfkit Dependency:**
- Risk: pdfkit is not as widely used as other PDF libraries (e.g., PDFMake). Community support is smaller. Updates are infrequent.
- Impact: PDF generation bugs may take longer to fix. Compliance issues (e.g., PDF/A format for long-term archival) may not be addressed.
- Migration plan: For GoBD compliance (German tax law), consider migrating to a library that supports PDF/A or a service like Documentor or Docmosis.

**MSAL-Node Version:**
- Risk: `@azure/msal-node` is at 5.1.0 (line 13 of package.json). Azure may deprecate older MSAL versions. Code uses confidential client auth which could be deprecated in favor of managed identity.
- Impact: O365 integration may break if Azure deprecates the auth flow.
- Migration plan: Monitor Azure SDK release notes. Plan for upgrade every 12 months.

**AWS SDK Bloat:**
- Risk: Full AWS SDK is installed (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`). SDK is large and may have security vulnerabilities.
- Impact: Bundle size is larger than necessary. Vulnerabilities in other AWS services you don't use still apply to the bundle.
- Migration plan: Already modular (only importing S3), so minimal impact. But consider using alternatives like `aws4request` if S3 usage remains minimal.

## Missing Critical Features

**No Audit Log:**
- Problem: No record of who changed what and when. If an invoice amount is changed or a staff member's permissions are elevated, there's no audit trail for compliance or dispute resolution.
- Blocks: GoBD compliance for invoicing. Accountability for staff actions.
- Fix approach: Add an `audit_logs` table that records every write operation with user_id, timestamp, table, operation (INSERT/UPDATE/DELETE), and old/new values. Trigger on every modify endpoint.

**No Backup Strategy:**
- Problem: Data is persisted to `app-data` Docker volume, but no automated backups. If the volume is lost, all data is gone.
- Blocks: Data loss recovery. Disaster recovery plan.
- Fix approach: Implement nightly incremental backups to S3 or external storage. Add restore procedure to documentation.

**No Alerting / Monitoring:**
- Problem: If `/api/health` starts failing or O365 API becomes unreachable, nobody is notified. Admins only discover the issue when users report it.
- Blocks: Proactive issue detection.
- Fix approach: Add monitoring service (Prometheus + Grafana, New Relic, or DataDog). Set up alerts for failed health checks, API errors, database size, and slow queries.

**No Data Export for Compliance:**
- Problem: No easy way to export customer data (GDPR right to know) or archive data for tax compliance.
- Blocks: GDPR compliance. Tax audits.
- Fix approach: Add `/api/export/customers` endpoint that generates a CSV/JSON export of customer records and related data (vehicles, invoices).

## Test Coverage Gaps

**No Unit Tests for Backend Logic:**
- What's not tested: Invoice calculations (rounding, VAT), vacation day calculations, permission checks, password validation, invoice number generation.
- Files: `server.js` (entire file has 0 test coverage)
- Risk: Invoice calculations with off-by-one cent errors could go unnoticed. Permission logic could be silently broken.
- Priority: High

**No Integration Tests for Database:**
- What's not tested: Migration system, concurrent write handling, constraint violations, cascade deletes (e.g., deleting a staff member cascades to vacation_entries).
- Files: `db.js`, all CRUD endpoints
- Risk: Schema migrations could fail in production. Deleting a customer might orphan vehicle records if constraints are wrong.
- Priority: High

**No E2E Tests for Critical Workflows:**
- What's not tested: Login flow, invoice creation and PDF generation, vacation request submission and approval, O365 email sending.
- Files: Entire app
- Risk: UI changes could break workflows silently. A merge could remove a form field without anyone noticing.
- Priority: Medium

**No Security Tests:**
- What's not tested: Permission bypass (can a regular user access admin routes?), CSRF protection, XSS injection, SQL injection.
- Files: `server.js` (all auth checks), `public/js/app.js` (input handling)
- Risk: Security vulnerabilities go unnoticed until an audit or breach.
- Priority: High

**No Load/Performance Tests:**
- What's not tested: Response times under 100 concurrent users, database query performance, PDF generation speed, memory leaks.
- Files: All
- Risk: Scaling issues (N+1 queries, full table scans, memory bloat) are discovered too late, after complaints from users.
- Priority: Medium

---

*Concerns audit: 2026-03-26*
