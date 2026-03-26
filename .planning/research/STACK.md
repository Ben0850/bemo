# Technology Stack

**Project:** Bemo Verwaltungssystem
**Researched:** 2026-03-26
**Mode:** Additive — improvements to existing stack, no rewrites

---

## Current Stack Summary

The existing production stack is:

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20 (Alpine) |
| Server | Express.js | 4.21.0 |
| Database | sql.js (SQLite WASM) | 1.11.0 |
| PDF | PDFKit | 0.17.2 |
| Storage | AWS SDK v3 / S3 | 3.1015.0 |
| Auth | Azure MSAL | 5.1.0 |
| Frontend | Vanilla JS (monolithic app.js) | — |

---

## Recommended Changes

### 1. Replace sql.js with better-sqlite3

**Recommendation:** Migrate `db.js` from sql.js to better-sqlite3 `12.8.0`.

**Why this is the highest-priority change:**

sql.js runs SQLite as WebAssembly (Emscripten). On the server-side this creates three concrete production risks:

- **Data loss on crash.** sql.js keeps the database entirely in memory and flushes to disk on demand. Every write requires serializing the entire database to disk. If the Node process crashes between writes, all in-memory changes since the last flush are lost. better-sqlite3 writes incrementally via native SQLite WAL mode — each committed transaction is durable immediately.
- **Performance.** Emscripten WASM runs at 50–60% of native performance. better-sqlite3 uses native bindings and is consistently the fastest SQLite library for Node.js.
- **API mismatch.** sql.js uses an imperative, callback-style API. better-sqlite3 is fully synchronous and substantially simpler to work with in server code.

**Confidence:** HIGH — verified via official sql.js issue tracker (GitHub issue #350) and better-sqlite3 GitHub discussions.

**Migration complexity:** MEDIUM. The API surface changes: `db.run()` becomes `db.prepare().run()`, and result iteration changes. `db.js` is the single integration point — the rest of `server.js` uses thin wrappers. Migration is a targeted rewrite of `db.js` plus search-and-replace of query call patterns.

**Alpine/Docker concern:** better-sqlite3 is a native module and requires compilation. On `node:20-alpine` (musl libc), prebuilt binaries are not available. Two options:
- Option A (preferred): Change Dockerfile base to `node:20-slim` (Debian). Slight image size increase, everything works out of the box. No build tools needed in container.
- Option B: Keep Alpine, add multi-stage build with `python3 make g++` in build stage, compile from source. More complex Dockerfile but smaller final image.

**Version:** `better-sqlite3@12.8.0` (current as of 2026-03-26, verified npm)

```bash
npm install better-sqlite3
# If staying on Alpine:
# npm install better-sqlite3 --build-from-source
```

---

### 2. Upgrade Express.js to v5

**Recommendation:** Upgrade from `express@4.21.0` to `express@5.2.1`.

**Why:**

Express 5 is stable as of October 2024. The single most valuable change for this codebase: async route handlers that throw or reject now automatically forward the error to Express error middleware. This eliminates all the manual `try/catch` + `next(err)` wrappers in `server.js`.

Express 5 also drops Node.js < 18, but the project already runs Node 20.

**Breaking changes to watch:**
- `app.del()` removed — use `app.delete()`
- `req.params` now omits unmatched parameters (previously included them as `undefined`)
- `express.urlencoded` defaults `extended: false` — verify any body parsing of nested objects
- Regex sub-expressions in routes no longer supported (not commonly used here)

**Confidence:** HIGH — verified via official Express migration guide at expressjs.com.

**Migration complexity:** LOW. The existing codebase uses standard Express patterns. Run `npm install express@5` and grep for `app.del(` — likely zero or one occurrence.

```bash
npm install express@5.2.1
```

---

### 3. Add Zod for Input Validation

**Recommendation:** Add `zod@3.25.x` (not v4 — see rationale below).

**Why:**

The current `server.js` performs little to no input validation before writing to the database. For an in-production business application managing financial records, unvalidated inputs are a reliability and security risk. Zod adds schema-based validation in a single middleware layer, producing clear error messages and preventing malformed data from reaching the database.

**Why v3, not v4:**

Zod v4 was stable-released July 2025 and is the current `zod` tag on npm. However, v4 is a breaking API change from v3. Starting with v3.25.0, the package ships both versions at subpath exports (`zod/v4`). For a new addition to an existing project, start on v3 — it is mature, battle-tested, and the migration path to v4 is explicit if needed later.

**Confidence:** HIGH — verified via Zod official docs and npm package page.

**Integration pattern:**

```javascript
// middleware/validate.js
const { z } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    req.body = result.data; // coerced and sanitized
    next();
  };
}

module.exports = validate;
```

No build step required. Works in plain JavaScript without TypeScript.

```bash
npm install zod
```

---

### 4. Upgrade PDFKit to 0.18.0

**Recommendation:** Upgrade from `pdfkit@0.17.2` to `pdfkit@0.18.0`.

**Why:**

0.18.0 is current stable (verified npm, 2026-03-26). The project already uses PDFKit for invoice PDF generation. This is a patch/minor upgrade with no architectural change — just bug fixes and improvements from the existing version.

**Do not replace PDFKit.** Alternatives (Puppeteer, pdfmake, pdf-lib) all require significant refactoring of the existing PDF generation code. PDFKit is appropriate for the document type being generated and the current code already works. The ROI on switching is negative.

**Confidence:** MEDIUM — npm package page confirms 0.18.0 as latest, no breaking change notes found (minor version bump).

```bash
npm install pdfkit@0.18.0
```

---

### 5. Add Helmet for HTTP Security Headers

**Recommendation:** Add `helmet@8.x` (current stable).

**Why:**

The current stack has CORS middleware but no HTTP security header hardening. Helmet sets headers like `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, and others with a single `app.use(helmet())` call. At ~1.8M weekly downloads, it is the standard Express security middleware. Cost: zero performance impact, one line of code.

**Confidence:** HIGH — widely documented, no version ambiguity.

```bash
npm install helmet
```

```javascript
// server.js, after express() init
const helmet = require('helmet');
app.use(helmet());
```

---

### 6. Add express-rate-limit for Auth Endpoints

**Recommendation:** Add `express-rate-limit@7.x` for login and sensitive endpoints only.

**Why:**

Login endpoints (`/api/login`, password-related routes) currently have no brute-force protection. express-rate-limit is the standard lightweight solution. Apply a strict limit (5 requests / 15 minutes) on auth endpoints; optionally a broader limit (100 requests / 15 minutes) on all API routes.

This is a single-instance deployment (one Docker container), so the built-in memory store is sufficient — no Redis required.

**Confidence:** HIGH — npm, official documentation, no edge cases for single-instance deployment.

```bash
npm install express-rate-limit
```

---

### 7. Split app.js with ES Modules (Deferred — Akten Module Trigger)

**Recommendation:** Do not split `app.js` now. Plan the split as part of the Akten module milestone.

**Why deferred:**

The existing `app.js` is described as ~10,000 lines. Splitting it mid-feature-development creates merge conflicts and breaks existing functionality without adding user value. The correct trigger is the Akten module — which is a new isolated section of UI — at which point that module can be written as a separate file loaded via native ES module `import()` or a `<script type="module">` tag.

**Pattern to adopt when the time comes:**

Native browser ES modules require no build tooling. Each module file is a plain `.js` file served statically. Dynamic `import()` enables lazy loading of modules that are not needed on page load.

```javascript
// In app.js, lazy-load the Akten module only when navigated to
async function loadAktenModule() {
  const { init } = await import('/js/modules/akten.js');
  init();
}
```

**Why not a build tool (Webpack/Vite/etc.):** The project constraint is no build tooling. Native ES modules work in all modern browsers and require zero tooling.

**Confidence:** HIGH — native browser feature, no library dependency.

---

## What NOT to Add

| Rejected | Why |
|----------|-----|
| PostgreSQL | Project constraint. SQLite is sufficient for current user count. Migration cost far exceeds benefit. |
| React / Vue / any framework | Project constraint. The existing Vanilla JS system is in production and working. |
| TypeScript | No existing type infrastructure. Adding TS to a 10k-line Vanilla JS app requires a build step and complete reannotation. ROI negative. |
| ORM (Prisma, Drizzle) | The existing code uses raw SQL via sql.js. Introducing an ORM requires rewriting all queries. better-sqlite3 supports the same raw SQL pattern — no ORM needed. |
| Puppeteer/Playwright for PDF | Heavyweight (Chromium dependency, ~200MB). PDFKit already works for invoices. Only consider if HTML-template-driven PDFs are required. |
| Node.js built-in `sqlite` module | Still experimental as of Node 22/23 (requires `--experimental-sqlite` flag). Not production-ready. Revisit when it graduates to stable. |
| Zod v4 | Breaking API change from v3. Stable since July 2025 but unnecessary churn for a new addition. Start with v3. |
| Redis | Single-instance deployment. Memory store for rate limiting is sufficient. |

---

## Recommended Installation Sequence

```bash
# 1. Security and reliability improvements (low risk, high value)
npm install helmet express-rate-limit

# 2. Input validation
npm install zod

# 3. Express upgrade (review breaking changes first)
npm install express@5.2.1

# 4. PDF upgrade (non-breaking minor bump)
npm install pdfkit@0.18.0

# 5. Database migration (highest value, requires db.js rewrite)
# First: change Dockerfile FROM node:20-alpine TO node:20-slim
npm install better-sqlite3
npm uninstall sql.js
```

---

## Version Summary

| Package | Current | Recommended | Priority | Confidence |
|---------|---------|-------------|----------|------------|
| better-sqlite3 | not installed | 12.8.0 | Critical | HIGH |
| express | 4.21.0 | 5.2.1 | High | HIGH |
| zod | not installed | 3.25.x | High | HIGH |
| pdfkit | 0.17.2 | 0.18.0 | Low | MEDIUM |
| helmet | not installed | 8.x | Medium | HIGH |
| express-rate-limit | not installed | 7.x | Medium | HIGH |
| sql.js | 1.11.0 | remove | Critical | HIGH |
| Node.js | 20 Alpine | 20 Slim (Debian) | Medium | HIGH |

---

## Sources

- [sql.js GitHub Issue #350 — advantages of sql.js over native SQLite in Node.js](https://github.com/sql-js/sql.js/issues/350)
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3)
- [better-sqlite3 Discussion #1245 — better-sqlite3 vs Node 22 core sqlite](https://github.com/WiseLibs/better-sqlite3/discussions/1245)
- [better-sqlite3 Discussion #1270 — Alpine Docker compatibility](https://github.com/WiseLibs/better-sqlite3/discussions/1270)
- [Express v5 release announcement](https://expressjs.com/2024/10/15/v5-release.html)
- [Migrating to Express 5 (official guide)](https://expressjs.com/en/guide/migrating-5.html)
- [Zod v4 release notes](https://zod.dev/v4)
- [Zod npm](https://www.npmjs.com/package/zod)
- [PDFKit npm](https://www.npmjs.com/package/pdfkit)
- [helmet GitHub](https://github.com/helmetjs/helmet)
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit)
- [Node.js built-in SQLite documentation](https://nodejs.org/api/sqlite.html)
- [Node.js 22 LTS release](https://nodejs.org/en/blog/announcements/v22-release-announce)
