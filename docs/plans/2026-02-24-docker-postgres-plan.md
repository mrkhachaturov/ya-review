# Docker + PostgreSQL Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dual-driver DB support (SQLite + PostgreSQL/pgvector), Dockerfile, and docker-compose for BI analytics deployment.

**Architecture:** Async `DbClient` interface replaces current sync one. `SqliteClient` wraps sync calls in Promises. New `PgClient` uses `pg` Pool with pgvector for native vector search. Multi-stage Dockerfile with Chromium. Compose provides PG for dev/testing.

**Tech Stack:** Node 22, pg (node-postgres), pgvector, Docker multi-stage, Playwright system Chromium

---

## Phase 1: Async DbClient Interface

### Task 1: Convert DbClient interface to async

**Files:**
- Modify: `src/db/driver.ts`

**Step 1: Update the DbClient interface**

Replace the current sync interface with async:

```typescript
export interface DbClient {
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly dialect: 'sqlite' | 'postgres';
}
```

**Step 2: Update createDbClient to be async**

```typescript
export async function createDbClient(cfg: Pick<Config, 'dbUrl' | 'dbPath'>): Promise<DbClient> {
  if (cfg.dbUrl) {
    const { PgClient } = await import('./postgres.js');
    return PgClient.connect(cfg.dbUrl);
  }
  const { SqliteClient } = await import('./sqlite.js');
  return new SqliteClient(cfg.dbPath);
}
```

**Step 3: Run type-check to see what breaks**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: Many type errors (all call sites still sync)

**Step 4: Commit**

```bash
git add src/db/driver.ts
git commit -m "refactor: make DbClient interface async"
```

---

### Task 2: Convert SqliteClient to async

**Files:**
- Modify: `src/db/sqlite.ts`

**Step 1: Wrap all methods in Promise.resolve**

```typescript
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DbClient } from './driver.js';

export class SqliteClient implements DbClient {
  readonly dialect = 'sqlite' as const;
  private db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // better-sqlite3 transactions are sync, but we need to support async fn
    // For SQLite, we run the async fn and rely on better-sqlite3's sync nature
    const sqliteTx = this.db.transaction(async () => await fn());
    return sqliteTx();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
```

**Step 2: Commit**

```bash
git add src/db/sqlite.ts
git commit -m "refactor: make SqliteClient methods async"
```

---

### Task 3: Convert schema.ts to use DbClient instead of raw better-sqlite3

**Files:**
- Modify: `src/db/schema.ts`

**Step 1: Rewrite openDb to use DbClient**

The current `openDb()` returns a raw `Database.Database`. We need to change the pattern so schema initialization works through `DbClient`. Create an `initSchema()` function that takes a `DbClient`:

```typescript
import type { DbClient } from './driver.js';

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY,
    org_id TEXT UNIQUE NOT NULL,
    name TEXT,
    rating REAL,
    review_count INTEGER,
    address TEXT,
    categories TEXT,
    role TEXT NOT NULL DEFAULT 'tracked',
    service_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- ... rest of tables (keep existing SQL)
`;

export async function initSchema(db: DbClient): Promise<void> {
  if (db.dialect === 'sqlite') {
    await db.exec(SQLITE_SCHEMA);
    // Run SQLite-specific migrations via db.all/db.exec
  } else {
    // PG schema will be handled by pg-schema.ts
    const { initPgSchema } = await import('./pg-schema.js');
    await initPgSchema(db);
  }
}

// Keep openDb() for backward compat with tests that use raw better-sqlite3
// But mark it as @deprecated
export { openDb, closeDb } from './schema-legacy.js';
```

**Important:** The existing `openDb()` function is used directly in many places (CLI commands, tests). We need to keep it working but gradually migrate callers to use `DbClient` + `initSchema()`.

**Strategy:** Keep `openDb()` as-is for now. Add `initSchema(db: DbClient)` alongside it. Later tasks will migrate callers.

**Step 2: Add initSchema function alongside existing openDb**

Add to the bottom of `src/db/schema.ts`:

```typescript
export async function initSchema(db: DbClient): Promise<void> {
  if (db.dialect === 'sqlite') {
    // For SQLite, use the same SQL as openDb but through DbClient
    await db.exec(SCHEMA_SQL);
    // Migrations
    const cols = await db.all<{ name: string }>(
      `PRAGMA table_info(companies)`
    );
    if (!cols.some(c => c.name === 'service_type')) {
      await db.exec('ALTER TABLE companies ADD COLUMN service_type TEXT');
    }
    const relCols = await db.all<{ name: string }>(
      `PRAGMA table_info(company_relations)`
    );
    if (!relCols.some(c => c.name === 'priority')) {
      await db.exec('ALTER TABLE company_relations ADD COLUMN priority INTEGER');
    }
    if (!relCols.some(c => c.name === 'notes')) {
      await db.exec('ALTER TABLE company_relations ADD COLUMN notes TEXT');
    }
  } else {
    const { initPgSchema } = await import('./pg-schema.js');
    await initPgSchema(db);
  }
}
```

**Step 3: Extract SCHEMA_SQL as a module-level constant**

Move the big SQL block from inside `openDb()` to a top-level `const SCHEMA_SQL`.

**Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add async initSchema for DbClient"
```

---

### Task 4: Convert DB module functions to use DbClient

**Files:**
- Modify: `src/db/companies.ts`
- Modify: `src/db/reviews.ts`
- Modify: `src/db/topics.ts`
- Modify: `src/db/sync-log.ts`
- Modify: `src/db/embeddings.ts`
- Modify: `src/db/stats.ts`

**Step 1: Convert companies.ts**

Change all function signatures from `db: Database.Database` to `db: DbClient`. Add `await` to all `db.prepare().run/get/all()` calls. Replace `db.prepare(sql).run(...)` with `db.run(sql, [...])` etc.

Example for `upsertCompany`:

```typescript
import type { DbClient } from './driver.js';
import type { CompanyRole } from '../types/index.js';

export async function upsertCompany(db: DbClient, input: UpsertCompanyInput): Promise<void> {
  const cats = input.categories ? JSON.stringify(input.categories) : null;
  await db.run(`
    INSERT INTO companies (org_id, name, rating, review_count, address, categories, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(org_id) DO UPDATE SET
      name = COALESCE(?, companies.name),
      rating = COALESCE(?, companies.rating),
      review_count = COALESCE(?, companies.review_count),
      address = COALESCE(?, companies.address),
      categories = COALESCE(?, companies.categories),
      role = ?,
      updated_at = CASE WHEN ? = 'sqlite' THEN datetime('now') ELSE NOW() END
  `, [
    input.org_id, input.name ?? null, input.rating ?? null,
    input.review_count ?? null, input.address ?? null, cats, input.role ?? 'tracked',
    // DO UPDATE params
    input.name ?? null, input.rating ?? null, input.review_count ?? null,
    input.address ?? null, cats, input.role ?? 'tracked',
    db.dialect,
  ]);
}
```

**Note:** The `datetime('now')` vs `NOW()` difference is a problem. Better approach: add a `now()` helper to DbClient or use JS-generated timestamps.

**Better approach for timestamps:** Generate ISO strings in JS:

```typescript
const now = new Date().toISOString();
```

This avoids dialect differences for timestamps entirely.

**Step 2: Convert all remaining DB module files**

Apply the same pattern to each file:
- Replace `import type Database from 'better-sqlite3'` with `import type { DbClient } from './driver.js'`
- Change all `db: Database.Database` params to `db: DbClient`
- Replace `db.prepare(sql).run(...)` with `await db.run(sql, [...])`
- Replace `db.prepare(sql).get(...)` with `await db.get<T>(sql, [...])`
- Replace `db.prepare(sql).all(...)` with `await db.all<T>(sql, [...])`
- Replace `db.transaction(fn)()` with `await db.transaction(fn)`
- Make all functions `async`
- Replace `datetime('now')` with JS-generated ISO timestamps

**Step 3: Convert reviews.ts** (uses named params — switch to positional)

The current `upsertReviews` uses `@org_id` named params and `db.prepare().run({...})`. Convert to positional `?` params for DbClient compatibility:

```typescript
export async function upsertReviews(db: DbClient, orgId: string, reviews: Review[]): Promise<UpsertResult> {
  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();

  await db.transaction(async () => {
    for (const r of reviews) {
      const key = reviewKey(orgId, r);
      const exists = await db.get<{ id: number }>('SELECT id FROM reviews WHERE review_key = ?', [key]);
      await db.run(`
        INSERT INTO reviews (org_id, review_key, author_name, author_icon_url, author_profile_url,
          date, text, stars, likes, dislikes, review_url, business_response)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(review_key) DO UPDATE SET
          text = ?, stars = ?, likes = ?, dislikes = ?,
          business_response = ?, updated_at = ?
      `, [
        orgId, key, r.author_name, r.author_icon_url, r.author_profile_url,
        r.date, r.text, r.stars, r.likes, r.dislikes, r.review_url, r.business_response,
        // ON CONFLICT params
        r.text, r.stars, r.likes, r.dislikes, r.business_response, now,
      ]);
      if (exists) updated++; else added++;
    }
  });

  return { added, updated };
}
```

**Step 4: Convert stats.ts** — semantic search stays JS-based for SQLite, PG uses pgvector

```typescript
export async function semanticSearchReviews(
  db: DbClient,
  queryEmbedding: number[],
  opts: SearchOpts = {},
): Promise<SemanticSearchRow[]> {
  if (db.dialect === 'postgres') {
    // Use pgvector native cosine distance
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const conditions: string[] = [];
    const params: unknown[] = [vectorStr];
    let paramIdx = 2;

    if (opts.orgId) {
      conditions.push(`r.org_id = $${paramIdx++}`);
      params.push(opts.orgId);
    }
    // ... build query with pgvector <=> operator
    const where = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';
    const limit = opts.limit ?? 50;
    params.push(limit);

    return db.all<SemanticSearchRow>(`
      SELECT r.org_id, r.date, r.stars, r.text, r.author_name,
        (r.business_response IS NOT NULL) as has_response,
        1 - (re.text_embedding <=> $1::vector) as similarity
      FROM reviews r
      JOIN review_embeddings re ON r.id = re.review_id
      WHERE r.text IS NOT NULL AND r.text != '' ${where}
      ORDER BY re.text_embedding <=> $1::vector
      LIMIT $${paramIdx}
    `, params);
  }

  // SQLite: in-memory cosine similarity (existing approach)
  const rows = await db.all<SearchRow & { text_embedding: Buffer }>(`
    SELECT r.org_id, r.date, r.stars, r.text, r.author_name,
      CASE WHEN r.business_response IS NOT NULL THEN 1 ELSE 0 END as has_response,
      re.text_embedding
    FROM reviews r
    JOIN review_embeddings re ON r.id = re.review_id
    WHERE r.text IS NOT NULL AND r.text != ''
  `);
  // ... compute cosine similarity in JS (existing logic)
}
```

**Step 5: Convert embeddings.ts, topics.ts, sync-log.ts**

Same pattern as above. Key differences:
- `embeddings.ts`: For PG, store embeddings as pgvector format string `[0.1,0.2,...]` instead of Buffer
- `topics.ts`: `lastInsertRowid` needs dialect handling (PG uses `RETURNING id`)

**Step 6: Commit**

```bash
git add src/db/companies.ts src/db/reviews.ts src/db/topics.ts src/db/sync-log.ts src/db/embeddings.ts src/db/stats.ts
git commit -m "refactor: convert all DB modules to async DbClient"
```

---

### Task 5: Add dialect-aware SQL helpers

**Files:**
- Create: `src/db/sql-helpers.ts`

**Step 1: Create helper for dialect differences**

```typescript
import type { DbClient } from './driver.js';

/** Generate a NOW() timestamp appropriate for the dialect, or just use JS */
export function jsNow(): string {
  return new Date().toISOString();
}

/**
 * Convert ON CONFLICT syntax.
 * SQLite: ON CONFLICT(col) DO UPDATE SET ...
 * PG: ON CONFLICT (col) DO UPDATE SET ... (same syntax, but PG uses EXCLUDED not @param)
 * Both support the same basic ON CONFLICT syntax, so this is mainly for reference.
 */

/**
 * For embeddings: convert between Buffer (SQLite) and pgvector string (PG)
 */
export function embeddingToSql(db: DbClient, vec: number[]): Buffer | string {
  if (db.dialect === 'postgres') {
    return `[${vec.join(',')}]`;
  }
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

export function sqlToEmbedding(db: DbClient, raw: Buffer | string): number[] {
  if (db.dialect === 'postgres') {
    // pgvector returns string like "[0.1,0.2,...]"
    const str = typeof raw === 'string' ? raw : raw.toString();
    return JSON.parse(str);
  }
  // SQLite: Float32 buffer
  const buf = raw as Buffer;
  const arr: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    arr.push(buf.readFloatLE(i));
  }
  return arr;
}

/**
 * For PG $1,$2 vs SQLite ?,? parameter styles.
 * Since our DbClient.run/get/all use positional arrays,
 * PgClient internally converts ? to $N.
 */
```

**Step 2: Commit**

```bash
git add src/db/sql-helpers.ts
git commit -m "feat: add dialect-aware SQL helpers"
```

---

### Task 6: Convert CLI commands to async

**Files:**
- Modify: `src/cli/apply.ts`
- Modify: `src/cli/daemon.ts`
- Modify: All other CLI command files (20+ files)

**Step 1: Convert apply.ts**

Change `applyConfig` to async, use `DbClient` instead of `Database.Database`:

```typescript
import type { DbClient } from '../db/driver.js';

export async function applyConfig(db: DbClient, yarevConfig: YarevConfig): Promise<void> {
  const now = jsNow();
  await db.transaction(async () => {
    for (const company of yarevConfig.companies) {
      await upsertCompany(db, { org_id: company.org_id, name: company.name, role: company.role });
      await db.run('UPDATE companies SET service_type = ? WHERE org_id = ?',
        [company.service_type, company.org_id]);
    }
    for (const company of yarevConfig.companies) {
      if (company.competitors) {
        for (const comp of company.competitors) {
          await db.run(`
            INSERT INTO company_relations (company_org_id, competitor_org_id, priority, notes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(company_org_id, competitor_org_id) DO UPDATE SET
              priority = EXCLUDED.priority, notes = EXCLUDED.notes
          `, [company.org_id, comp.org_id, comp.priority, comp.notes ?? null]);
        }
      }
    }
    for (const company of yarevConfig.companies) {
      if (Array.isArray(company.topics)) {
        await upsertTopics(db, company.org_id, company.topics as YarevTopicConfig[]);
      }
    }
  });
}
```

**Step 2: Update CLI action handlers to use createDbClient**

Each CLI command currently does `const db = openDb(config.dbPath)`. Change to:

```typescript
.action(async (opts) => {
  const db = await createDbClient(config);
  await initSchema(db);
  try {
    // ... command logic with await
  } finally {
    await db.close();
  }
});
```

**Step 3: Convert all CLI command files**

List of files to convert (each follows the same pattern):
- `src/cli/apply.ts`
- `src/cli/companies.ts`
- `src/cli/compare.ts`
- `src/cli/competitor.ts`
- `src/cli/daemon.ts`
- `src/cli/digest.ts`
- `src/cli/embed.ts`
- `src/cli/classify.ts`
- `src/cli/init.ts`
- `src/cli/query.ts`
- `src/cli/reviews.ts`
- `src/cli/score.ts`
- `src/cli/search.ts`
- `src/cli/similar.ts`
- `src/cli/stats.ts`
- `src/cli/status.ts`
- `src/cli/sync.ts`
- `src/cli/topics.ts`
- `src/cli/track.ts`
- `src/cli/trends.ts`
- `src/cli/unanswered.ts`

**Step 4: Commit**

```bash
git add src/cli/
git commit -m "refactor: convert all CLI commands to async DbClient"
```

---

### Task 7: Update tests for async DbClient

**Files:**
- Modify: All test files in `tests/`

**Step 1: Update test helpers**

Tests currently use `openDb(':memory:')` which returns raw `Database.Database`. Create a test helper:

```typescript
// tests/helpers.ts
import { SqliteClient } from '../src/db/sqlite.js';
import { initSchema } from '../src/db/schema.js';
import type { DbClient } from '../src/db/driver.js';

export async function createTestDb(): Promise<DbClient> {
  const db = new SqliteClient(':memory:');
  await initSchema(db);
  return db;
}
```

**Step 2: Convert each test file**

Change test functions to async, replace `openDb(':memory:')` with `await createTestDb()`, add `await` to all DB calls.

Example for `tests/db/companies.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';
import { upsertCompany, listCompanies, getCompany, removeCompany } from '../../src/db/companies.js';
import type { DbClient } from '../../src/db/driver.js';

describe('companies', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('upsertCompany inserts a new company', async () => {
    await upsertCompany(db, {
      org_id: '111', name: 'Test Biz', rating: 4.5,
      review_count: 100, address: 'ул. Тестовая, 1',
      categories: ['Автосервис'], role: 'mine',
    });
    const c = await getCompany(db, '111');
    assert.ok(c);
    assert.equal(c!.name, 'Test Biz');
  });
  // ... convert remaining tests
});
```

**Step 3: Run tests**

Run: `npm test`
Expected: All 16 test files pass

**Step 4: Commit**

```bash
git add tests/
git commit -m "refactor: update all tests for async DbClient"
```

---

## Phase 2: PostgreSQL Driver

### Task 8: Create PG schema

**Files:**
- Create: `src/db/pg-schema.ts`

**Step 1: Write PostgreSQL schema**

```typescript
import type { DbClient } from './driver.js';

export async function initPgSchema(db: DbClient): Promise<void> {
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      org_id TEXT UNIQUE NOT NULL,
      name TEXT,
      rating DOUBLE PRECISION,
      review_count INTEGER,
      address TEXT,
      categories JSONB,
      role TEXT NOT NULL DEFAULT 'tracked',
      service_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS company_relations (
      id SERIAL PRIMARY KEY,
      company_org_id TEXT NOT NULL REFERENCES companies(org_id),
      competitor_org_id TEXT NOT NULL REFERENCES companies(org_id),
      priority INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_org_id, competitor_org_id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      review_key TEXT UNIQUE NOT NULL,
      author_name TEXT,
      author_icon_url TEXT,
      author_profile_url TEXT,
      date TEXT,
      text TEXT,
      stars DOUBLE PRECISION,
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      review_url TEXT,
      business_response TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_org_id ON reviews(org_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(date);
    CREATE INDEX IF NOT EXISTS idx_reviews_stars ON reviews(stars);

    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      sync_type TEXT NOT NULL,
      reviews_added INTEGER NOT NULL DEFAULT 0,
      reviews_updated INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS topic_templates (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      parent_id INTEGER REFERENCES topic_templates(id),
      name TEXT NOT NULL,
      embedding vector(1536),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_topic_templates_org ON topic_templates(org_id);

    CREATE TABLE IF NOT EXISTS review_embeddings (
      review_id INTEGER PRIMARY KEY REFERENCES reviews(id),
      model TEXT NOT NULL,
      text_embedding vector(1536) NOT NULL,
      response_embedding vector(1536),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_topics (
      id SERIAL PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      topic_id INTEGER NOT NULL REFERENCES topic_templates(id),
      similarity DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(review_id, topic_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_topics_review ON review_topics(review_id);
    CREATE INDEX IF NOT EXISTS idx_review_topics_topic ON review_topics(topic_id);

    CREATE TABLE IF NOT EXISTS company_scores (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      topic_id INTEGER REFERENCES topic_templates(id),
      score DOUBLE PRECISION NOT NULL,
      review_count INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, topic_id)
    );
  `);

  -- HNSW indexes for fast vector similarity
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_review_embeddings_cosine
      ON review_embeddings USING hnsw (text_embedding vector_cosine_ops);
    CREATE INDEX IF NOT EXISTS idx_topic_embeddings_cosine
      ON topic_templates USING hnsw (embedding vector_cosine_ops);
  `);

  -- Migrations table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
```

**Step 2: Commit**

```bash
git add src/db/pg-schema.ts
git commit -m "feat: add PostgreSQL schema with pgvector"
```

---

### Task 9: Implement PgClient

**Files:**
- Modify: `src/db/postgres.ts`

**Step 1: Implement full PgClient using pg Pool**

```typescript
import type { DbClient } from './driver.js';

export class PgClient implements DbClient {
  readonly dialect = 'postgres' as const;
  private pool: any; // pg.Pool

  private constructor(pool: any) {
    this.pool = pool;
  }

  static async connect(connectionString: string): Promise<PgClient> {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString });
    // Test connection
    const client = await pool.connect();
    client.release();
    return new PgClient(pool);
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    const pgSql = this.convertParams(sql);
    await this.pool.query(pgSql, params);
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const pgSql = this.convertParams(sql);
    const result = await this.pool.query(pgSql, params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pgSql = this.convertParams(sql);
    const result = await this.pool.query(pgSql, params);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Convert SQLite ? params to PG $1, $2, ... */
  private convertParams(sql: string): string {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
  }
}
```

**Step 2: Commit**

```bash
git add src/db/postgres.ts
git commit -m "feat: implement PgClient with pg Pool"
```

---

### Task 10: Move pg from optional to regular dependency

**Files:**
- Modify: `package.json`

**Step 1: Move pg**

Move `"pg": "^8.13.0"` from `optionalDependencies` to `dependencies`. Keep `@types/pg` in devDependencies (already there).

**Step 2: Install**

Run: `npm install`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: move pg from optional to required"
```

---

## Phase 3: Docker

### Task 11: Create .dockerignore

**Files:**
- Create: `.dockerignore`

**Step 1: Write .dockerignore**

```
node_modules
dist
.env
*.db
.DS_Store
.idea
.vscode
.git
.claude
docs/plans
tests
*.log
.worktrees
```

**Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore"
```

---

### Task 12: Create Dockerfile

**Files:**
- Create: `Dockerfile`

**Step 1: Write multi-stage Dockerfile**

```dockerfile
# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build

# Stage 2: Runtime
FROM node:22-slim

# Install Chromium and dependencies for Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install-deps chromium 2>/dev/null || true

COPY --from=builder /app/dist dist/
COPY config.example.yaml ./

# Set Playwright to use system Chromium
ENV BROWSER_BACKEND=playwright
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV BROWSER_HEADLESS=true

# Default: run the daemon
ENTRYPOINT ["node", "dist/index.js"]
CMD ["daemon"]
```

**Step 2: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile with Chromium"
```

---

### Task 13: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

**Step 1: Write compose file**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: yarev
      POSTGRES_USER: yarev
      POSTGRES_PASSWORD: ${PG_PASSWORD:-yarev_dev}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "${PG_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U yarev -d yarev"]
      interval: 5s
      timeout: 5s
      retries: 5

  yarev:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      YAREV_DB_URL: postgresql://yarev:${PG_PASSWORD:-yarev_dev}@postgres:5432/yarev
      YAREV_OPENAI_API_KEY: ${YAREV_OPENAI_API_KEY}
      YAREV_CONFIG: /app/config.yaml
      DAEMON_CRON: ${DAEMON_CRON:-0 8 * * *}
      EMBED_CRON: ${EMBED_CRON:-0 2 * * *}
    volumes:
      - ${YAREV_CONFIG_PATH:-./config.example.yaml}:/app/config.yaml:ro
    restart: unless-stopped

volumes:
  pgdata:
```

**Step 2: Create .env.example for Docker**

```bash
# .env.example
PG_PASSWORD=yarev_dev
PG_PORT=5432
YAREV_OPENAI_API_KEY=sk-...
YAREV_CONFIG_PATH=./config.yaml
DAEMON_CRON=0 8 * * *
EMBED_CRON=0 2 * * *
```

**Step 3: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat: add docker-compose with pgvector"
```

---

## Phase 4: Daemon Enhancements

### Task 14: Add embed cron to daemon

**Files:**
- Modify: `src/cli/daemon.ts`
- Modify: `src/config.ts`
- Modify: `src/yaml-config.ts`
- Modify: `src/types/index.ts`

**Step 1: Add new config fields**

In `src/config.ts`, add:

```typescript
embedCron:        process.env.EMBED_CRON ?? '0 2 * * *',
embedOnSync:      process.env.EMBED_ON_SYNC === 'true',
fullSyncOnStart:  process.env.FULL_SYNC_ON_START !== 'false',
```

**Step 2: Add daemon section to YAML types**

In `src/types/index.ts`:

```typescript
export interface YarevDaemonConfig {
  sync_cron?: string;
  embed_cron?: string;
  embed_on_sync?: boolean;
  full_sync_on_start?: boolean;
}

export interface YarevConfig {
  companies: YarevCompanyConfig[];
  embeddings: YarevEmbeddingsConfig;
  daemon?: YarevDaemonConfig;
}
```

**Step 3: Parse daemon section in yaml-config.ts**

Add after the `embeddings` parsing:

```typescript
const daemon: YarevDaemonConfig = {
  sync_cron: doc.daemon?.sync_cron,
  embed_cron: doc.daemon?.embed_cron,
  embed_on_sync: doc.daemon?.embed_on_sync ?? false,
  full_sync_on_start: doc.daemon?.full_sync_on_start ?? true,
};

return { companies, embeddings, daemon };
```

**Step 4: Update daemon.ts with embed cron**

Add a second cron job for embed + classify + score pipeline:

```typescript
// Schedule embed batch
const embedCron = opts.embedCron ?? config.embedCron;
nodeCron.default.schedule(embedCron, async () => {
  const db = await createDbClient(config);
  await initSchema(db);
  try {
    // Embed unembedded reviews
    // Classify newly embedded reviews
    // Recompute scores
  } finally {
    await db.close();
  }
});
```

**Step 5: Commit**

```bash
git add src/cli/daemon.ts src/config.ts src/yaml-config.ts src/types/index.ts
git commit -m "feat: add embed cron and daemon config"
```

---

## Phase 5: Verification

### Task 15: Run full test suite and type-check

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Build**

Run: `npm run build`
Expected: Clean build in dist/

**Step 4: Docker build test**

Run: `docker build -t yarev .`
Expected: Image builds successfully

**Step 5: Docker compose test**

Run: `docker compose up -d postgres && sleep 5 && docker compose run --rm yarev yarev companies && docker compose down`
Expected: Connects to PG, runs command, exits cleanly

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: Docker + PostgreSQL dual-driver support"
```

---

## Task Dependency Graph

```
Phase 1 (Async):  1 → 2 → 3 → 4 → 5 → 6 → 7
Phase 2 (PG):     8 → 9 → 10  (can start after Task 4)
Phase 3 (Docker): 11 → 12 → 13  (can start after Task 10)
Phase 4 (Daemon): 14  (can start after Task 6)
Phase 5 (Verify): 15  (after all phases)
```

**Parallelizable:** Phase 2 (Tasks 8-10) can run in parallel with Phase 1 Tasks 5-7. Phase 3 can start as soon as Phase 2 completes. Phase 4 can run in parallel with Phase 3.

## Estimated Scope

- ~25 source files modified
- ~6 new files created
- ~16 test files updated
- Every DB-calling module gets async conversion
