# Technology Stack

**Analysis Date:** 2026-03-26

## Languages

**Primary:**
- JavaScript (Node.js) - Server-side application logic in `server.js`
- JavaScript (Vanilla) - Client-side UI in `public/js/app.js`, no frameworks used

**Secondary:**
- SQL - Database queries via sql.js

## Runtime

**Environment:**
- Node.js 20 (Alpine Linux) - Specified in `Dockerfile` (line 2, 8)

**Package Manager:**
- npm - Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express.js 4.21.0 - REST API server framework in `server.js`
- sql.js 1.11.0 - In-memory SQLite database client in `db.js`

**PDF/Document:**
- PDFKit 0.17.2 - PDF generation for invoices/documents (imported in `server.js` line 4)

**Image Processing:**
- sharp 0.34.5 (devDependencies) - Image optimization for logos and uploads

**Security:**
- CORS 2.8.5 - Cross-Origin Resource Sharing middleware in `server.js` line 31

## Key Dependencies

**Critical:**
- `@aws-sdk/client-s3` 3.1015.0 - AWS S3 object storage client for file uploads
- `@aws-sdk/s3-request-presigner` 3.1015.0 - S3 pre-signed URL generation for direct downloads
- `@azure/msal-node` 5.1.0 - Azure AD/Office 365 authentication via MSAL

**Infrastructure:**
- crypto (Node.js built-in) - Encryption for sensitive database settings (settings table)
- fs (Node.js built-in) - File system operations for database persistence
- path (Node.js built-in) - Path utilities
- http/https (Node.js built-in) - Proxy requests to stammdaten API

## Configuration

**Environment:**
- `.env` file (present, git-ignored) contains:
  - `NODE_ENV`, `PORT`, `HOST` - App configuration
  - `DOMAIN`, `CERT_EMAIL` - Let's Encrypt SSL configuration
  - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` - Object storage
  - `STAMMDATEN_API_URL` - Internal API proxy target
- `.env.example` at project root documents required variables

**Build:**
- `Dockerfile` - Multi-stage production build with Alpine base
- `Dockerfile.dev` - Development build variant
- `docker-compose.yml` - Production orchestration
- `docker-compose.dev.yml` - Development orchestration

## Platform Requirements

**Development:**
- Node.js 20.x
- npm with package-lock.json
- Optional: Docker and Docker Compose for containerized development

**Production:**
- Docker and Docker Compose (required for deployment)
- Nginx reverse proxy with ModSecurity WAF (containerized)
- Let's Encrypt Certbot for SSL/TLS (containerized)
- Hetzner Object Storage (S3-compatible) for file uploads
- Office 365/Azure AD for email integration
- OpenAI API for document OCR (optional)

**Deployment:**
- Hosted on Hetzner Cloud (see `SETUP-HETZNER.md`)
- Watchtower container for automatic image updates
- Internal `stammdaten-api` service on port 3010 (Docker network `shared`)

## Database

**Type:** SQLite (sql.js in-memory with file persistence)

**Storage:**
- File location: `/app/data/bemo.db` (mounted as `app-data` volume)
- Initialized on first run by `db.js`
- Foreign keys enabled: `PRAGMA foreign_keys = ON`

**Tables:**
- `customers` - Customer/contact records
- `vehicles` - Vehicle information
- `appointments` - Inspection/service appointments
- `invoices` - Financial records
- `users` - Application user accounts with permission levels (Admin, Verwaltung, Buchhaltung, Benutzer)
- `settings` - Configuration key-value store with encrypted values for secrets
- `calendar_entries` - Staff scheduling
- `time_tracking` - Employee time entries

---

*Stack analysis: 2026-03-26*
