# Phase 1: Schema & Sicherheit — Research

**Researched:** 2026-03-27
**Domain:** SQLite schema migration (sql.js), Express.js permission guards, GoBD audit trail
**Confidence:** HIGH — all findings from direct codebase inspection + prior planning research

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DB-01 | FK-Spalten customer_id, vermittler_id, versicherung_id, rental_id zur akten-Tabelle hinzufügen (neben bestehenden TEXT-Feldern als Fallback) | ALTER TABLE try/catch pattern confirmed; exact column names and types identified |
| DB-02 | Neue Spalten unfalldatum, unfallort, polizei_vor_ort in akten-Tabelle | Same ALTER TABLE pattern; column types (TEXT/INTEGER) determined |
| DB-03 | Neue Spalten mietart, wiedervorlage_datum in akten-Tabelle | Same ALTER TABLE pattern; mietart as TEXT, wiedervorlage as TEXT (date string) |
| DB-04 | UNIQUE Constraint auf aktennummer (keine Duplikate) | SQLite cannot ADD CONSTRAINT; requires table reconstruction — procedure documented in full |
| DB-05 | akten_history Tabelle für Audit-Trail (wer hat wann was geändert — GoBD) | CREATE TABLE IF NOT EXISTS pattern; diff strategy and field-level row design confirmed |
| SEC-01 | Permission-Guards: nur Verwaltung/Buchhaltung/Admin dürfen POST/PUT/DELETE | Exact copy-paste pattern extracted from server.js line 268; global DELETE middleware at line 52 already covers DELETE |
</phase_requirements>

---

## Summary

Phase 1 is pure backend work — no frontend changes. It has three independent work streams: (1) schema extension via `db.js` migrations, (2) a new `akten_history` audit table with write logic in the PUT handler, and (3) permission guards on all three write endpoints.

The schema work splits into two distinct migration techniques. Nine plain column additions use the standard `try/catch ALTER TABLE` pattern already present throughout `db.js`. One change — adding a UNIQUE constraint to `aktennummer` — cannot be done with ALTER TABLE in SQLite and requires full table reconstruction (CREATE new, INSERT SELECT, DROP, RENAME). The reconstruction also serves as the opportunity to produce the definitive schema with all new FK columns and proper defaults in one atomic operation.

The permission guard is a single two-line block copy-pasted identically onto POST, PUT, and DELETE. The global DELETE middleware at line 52 already blocks non-Admin deletions as a safety net, but the explicit inline check on `DELETE /api/akten/:id` is still required for clarity and to match the Benutzer-403 requirement. History write logic in the PUT handler reads the row before update, diffs it against the incoming body, and inserts one `akten_history` row per changed field using the existing `execute()` helper.

**Primary recommendation:** Do the table reconstruction first (it produces the correct final schema with all new columns), then add the history table and its write logic, then add the permission guards. Each of the three work streams is independently testable via `curl` or SQLite CLI.

---

## Standard Stack

### Core (no new dependencies)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| sql.js | 1.11.0 | SQLite WASM — all DB operations | Already in use; no migration |
| Express.js | 4.21.0 | HTTP server + route handlers | Already in use |
| Node.js | 20 (Alpine) | Runtime | Already in use |

**Zero new npm packages are needed for Phase 1.** All capability is native to the existing stack.

### DB Helpers (from db.js)

| Helper | Signature | Use in Phase 1 |
|--------|-----------|----------------|
| `execute(sql, params)` | Returns `{ lastId }`, calls `save()` | INSERT into akten_history |
| `queryOne(sql, params)` | Returns first row or null | Read row before update (diff) |
| `queryAll(sql, params)` | Returns array of rows | — |

---

## Architecture Patterns

### Existing akten table (db.js lines 467–482)

```sql
CREATE TABLE IF NOT EXISTS akten (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  aktennummer     TEXT NOT NULL DEFAULT '',
  datum           TEXT NOT NULL DEFAULT '',
  kunde           TEXT NOT NULL DEFAULT '',
  anwalt          TEXT NOT NULL DEFAULT '',
  vorlage         TEXT NOT NULL DEFAULT '',
  zahlungsstatus  TEXT NOT NULL DEFAULT 'offen',
  vermittler      TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'offen',
  notizen         TEXT NOT NULL DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Target akten table (after Phase 1 migration)

```sql
CREATE TABLE akten_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  aktennummer     TEXT NOT NULL DEFAULT '' UNIQUE,  -- DB-04: UNIQUE added here
  datum           TEXT NOT NULL DEFAULT '',
  -- Legacy TEXT fields preserved (no data loss)
  kunde           TEXT NOT NULL DEFAULT '',
  anwalt          TEXT NOT NULL DEFAULT '',
  vorlage         TEXT NOT NULL DEFAULT '',
  vermittler      TEXT NOT NULL DEFAULT '',
  -- DB-01: FK columns (additive)
  customer_id     INTEGER DEFAULT NULL,
  vermittler_id   INTEGER DEFAULT NULL,
  versicherung_id INTEGER DEFAULT NULL,
  rental_id       INTEGER DEFAULT NULL,
  -- DB-02: Unfall fields
  unfalldatum     TEXT DEFAULT '',
  unfallort       TEXT DEFAULT '',
  polizei_vor_ort INTEGER DEFAULT 0,
  -- DB-03: Miet fields
  mietart         TEXT DEFAULT '',
  wiedervorlage_datum TEXT DEFAULT '',
  -- Existing fields kept
  zahlungsstatus  TEXT NOT NULL DEFAULT 'offen',
  status          TEXT NOT NULL DEFAULT 'offen',
  notizen         TEXT NOT NULL DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  -- Note: customer_id/rental_id could have FOREIGN KEY clauses but these are
  -- optional since PRAGMA foreign_keys = ON was set before reconstruction.
  -- vermittler_id and versicherung_id reference stammdaten service (port 3010),
  -- not local tables — cannot be SQLite FKs.
)
```

### Pattern 1: ALTER TABLE try/catch (for plain new columns)

Used for every existing migration in `db.js`. The catch swallows "duplicate column name" which is the only expected error when a migration has already run.

```javascript
// Source: db.js lines 73–75, 228–229, 232–235, etc.
try { db.run("ALTER TABLE akten ADD COLUMN customer_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN vermittler_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN versicherung_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN rental_id INTEGER DEFAULT NULL"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN unfalldatum TEXT DEFAULT ''"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN unfallort TEXT DEFAULT ''"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN polizei_vor_ort INTEGER DEFAULT 0"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN mietart TEXT DEFAULT ''"); } catch(e) {}
try { db.run("ALTER TABLE akten ADD COLUMN wiedervorlage_datum TEXT DEFAULT ''"); } catch(e) {}
```

**However, the UNIQUE constraint on `aktennummer` (DB-04) cannot be added by ALTER TABLE.** These plain ALTER TABLE blocks alone are insufficient for DB-04. They must be followed by the table reconstruction procedure (Pattern 2) that includes `UNIQUE` in the CREATE TABLE statement.

### Pattern 2: Table Reconstruction for UNIQUE Constraint (DB-04)

SQLite does not support `ALTER TABLE ... ADD CONSTRAINT UNIQUE`. The only way to add a UNIQUE constraint to an existing column is to reconstruct the table. This is the same approach as adding FK constraints.

The reconstruction must be guarded by an idempotency check — check whether the UNIQUE constraint already exists before running. SQLite does not have a direct way to check named constraints, but checking for the presence of a known new column (or using `PRAGMA index_list`) works.

```javascript
// Source: .planning/research/STACK.md — verified pattern, adapted for this phase
// Place in db.js getDb(), after the existing akten CREATE TABLE block and after
// the plain ALTER TABLE blocks above.

try {
  // Idempotency guard: check if aktennummer already has UNIQUE index
  // (index will be named 'sqlite_autoindex_akten_1' or similar after reconstruction)
  const indexes = db.exec("PRAGMA index_list(akten)");
  const hasUniqueOnAktennummer = indexes.length > 0 && indexes[0].values.some(row => {
    // Check for unique index on aktennummer via index_info
    // Simpler: check for a sentinel column we add only during reconstruction
    return false; // placeholder — see idempotency approach below
  });

  // More reliable idempotency: check if wiedervorlage_datum exists (added in same op)
  // After the plain ALTER TABLE blocks above run, this column exists.
  // The reconstruction check: verify UNIQUE via a test INSERT/ROLLBACK.
  // Simplest approach: use a flag column or check PRAGMA index_list for uniqueness.

  // RECOMMENDED APPROACH: use sentinel — try inserting a duplicate aktennummer;
  // if it fails with UNIQUE constraint, reconstruction already done.
  // But even simpler: check index_list for a unique index on this table.
  const idxResult = db.exec("PRAGMA index_list(akten)");
  const uniqueExists = idxResult.length > 0 &&
    idxResult[0].values.some(row => row[2] === 1); // column 2 = 'unique' flag (0/1)

  if (!uniqueExists) {
    db.run('PRAGMA foreign_keys = OFF');
    db.run('BEGIN TRANSACTION');

    db.run(`
      CREATE TABLE akten_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        aktennummer     TEXT NOT NULL DEFAULT '' UNIQUE,
        datum           TEXT NOT NULL DEFAULT '',
        kunde           TEXT NOT NULL DEFAULT '',
        anwalt          TEXT NOT NULL DEFAULT '',
        vorlage         TEXT NOT NULL DEFAULT '',
        vermittler      TEXT NOT NULL DEFAULT '',
        customer_id     INTEGER DEFAULT NULL,
        vermittler_id   INTEGER DEFAULT NULL,
        versicherung_id INTEGER DEFAULT NULL,
        rental_id       INTEGER DEFAULT NULL,
        unfalldatum     TEXT DEFAULT '',
        unfallort       TEXT DEFAULT '',
        polizei_vor_ort INTEGER DEFAULT 0,
        mietart         TEXT DEFAULT '',
        wiedervorlage_datum TEXT DEFAULT '',
        zahlungsstatus  TEXT NOT NULL DEFAULT 'offen',
        status          TEXT NOT NULL DEFAULT 'offen',
        notizen         TEXT NOT NULL DEFAULT '',
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Copy all existing data — new columns default to NULL/''
    db.run(`
      INSERT INTO akten_new
        (id, aktennummer, datum, kunde, anwalt, vorlage, vermittler,
         zahlungsstatus, status, notizen, created_at, updated_at)
      SELECT
        id, aktennummer, datum, kunde, anwalt, vorlage, vermittler,
        zahlungsstatus, status, notizen, created_at, updated_at
      FROM akten
    `);

    db.run('DROP TABLE akten');
    db.run('ALTER TABLE akten_new RENAME TO akten');
    db.run('COMMIT');
    db.run('PRAGMA foreign_keys = ON');
    console.log('akten migration: table reconstructed with UNIQUE(aktennummer) and new columns');
  }
} catch (e) {
  try { db.run('ROLLBACK'); } catch (_) {}
  db.run('PRAGMA foreign_keys = ON');
  console.error('akten migration failed:', e.message);
}
```

**Critical ordering:** `PRAGMA foreign_keys = OFF` MUST be issued OUTSIDE any active transaction. The order is: toggle OFF → BEGIN → work → COMMIT → toggle ON.

**Duplicate aktennummer handling:** If existing data has duplicate aktennummer values, the INSERT...SELECT will fail with UNIQUE constraint violation. The catch block rolls back cleanly. Before running the reconstruction, verify with: `SELECT aktennummer, COUNT(*) FROM akten GROUP BY aktennummer HAVING COUNT(*) > 1`. If any rows are returned, duplicates must be resolved manually before reconstruction runs.

**PRAGMA index_list column layout:** The result columns are `(seq, name, unique, origin, partial)`. Column index 2 is the `unique` flag (1 = unique). This check is reliable and does not depend on the index name.

### Pattern 3: akten_history CREATE TABLE (DB-05)

```javascript
// Source: db.js CREATE TABLE IF NOT EXISTS pattern throughout file
db.run(`
  CREATE TABLE IF NOT EXISTS akten_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    akte_id     INTEGER NOT NULL,
    changed_by  INTEGER NOT NULL,
    changed_at  TEXT NOT NULL,
    field_name  TEXT NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    FOREIGN KEY (akte_id) REFERENCES akten(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES staff(id)
  )
`);
```

**Field-level diff vs JSON snapshot:**

Field-level diff (one row per changed field) is recommended over JSON snapshot. Reasons:
- Queryable: `SELECT * FROM akten_history WHERE field_name = 'zahlungsstatus'` works
- GoBD-legible: each record names the changed field and shows before/after value explicitly
- Consistent with how the pitfalls research documented this pattern (PITFALLS.md Pitfall 4)
- JSON snapshot is simpler to write but requires application-layer parsing to read history

**No DELETE endpoint for akten_history.** The table must be append-only for GoBD compliance.

### Pattern 4: History write in PUT handler (DB-05)

```javascript
// Source: server.js lines 2676-2684 — existing PUT handler to be extended
app.put('/api/akten/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const userId = Number(req.headers['x-user-id']);
  const existing = queryOne('SELECT * FROM akten WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Fields to track in history
  const TRACKED_FIELDS = [
    'aktennummer', 'datum', 'kunde', 'anwalt', 'vorlage', 'vermittler',
    'customer_id', 'vermittler_id', 'versicherung_id', 'rental_id',
    'unfalldatum', 'unfallort', 'polizei_vor_ort',
    'mietart', 'wiedervorlage_datum',
    'zahlungsstatus', 'status', 'notizen'
  ];

  const now = `${berlinToday()} ${berlinTime()}`;

  // Diff and insert history rows
  for (const field of TRACKED_FIELDS) {
    const oldVal = existing[field] !== undefined ? String(existing[field] ?? '') : '';
    const newVal = req.body[field] !== undefined ? String(req.body[field] ?? '') : oldVal;
    if (oldVal !== newVal) {
      execute(
        `INSERT INTO akten_history (akte_id, changed_by, changed_at, field_name, old_value, new_value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [Number(req.params.id), userId, now, field, oldVal, newVal]
      );
    }
  }

  // Then perform the update (extend column list for new fields)
  execute(
    `UPDATE akten SET
      aktennummer=?, datum=?, kunde=?, anwalt=?, vorlage=?, vermittler=?,
      customer_id=?, vermittler_id=?, versicherung_id=?, rental_id=?,
      unfalldatum=?, unfallort=?, polizei_vor_ort=?,
      mietart=?, wiedervorlage_datum=?,
      zahlungsstatus=?, status=?, notizen=?,
      updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [
      req.body.aktennummer || '', req.body.datum || '',
      req.body.kunde || '', req.body.anwalt || '', req.body.vorlage || '', req.body.vermittler || '',
      req.body.customer_id || null, req.body.vermittler_id || null,
      req.body.versicherung_id || null, req.body.rental_id || null,
      req.body.unfalldatum || '', req.body.unfallort || '',
      req.body.polizei_vor_ort ? 1 : 0,
      req.body.mietart || '', req.body.wiedervorlage_datum || '',
      req.body.zahlungsstatus || 'offen', req.body.status || 'offen',
      req.body.notizen || '',
      Number(req.params.id)
    ]
  );

  res.json(queryOne('SELECT * FROM akten WHERE id = ?', [Number(req.params.id)]));
});
```

**Note:** `execute()` calls `save()` after every call. The history rows and the main UPDATE each call `execute()` — this means multiple `save()` calls per PUT. This is acceptable at the current data volume. If it ever becomes a performance concern, the `db.run()` + single `save()` pattern can be used instead.

### Pattern 5: Permission guard (SEC-01)

The exact pattern used throughout `server.js`. Copy verbatim:

```javascript
// Source: server.js lines 267-268 (customer rebates POST)
const permission = req.headers['x-user-permission'];
if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
  return res.status(403).json({ error: 'Keine Berechtigung' });
}
```

**Apply to:** POST `/api/akten`, PUT `/api/akten/:id`, DELETE `/api/akten/:id`.

**Important note on DELETE:** The global middleware at `server.js` lines 52–60 already blocks non-Admin DELETE requests for all routes except `/api/calendar/`, `/api/time/`, and `/api/files/`. The explicit inline guard on `DELETE /api/akten/:id` is still required because the requirement (SEC-01) specifies Verwaltung/Buchhaltung/Admin, whereas the global middleware only allows Admin. The inline guard on DELETE should use the same three-role list for consistency.

### Pattern 6: POST handler — validation additions

The current POST handler at line 2667 accepts empty `aktennummer`. After adding UNIQUE, an empty string would block all subsequent Akten with no Aktennummer. Add server-side guard:

```javascript
// Source: pattern from server.js line 181 (customer validation)
app.post('/api/akten', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { aktennummer, ... } = req.body;
  if (!aktennummer || !aktennummer.trim()) {
    return res.status(400).json({ error: 'Aktennummer ist Pflichtfeld' });
  }
  // ... rest of handler
});
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UNIQUE constraint on existing column | Custom app-level dedup check | SQLite UNIQUE in table schema via reconstruction | DB enforces it atomically; app-level check has race conditions |
| Audit log storage format | Custom binary log, separate file, JSON blob | Single `akten_history` table with field-level rows | Queryable, GoBD-legible, survives schema changes |
| Permission middleware | Global auth middleware on all routes | Inline guard at each write route (existing pattern) | Codebase does not use global auth middleware; adding one only for akten creates inconsistency |
| Date/time for history rows | `new Date().toISOString()` | `berlinToday() + ' ' + berlinTime()` | Matches all other timestamp handling in server.js (Europe/Berlin timezone) |

---

## Common Pitfalls

### Pitfall 1: Reconstruction runs on a table with duplicate aktennummer values

**What goes wrong:** The `INSERT INTO akten_new ... SELECT FROM akten` fails with UNIQUE constraint violation if any two rows share the same aktennummer. The entire transaction rolls back and the migration silently fails (console.error only).

**Why it happens:** Existing akten table has no UNIQUE constraint — duplicates may exist in production.

**How to avoid:** Before deploying, run `SELECT aktennummer, COUNT(*) FROM akten GROUP BY aktennummer HAVING COUNT(*) > 1` against the production DB. If any rows return, manually resolve duplicates before the migration runs.

**Warning signs:** `akten migration failed: UNIQUE constraint failed` in server startup logs.

### Pitfall 2: PRAGMA foreign_keys = OFF issued inside an active transaction

**What goes wrong:** SQLite ignores `PRAGMA foreign_keys = OFF` if issued inside a transaction. FK enforcement stays ON, and the `DROP TABLE akten` step may fail if FK relationships point to it.

**How to avoid:** Issue `PRAGMA foreign_keys = OFF` as the first line, before `BEGIN TRANSACTION`. The correct order is: OFF → BEGIN → work → COMMIT → ON. See Pattern 2 above.

### Pitfall 3: History rows written after the UPDATE instead of before

**What goes wrong:** The diff compares `existing` (read before update) against `req.body`. If the UPDATE runs first and then the diff queries the table again, both old and new values are the same — no history rows are written.

**How to avoid:** Always read `existing` via `queryOne` before calling `execute` for the UPDATE. The diff loop runs on the in-memory `existing` object, not a second DB query.

### Pitfall 4: Permission check omitted from the existing POST handler when extending it

**What goes wrong:** The current `POST /api/akten` handler at line 2667 has zero permission check. When extending the handler to add the new FK columns, it's easy to extend only the column list and forget to add the guard.

**How to avoid:** The permission check is the FIRST two lines of the new POST handler body, before any `req.body` destructuring. Use the code in Pattern 5 verbatim.

### Pitfall 5: Multiple execute() calls per PUT incur multiple save() disk writes

**What goes wrong:** If an Akte has 10 changed fields, the PUT handler calls `execute()` 11 times (10 history rows + 1 UPDATE), triggering 11 `save()` calls that each write the entire DB to disk. At current scale this is acceptable; at high concurrency it could cause slowness.

**How to avoid for now:** Accept the behavior — production usage is low-concurrency. Document the tradeoff. If it becomes an issue, replace individual `execute()` calls in the history loop with direct `db.run()` calls and a single `save()` at the end.

---

## Code Examples

### Full migration placement in db.js

The reconstruction block goes immediately after the existing `akten` CREATE TABLE at line 482, before the `save()` call at line 484:

```javascript
// existing code at line 467-482:
db.run(`CREATE TABLE IF NOT EXISTS akten ( ... )`);

// NEW: Phase 1 migration — reconstruction + UNIQUE + new columns
// [Pattern 2 code here]

// NEW: Phase 1 — akten_history table
// [Pattern 3 code here]

// existing code at line 484:
save();
return db;
```

### Verification query after migration

```javascript
// Run this check in a startup log or temporary debug endpoint:
const cols = queryAll("PRAGMA table_info(akten)");
const colNames = cols.map(c => c.name);
const required = ['customer_id', 'vermittler_id', 'versicherung_id', 'rental_id',
                  'unfalldatum', 'unfallort', 'polizei_vor_ort',
                  'mietart', 'wiedervorlage_datum'];
required.forEach(c => {
  if (!colNames.includes(c)) console.error(`MISSING COLUMN: ${c}`);
});

const indexes = db.exec("PRAGMA index_list(akten)");
const hasUnique = indexes.length > 0 && indexes[0].values.some(r => r[2] === 1);
if (!hasUnique) console.error('MISSING: UNIQUE constraint on akten');
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Free-text kunde/vermittler fields | Nullable FK integer columns alongside text fallback | Enables relational queries; does not lose legacy data |
| No permission check on akten writes | Inline permission guard matching existing pattern | Closes current security gap (any user can write) |
| No history on akten changes | akten_history table with field-level diff | GoBD-compliant audit trail from day one |
| No uniqueness on aktennummer | UNIQUE constraint via table reconstruction | Prevents duplicate case numbers |

---

## Open Questions

1. **Duplicate aktennummer in production DB**
   - What we know: The current schema has no UNIQUE constraint, so duplicates are possible
   - What's unclear: Whether any exist in `data/bemo.db` right now
   - Recommendation: Planner adds a Wave 0 task to run the dedup query against the DB before coding. If duplicates exist, add a manual-resolution step before the migration task.

2. **PRAGMA index_list column layout in sql.js 1.11.0**
   - What we know: Standard SQLite `PRAGMA index_list` returns `(seq, name, unique, origin, partial)` — column 2 is `unique`
   - What's unclear: Whether sql.js 1.11.0 returns rows as arrays (accessed by index) or objects (accessed by name) in `db.exec()` results
   - What's known: `db.exec()` returns `[{ columns: [...], values: [[...]] }]` format — column 2 (0-indexed) of each value row is the `unique` flag
   - Recommendation: Planner adds a quick local test or the implementation verifies with a `console.log(db.exec("PRAGMA index_list(akten)"))` on first run.

3. **NULL vs empty string coercion for integer FK columns in history diff**
   - What we know: `customer_id` will be NULL in DB; `req.body.customer_id` may arrive as `null`, `""`, or `undefined`
   - What's unclear: The exact coercion needed to avoid spurious history entries (e.g., NULL vs "null" as string)
   - Recommendation: Planner normalizes FK fields to `null` before diff — `const norm = v => (v === null || v === undefined || v === '') ? null : v` — and uses `String(norm(oldVal)) !== String(norm(newVal))` for FK columns.

---

## Validation Architecture

### Test Framework

No test framework exists in the project. `package.json` has no test script, no test runner in `devDependencies`, and no test files outside `node_modules`. All verification for Phase 1 is via manual HTTP requests (curl) and direct SQLite inspection.

| Property | Value |
|----------|-------|
| Framework | None — zero test infrastructure |
| Config file | None |
| Quick run command | `curl -s -X POST http://localhost:3001/api/akten -H "Content-Type: application/json" -H "x-user-permission: Benutzer" -d '{"aktennummer":"X"}' | jq .` |
| Full suite command | Manual checklist (see below) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | customer_id, vermittler_id, versicherung_id, rental_id columns exist in akten | Manual | `curl -s http://localhost:3001/api/akten/1 \| jq 'has("customer_id")'` | ❌ Wave 0 |
| DB-02 | unfalldatum, unfallort, polizei_vor_ort columns exist | Manual | `curl -s http://localhost:3001/api/akten/1 \| jq 'has("unfalldatum")'` | ❌ Wave 0 |
| DB-03 | mietart, wiedervorlage_datum columns exist | Manual | `curl -s http://localhost:3001/api/akten/1 \| jq 'has("mietart")'` | ❌ Wave 0 |
| DB-04 | Second INSERT with same aktennummer returns 400/500 | Manual | `curl -X POST .../api/akten -H "x-user-permission: Admin" -d '{"aktennummer":"DUP-001",...}'` twice; second must fail | ❌ Wave 0 |
| DB-05 | PUT request creates akten_history rows | Manual | PUT an akte, then `curl .../api/akten/1` and check DB directly | ❌ Wave 0 |
| SEC-01 | POST/PUT/DELETE with Benutzer role returns 403 | Manual | `curl -X POST .../api/akten -H "x-user-permission: Benutzer" -d '{...}'` must return 403 | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Restart server, verify the changed endpoint with one curl command
- **Per wave merge:** Run the full manual checklist (all 6 requirement verifications above)
- **Phase gate:** All 6 behaviors verified before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] No test runner — manual curl verification is the only option without adding a test framework
- [ ] No test helper to query DB directly — recommend adding a temporary debug endpoint `GET /api/debug/schema` (Admin-only, dev-only) that returns `PRAGMA table_info(akten)` and `PRAGMA index_list(akten)` during development, removed before phase close

*(Adding a test framework is out of scope for this phase. Manual verification is sufficient and consistent with the rest of the codebase.)*

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection: `db.js` lines 1–522 (full file read) — migration patterns, table schemas, helper functions
- Direct codebase inspection: `server.js` lines 1–60 (global middleware, berlinNow helpers) and lines 2647–2763 (akten endpoints, stammdaten proxy)
- Direct codebase inspection: `server.js` lines 260–288 (permission guard pattern at customer rebates)
- `.planning/research/STACK.md` — SQL table reconstruction procedure (HIGH confidence, based on official SQLite docs)
- `.planning/research/PITFALLS.md` — full pitfall catalog, Pitfalls 1–5 directly applicable to Phase 1
- `.planning/research/ARCHITECTURE.md` — integration point map, build order, anti-patterns

### Secondary (MEDIUM confidence)

- `.planning/codebase/ARCHITECTURE.md` — permission model overview, query helper signatures
- `.planning/REQUIREMENTS.md` — DB-01 through DB-05, SEC-01 exact requirement text

### Tertiary (LOW confidence — no verification needed, patterns fully resolved above)

- None

---

## Metadata

**Confidence breakdown:**
- Migration patterns (ALTER TABLE, reconstruction): HIGH — read directly from db.js source; SQLite behavior confirmed in prior research
- Permission guard pattern: HIGH — read directly from server.js lines 267-268; exact copy-paste identified
- akten_history design: HIGH — field-level diff pattern is straightforward; GoBD requirement is well-documented
- UNIQUE constraint via reconstruction: HIGH — SQLite limitation is a hard fact; procedure verified in STACK.md
- Idempotency check via PRAGMA index_list: MEDIUM — column layout documented in SQLite official docs; sql.js exec() return format verified against queryAll helper in db.js

**Research date:** 2026-03-27
**Valid until:** 2026-05-01 (stack is locked, no dependency changes expected)
