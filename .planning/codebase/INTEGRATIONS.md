# External Integrations

**Analysis Date:** 2026-03-26

## APIs & External Services

**Microsoft Graph API (Office 365):**
- Email/mailbox access via Graph API
  - SDK/Client: `@azure/msal-node` 5.1.0 for authentication
  - Authentication: Service principal (tenant ID, client ID, client secret)
  - Endpoints: `https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders/*` and `/messages`
  - Implementation: `server.js` lines 681-770 (getGraphToken, graphRequest functions, /api/o365/* endpoints)

**OpenAI API (Document OCR):**
- German vehicle registration document (Zulassungsbescheinigung) text extraction
  - Model: GPT-4o with vision capability
  - API Key: `openai_api_key` from encrypted settings table
  - Endpoint: `https://api.openai.com/v1/chat/completions`
  - Implementation: `server.js` lines 809-890 (/api/ocr/vehicle-registration endpoint)
  - Purpose: Automated data extraction from scanned vehicle documents

**Stammdaten API (Internal):**
- Proxied backend API for master data
  - Base URL: `STAMMDATEN_API_URL` environment variable (default: `http://localhost:3010`)
  - Implementation: `server.js` lines 2695-2716 (proxy forwarding)
  - Network: Internal Docker network `shared`
  - Used by: Unknown external consumers, proxied through this app

## Data Storage

**Databases:**
- SQLite (sql.js)
  - File location: `/app/data/bemo.db` (persisted on disk)
  - Client: sql.js 1.11.0 (in-memory with filesystem sync)
  - Connection: Initialized in `db.js`, retrieved via `getDb()` async function
  - Schema: Created on first run with customers, vehicles, appointments, invoices, users, settings, calendar_entries, time_tracking tables

**File Storage:**
- Hetzner Object Storage (S3-compatible)
  - Provider: Hetzner Cloud (S3 alternative)
  - Endpoint: `S3_ENDPOINT` environment variable
  - Bucket: `S3_BUCKET` environment variable
  - SDK: `@aws-sdk/client-s3` 3.1015.0 and `@aws-sdk/s3-request-presigner` 3.1015.0
  - Configuration location: Settings table (encrypted fields) or environment variables
  - Operations: Upload, download via pre-signed URLs, list, delete files
  - Implementation: `server.js` lines 2540-2650
  - Access: Service credentials (access key, secret key, region)

**Caching:**
- None - No Redis, Memcached, or other caching layer detected

## Authentication & Identity

**Auth Provider:**
- Custom local authentication (username/password)
  - Implementation: `server.js` (login endpoint logic)
  - User storage: SQLite `users` table with permission levels
  - Permission levels: Admin, Verwaltung, Buchhaltung, Benutzer
  - Client-side permission checks: `public/js/app.js` lines 22-36 (isAdmin, isVerwaltung, isBuchhaltung, canEditInvoice)

**External Auth:**
- Azure AD (Office 365) integration
  - For Office 365 mailbox access only (not application login)
  - MSAL authentication: Service principal credentials
  - Stored in settings table: o365_client_id, o365_client_secret, o365_tenant_id (encrypted)
  - Configurable mailboxes: o365_send_mailbox, o365_mailboxes (newline-separated list)

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, Rollbar, etc.)

**Logs:**
- Docker container logs via docker-compose stdout
- Nginx logs: Mounted volume at `/var/log/nginx`
- ModSecurity WAF logs: Mounted volume at `/var/log/modsecurity`
- Application console.log/console.error: Visible in container logs
- Health check endpoint: `/api/health` (returns status, timestamp, environment)

## CI/CD & Deployment

**Hosting:**
- Hetzner Cloud (Docker-based)
- Deployed via custom shell script: `deploy.sh`
- Multi-container setup: Node.js app + Nginx + Certbot + Watchtower

**CI Pipeline:**
- GitHub Actions workflow in `.github/` directory
- Triggers: SSH key deployment and app service restart
- Auto-restart: Watchtower monitors `bemo-app` and `bemo-nginx` images for updates

**Container Orchestration:**
- Docker Compose (production: `docker-compose.yml`, development: `docker-compose.dev.yml`)
- Networks: `internal` (bridge), `shared` (external for stammdaten-api connection)
- Volumes: `app-data` (database persistence), `certbot-webroot`, `nginx-logs`, `waf-logs`

## SSL/TLS

**Certificate Management:**
- Let's Encrypt via Certbot container
  - Automatic renewal every 12 hours
  - Webroot validation method
  - Domain: Configurable via `DOMAIN` environment variable
  - Email: `CERT_EMAIL` for certificate notifications

**Reverse Proxy:**
- Nginx with ModSecurity WAF
  - Ports: 80 (HTTP), 443 (HTTPS)
  - SSL certificate volumes mounted read-only
  - WAF rules and logs managed separately

## Environment Configuration

**Required env vars:**
- `NODE_ENV` - Application environment (production/development)
- `PORT` - Node.js server port (default: 3001)
- `HOST` - Server bind address (default: 0.0.0.0)
- `S3_ENDPOINT` - Hetzner Object Storage endpoint URL
- `S3_BUCKET` - S3 bucket name
- `S3_ACCESS_KEY` - S3 access key
- `S3_SECRET_KEY` - S3 secret key (sensitive, encrypted in DB when persisted)
- `S3_REGION` - S3 region (e.g., nbg1 for Nuremberg)
- `DOMAIN` - Domain name for Let's Encrypt SSL
- `CERT_EMAIL` - Email for certificate renewal notifications
- `STAMMDATEN_API_URL` - URL to internal stammdaten API
- `HTTP_PORT` - Nginx HTTP port (default: 80)
- `HTTPS_PORT` - Nginx HTTPS port (default: 443)

**Secrets location:**
- `.env` file (git-ignored) for local development
- Docker environment variables for containers
- Encrypted settings in SQLite `settings` table for runtime configuration
- Sensitive keys stored encrypted: `o365_client_secret`, `openai_api_key`, `s3_secret_key` (encryption in `server.js` line 638)

## Health Checks

**Liveness:**
- HTTP GET `/api/health` - Returns `{ status: 'ok', timestamp, env }`
- Docker healthcheck: Polls every 30s, timeout 5s, fails after 3 retries
- Docker depends_on: Nginx waits for app to be healthy before starting

## Webhooks & Callbacks

**Incoming:**
- `/api/*` - Standard REST API endpoints (no webhook consumers detected)

**Outgoing:**
- Email via Graph API (sendMail endpoint) - For appointment notifications, vacation requests
- No webhooks to external services detected

---

*Integration audit: 2026-03-26*
