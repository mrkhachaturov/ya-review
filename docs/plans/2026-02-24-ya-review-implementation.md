# ya-review Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `ya-review` (CLI: `yarev`), a TypeScript npm CLI tool that scrapes Yandex Maps reviews, stores them in SQLite, and provides AI-friendly querying with competitor comparison.

**Architecture:** Commander.js CLI + better-sqlite3 database + Patchright/Playwright scraper. Ports DOM scraping logic from ya-reviews-mcp (Python) to TypeScript. Follows hae-vault patterns: raw SQL, env config, ESM, strict TypeScript.

**Tech Stack:** TypeScript 5.7+, Node >= 22, Commander.js, better-sqlite3, Patchright (default) / Playwright / remote CDP, node-cron, tsx, native Node.js test runner.

**Reference projects (read these for patterns):**
- `/Users/mrkhachaturov/Developer/ya-metrics/hae-vault` — CLI structure, config, DB, output patterns
- `/Users/mrkhachaturov/Developer/ya-metrics/ya-reviews-mcp` — scraper logic, selectors, backends

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "ya-review",
  "version": "0.1.0",
  "description": "CLI tool for scraping, storing, and querying Yandex Maps business reviews",
  "type": "module",
  "bin": {
    "yarev": "dist/index.js"
  },
  "main": "./dist/index.js",
  "files": [
    "dist/",
    "README.md"
  ],
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "prepare": "npm run build",
    "test": "tsx --test tests/**/*.test.ts"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "keywords": [
    "yandex-maps",
    "reviews",
    "scraper",
    "sqlite",
    "cli",
    "yarev",
    "business-reviews"
  ],
  "author": "Ruben Khachaturov <mr.kha4a2rov@protonmail.com>",
  "license": "MIT",
  "dependencies": {
    "better-sqlite3": "^12.6.2",
    "commander": "^12.1.0",
    "dotenv": "^17.3.1",
    "node-cron": "^3.0.3"
  },
  "optionalDependencies": {
    "patchright": "^1.0.0",
    "playwright": "^1.40.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.10.0",
    "@types/node-cron": "^3.0.11",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

Copy exact config from hae-vault:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
.env
*.db
```

**Step 4: Create .env.example**

```env
# Database
# YAREV_DB_PATH=~/.yarev/reviews.db

# Browser backend: patchright (default) | playwright | remote
# BROWSER_BACKEND=patchright
# BROWSER_WS_URL=ws://localhost:3000
# BROWSER_HEADLESS=true
# BROWSER_LOCALE=ru-RU

# Scraping
# PAGE_TIMEOUT=30000
# INTERCEPT_TIMEOUT=15000
# REQUEST_DELAY=2.0
# MAX_PAGES=20
# SCRAPER_RETRIES=3
# SCRAPER_RETRY_DELAY=2.0
# INCREMENTAL_WINDOW_SIZE=50

# Daemon
# DAEMON_CRON=0 8 * * *
```

**Step 5: Create minimal src/index.ts entry point**

```typescript
#!/usr/bin/env node
import './config.js';
import { program } from './cli/index.js';
program.parse();
```

**Step 6: Install dependencies**

Run: `npm install`

**Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (may warn about missing src/config.ts and src/cli/index.ts — that's fine, we'll create them next)

**Step 8: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example src/index.ts
git commit -m "feat: project scaffolding — package.json, tsconfig, entry point"
```

---

## Task 2: Types and Config

**Files:**
- Create: `src/types/index.ts`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

**Step 1: Write types**

```typescript
// src/types/index.ts

export interface Review {
  author_name: string | null;
  author_icon_url: string | null;
  author_profile_url: string | null;
  date: string | null;
  text: string | null;
  stars: number;
  likes: number;
  dislikes: number;
  review_url: string | null;
  business_response: string | null;
}

export interface CompanyInfo {
  name: string | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  categories: string[];
}

export interface ScrapeResult {
  company: CompanyInfo;
  reviews: Review[];
  total_count: number;
}

export interface SyncResult {
  org_id: string;
  sync_type: 'full' | 'incremental';
  reviews_added: number;
  reviews_updated: number;
  started_at: string;
  finished_at: string;
  status: 'ok' | 'error';
  error_message?: string;
}

export type CompanyRole = 'mine' | 'competitor' | 'tracked';
export type BrowserBackend = 'patchright' | 'playwright' | 'remote';
```

**Step 2: Write config module**

Pattern: copy from hae-vault `src/config.ts`, adapt for yarev env vars.

```typescript
// src/config.ts
import { config as dotenvLoad } from 'dotenv';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserBackend } from './types/index.js';

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return homedir() + p.slice(1);
  }
  return p;
}

const envFile = process.env.YAREV_ENV_FILE ?? join(process.cwd(), '.env');
if (existsSync(envFile)) {
  dotenvLoad({ path: envFile });
}

const DEFAULT_DB_PATH = join(homedir(), '.yarev', 'reviews.db');

export const config = {
  dbPath:               expandTilde(process.env.YAREV_DB_PATH ?? DEFAULT_DB_PATH),
  browserBackend:       (process.env.BROWSER_BACKEND ?? 'patchright') as BrowserBackend,
  browserWsUrl:         process.env.BROWSER_WS_URL,
  browserHeadless:      process.env.BROWSER_HEADLESS !== 'false',
  browserLocale:        process.env.BROWSER_LOCALE ?? 'ru-RU',
  pageTimeout:          Number(process.env.PAGE_TIMEOUT ?? 30000),
  interceptTimeout:     Number(process.env.INTERCEPT_TIMEOUT ?? 15000),
  requestDelay:         Number(process.env.REQUEST_DELAY ?? 2.0),
  maxPages:             Number(process.env.MAX_PAGES ?? 20),
  scraperRetries:       Number(process.env.SCRAPER_RETRIES ?? 3),
  scraperRetryDelay:    Number(process.env.SCRAPER_RETRY_DELAY ?? 2.0),
  incrementalWindowSize: Number(process.env.INCREMENTAL_WINDOW_SIZE ?? 50),
  daemonCron:           process.env.DAEMON_CRON ?? '0 8 * * *',
} as const;

export type Config = typeof config;
```

**Step 3: Write config test**

```typescript
// tests/config.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('config', () => {
  const origEnv = { ...process.env };

  after(() => {
    process.env = origEnv;
  });

  it('uses default values when no env vars set', async () => {
    delete process.env.YAREV_DB_PATH;
    delete process.env.BROWSER_BACKEND;
    // Re-import to pick up fresh env
    const { config } = await import('../src/config.js');
    assert.ok(config.dbPath.endsWith('.yarev/reviews.db'));
    assert.equal(config.browserBackend, 'patchright');
    assert.equal(config.browserHeadless, true);
    assert.equal(config.maxPages, 20);
    assert.equal(config.incrementalWindowSize, 50);
  });
});
```

**Step 4: Run test**

Run: `npx tsx --test tests/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types/index.ts src/config.ts tests/config.test.ts
git commit -m "feat: add types, config module with env loading"
```

---

## Task 3: Database Schema

**Files:**
- Create: `src/db/schema.ts`
- Create: `tests/db/schema.test.ts`

**Step 1: Write the test**

```typescript
// tests/db/schema.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb } from '../../src/db/schema.js';

describe('openDb', () => {
  it('creates all tables in an in-memory database', () => {
    const db = openDb(':memory:');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);

    assert.ok(names.includes('companies'));
    assert.ok(names.includes('company_relations'));
    assert.ok(names.includes('reviews'));
    assert.ok(names.includes('sync_log'));
    closeDb(db);
  });

  it('is idempotent — calling openDb twice does not error', () => {
    const db = openDb(':memory:');
    // Calling the schema creation again should not throw
    openDb(':memory:');
    closeDb(db);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/schema.test.ts`
Expected: FAIL — module not found

**Step 3: Write the schema**

```typescript
// src/db/schema.ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY,
      org_id TEXT UNIQUE NOT NULL,
      name TEXT,
      rating REAL,
      review_count INTEGER,
      address TEXT,
      categories TEXT,
      role TEXT NOT NULL DEFAULT 'tracked',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_relations (
      id INTEGER PRIMARY KEY,
      company_org_id TEXT NOT NULL,
      competitor_org_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(company_org_id, competitor_org_id),
      FOREIGN KEY (company_org_id) REFERENCES companies(org_id),
      FOREIGN KEY (competitor_org_id) REFERENCES companies(org_id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL,
      review_key TEXT UNIQUE NOT NULL,
      author_name TEXT,
      author_icon_url TEXT,
      author_profile_url TEXT,
      date TEXT,
      text TEXT,
      stars REAL,
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      review_url TEXT,
      business_response TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES companies(org_id)
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_org_id ON reviews(org_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(date);
    CREATE INDEX IF NOT EXISTS idx_reviews_stars ON reviews(stars);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL,
      sync_type TEXT NOT NULL,
      reviews_added INTEGER NOT NULL DEFAULT 0,
      reviews_updated INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      FOREIGN KEY (org_id) REFERENCES companies(org_id)
    );
  `);

  return db;
}

export function closeDb(db: Database.Database): void {
  db.close();
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/db/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/schema.ts tests/db/schema.test.ts
git commit -m "feat: database schema — companies, reviews, relations, sync_log"
```

---

## Task 4: Database Operations — Companies

**Files:**
- Create: `src/db/companies.ts`
- Create: `tests/db/companies.test.ts`

**Step 1: Write the test**

```typescript
// tests/db/companies.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb } from '../../src/db/schema.js';
import {
  upsertCompany,
  listCompanies,
  getCompany,
  removeCompany,
} from '../../src/db/companies.js';
import type Database from 'better-sqlite3';

describe('companies', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('upsertCompany inserts a new company', () => {
    upsertCompany(db, {
      org_id: '111',
      name: 'Test Biz',
      rating: 4.5,
      review_count: 100,
      address: 'ул. Тестовая, 1',
      categories: ['Автосервис'],
      role: 'mine',
    });
    const c = getCompany(db, '111');
    assert.ok(c);
    assert.equal(c!.name, 'Test Biz');
    assert.equal(c!.role, 'mine');
  });

  it('upsertCompany updates existing company metadata', () => {
    upsertCompany(db, { org_id: '111', name: 'Old', role: 'tracked' });
    upsertCompany(db, { org_id: '111', name: 'New', rating: 4.8, role: 'mine' });
    const c = getCompany(db, '111');
    assert.equal(c!.name, 'New');
    assert.equal(c!.rating, 4.8);
    assert.equal(c!.role, 'mine');
  });

  it('listCompanies filters by role', () => {
    upsertCompany(db, { org_id: '1', name: 'A', role: 'mine' });
    upsertCompany(db, { org_id: '2', name: 'B', role: 'competitor' });
    upsertCompany(db, { org_id: '3', name: 'C', role: 'tracked' });

    const mine = listCompanies(db, 'mine');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].org_id, '1');

    const all = listCompanies(db);
    assert.equal(all.length, 3);
  });

  it('removeCompany deletes the company', () => {
    upsertCompany(db, { org_id: '111', name: 'X', role: 'tracked' });
    removeCompany(db, '111');
    assert.equal(getCompany(db, '111'), undefined);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/companies.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/db/companies.ts
import type Database from 'better-sqlite3';
import type { CompanyRole } from '../types/index.js';

export interface CompanyRow {
  id: number;
  org_id: string;
  name: string | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  categories: string | null;
  role: CompanyRole;
  created_at: string;
  updated_at: string;
}

export interface UpsertCompanyInput {
  org_id: string;
  name?: string | null;
  rating?: number | null;
  review_count?: number | null;
  address?: string | null;
  categories?: string[];
  role?: CompanyRole;
}

export function upsertCompany(db: Database.Database, input: UpsertCompanyInput): void {
  const cats = input.categories ? JSON.stringify(input.categories) : null;
  db.prepare(`
    INSERT INTO companies (org_id, name, rating, review_count, address, categories, role)
    VALUES (@org_id, @name, @rating, @review_count, @address, @categories, @role)
    ON CONFLICT(org_id) DO UPDATE SET
      name = COALESCE(@name, companies.name),
      rating = COALESCE(@rating, companies.rating),
      review_count = COALESCE(@review_count, companies.review_count),
      address = COALESCE(@address, companies.address),
      categories = COALESCE(@categories, companies.categories),
      role = @role,
      updated_at = datetime('now')
  `).run({
    org_id: input.org_id,
    name: input.name ?? null,
    rating: input.rating ?? null,
    review_count: input.review_count ?? null,
    address: input.address ?? null,
    categories: cats,
    role: input.role ?? 'tracked',
  });
}

export function getCompany(db: Database.Database, orgId: string): CompanyRow | undefined {
  return db.prepare('SELECT * FROM companies WHERE org_id = ?').get(orgId) as CompanyRow | undefined;
}

export function listCompanies(db: Database.Database, role?: CompanyRole): CompanyRow[] {
  if (role) {
    return db.prepare('SELECT * FROM companies WHERE role = ? ORDER BY name').all(role) as CompanyRow[];
  }
  return db.prepare('SELECT * FROM companies ORDER BY name').all() as CompanyRow[];
}

export function removeCompany(db: Database.Database, orgId: string): void {
  db.prepare('DELETE FROM reviews WHERE org_id = ?').run(orgId);
  db.prepare('DELETE FROM company_relations WHERE company_org_id = ? OR competitor_org_id = ?').run(orgId, orgId);
  db.prepare('DELETE FROM sync_log WHERE org_id = ?').run(orgId);
  db.prepare('DELETE FROM companies WHERE org_id = ?').run(orgId);
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/db/companies.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/companies.ts tests/db/companies.test.ts
git commit -m "feat: company CRUD — upsert, get, list, remove"
```

---

## Task 5: Database Operations — Reviews

**Files:**
- Create: `src/db/reviews.ts`
- Create: `tests/db/reviews.test.ts`

**Step 1: Write the test**

```typescript
// tests/db/reviews.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/schema.js';
import { upsertCompany } from '../../src/db/companies.js';
import { upsertReviews, queryReviews, reviewKey } from '../../src/db/reviews.js';
import type Database from 'better-sqlite3';

describe('reviews', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '111', name: 'Test', role: 'mine' });
  });

  it('reviewKey uses review_url when available', () => {
    const key = reviewKey('111', {
      review_url: 'https://yandex.ru/maps/org/111/reviews?reviews[publicId]=abc',
      author_name: 'Test',
      date: '2025-01-01',
      text: 'Great',
    });
    assert.equal(key, 'https://yandex.ru/maps/org/111/reviews?reviews[publicId]=abc');
  });

  it('reviewKey falls back to hash when no review_url', () => {
    const key = reviewKey('111', {
      review_url: null,
      author_name: 'Ivan',
      date: '2025-06-01',
      text: 'Excellent service for everyone',
    });
    assert.ok(key.startsWith('sha256:'));
    assert.equal(key.length, 7 + 64); // "sha256:" + 64 hex chars
  });

  it('upsertReviews inserts new reviews and returns counts', () => {
    const result = upsertReviews(db, '111', [
      {
        author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
        date: '2025-01-01', text: 'Great!', stars: 5,
        likes: 2, dislikes: 0, review_url: 'http://r/1', business_response: null,
      },
      {
        author_name: 'Maria', author_icon_url: null, author_profile_url: null,
        date: '2025-01-02', text: 'Good', stars: 4,
        likes: 0, dislikes: 0, review_url: 'http://r/2', business_response: 'Thanks!',
      },
    ]);
    assert.equal(result.added, 2);
    assert.equal(result.updated, 0);
  });

  it('upsertReviews updates existing review when text changes', () => {
    upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Great!', stars: 5,
      likes: 2, dislikes: 0, review_url: 'http://r/1', business_response: null,
    }]);
    const result = upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Updated text!', stars: 5,
      likes: 5, dislikes: 1, review_url: 'http://r/1', business_response: 'Thanks!',
    }]);
    assert.equal(result.added, 0);
    assert.equal(result.updated, 1);
  });

  it('queryReviews returns reviews for an org', () => {
    upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Great!', stars: 5,
      likes: 0, dislikes: 0, review_url: 'http://r/1', business_response: null,
    }]);
    const rows = queryReviews(db, '111');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].author_name, 'Ivan');
  });

  it('queryReviews filters by stars range', () => {
    upsertReviews(db, '111', [
      { author_name: 'A', author_icon_url: null, author_profile_url: null,
        date: '2025-01-01', text: 'Bad', stars: 1,
        likes: 0, dislikes: 0, review_url: 'http://r/1', business_response: null },
      { author_name: 'B', author_icon_url: null, author_profile_url: null,
        date: '2025-01-02', text: 'Great', stars: 5,
        likes: 0, dislikes: 0, review_url: 'http://r/2', business_response: null },
    ]);
    const bad = queryReviews(db, '111', { starsMin: 1, starsMax: 3 });
    assert.equal(bad.length, 1);
    assert.equal(bad[0].author_name, 'A');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/reviews.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/db/reviews.ts
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Review } from '../types/index.js';

export interface ReviewRow {
  id: number;
  org_id: string;
  review_key: string;
  author_name: string | null;
  author_icon_url: string | null;
  author_profile_url: string | null;
  date: string | null;
  text: string | null;
  stars: number;
  likes: number;
  dislikes: number;
  review_url: string | null;
  business_response: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface UpsertResult {
  added: number;
  updated: number;
}

export interface QueryReviewsOpts {
  since?: string;
  starsMin?: number;
  starsMax?: number;
  limit?: number;
}

export function reviewKey(
  orgId: string,
  review: { review_url: string | null; author_name: string | null; date: string | null; text: string | null },
): string {
  if (review.review_url) return review.review_url;
  const raw = `${orgId}|${review.author_name ?? ''}|${review.date ?? ''}|${(review.text ?? '').slice(0, 100)}`;
  return 'sha256:' + createHash('sha256').update(raw).digest('hex');
}

export function upsertReviews(db: Database.Database, orgId: string, reviews: Review[]): UpsertResult {
  let added = 0;
  let updated = 0;

  const insertStmt = db.prepare(`
    INSERT INTO reviews (org_id, review_key, author_name, author_icon_url, author_profile_url,
      date, text, stars, likes, dislikes, review_url, business_response)
    VALUES (@org_id, @review_key, @author_name, @author_icon_url, @author_profile_url,
      @date, @text, @stars, @likes, @dislikes, @review_url, @business_response)
    ON CONFLICT(review_key) DO UPDATE SET
      text = @text,
      stars = @stars,
      likes = @likes,
      dislikes = @dislikes,
      business_response = @business_response,
      updated_at = datetime('now')
  `);

  const existsStmt = db.prepare('SELECT id FROM reviews WHERE review_key = ?');

  const upsertMany = db.transaction((items: Review[]) => {
    for (const r of items) {
      const key = reviewKey(orgId, r);
      const exists = existsStmt.get(key);
      insertStmt.run({
        org_id: orgId,
        review_key: key,
        author_name: r.author_name,
        author_icon_url: r.author_icon_url,
        author_profile_url: r.author_profile_url,
        date: r.date,
        text: r.text,
        stars: r.stars,
        likes: r.likes,
        dislikes: r.dislikes,
        review_url: r.review_url,
        business_response: r.business_response,
      });
      if (exists) updated++; else added++;
    }
  });

  upsertMany(reviews);
  return { added, updated };
}

export function queryReviews(db: Database.Database, orgId: string, opts: QueryReviewsOpts = {}): ReviewRow[] {
  const conditions = ['org_id = ?'];
  const params: (string | number)[] = [orgId];

  if (opts.since) {
    conditions.push('date >= ?');
    params.push(opts.since);
  }
  if (opts.starsMin != null) {
    conditions.push('stars >= ?');
    params.push(opts.starsMin);
  }
  if (opts.starsMax != null) {
    conditions.push('stars <= ?');
    params.push(opts.starsMax);
  }

  const where = conditions.join(' AND ');
  const limit = opts.limit ? `LIMIT ${opts.limit}` : '';
  return db.prepare(`SELECT * FROM reviews WHERE ${where} ORDER BY date DESC ${limit}`).all(...params) as ReviewRow[];
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/db/reviews.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/reviews.ts tests/db/reviews.test.ts
git commit -m "feat: review upsert with dedup keys + query with filters"
```

---

## Task 6: Database Operations — Competitors and Sync Log

**Files:**
- Create: `src/db/competitors.ts`
- Create: `src/db/sync-log.ts`
- Create: `tests/db/competitors.test.ts`
- Create: `tests/db/sync-log.test.ts`

**Step 1: Write competitors test**

```typescript
// tests/db/competitors.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/schema.js';
import { upsertCompany } from '../../src/db/companies.js';
import { addCompetitor, removeCompetitor, getCompetitors } from '../../src/db/competitors.js';
import type Database from 'better-sqlite3';

describe('competitors', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '1', name: 'My Biz', role: 'mine' });
    upsertCompany(db, { org_id: '2', name: 'Rival A', role: 'competitor' });
    upsertCompany(db, { org_id: '3', name: 'Rival B', role: 'competitor' });
  });

  it('addCompetitor creates a relation', () => {
    addCompetitor(db, '1', '2');
    const rivals = getCompetitors(db, '1');
    assert.equal(rivals.length, 1);
    assert.equal(rivals[0].org_id, '2');
  });

  it('addCompetitor is idempotent', () => {
    addCompetitor(db, '1', '2');
    addCompetitor(db, '1', '2'); // no error
    assert.equal(getCompetitors(db, '1').length, 1);
  });

  it('removeCompetitor deletes the relation', () => {
    addCompetitor(db, '1', '2');
    addCompetitor(db, '1', '3');
    removeCompetitor(db, '1', '2');
    const rivals = getCompetitors(db, '1');
    assert.equal(rivals.length, 1);
    assert.equal(rivals[0].org_id, '3');
  });

  it('getCompetitors returns empty for org with no competitors', () => {
    assert.equal(getCompetitors(db, '1').length, 0);
  });
});
```

**Step 2: Write sync-log test**

```typescript
// tests/db/sync-log.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/schema.js';
import { upsertCompany } from '../../src/db/companies.js';
import { logSync, getLastSync } from '../../src/db/sync-log.js';
import type Database from 'better-sqlite3';

describe('sync-log', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '111', name: 'Test', role: 'mine' });
  });

  it('logSync records a sync and getLastSync retrieves it', () => {
    logSync(db, {
      org_id: '111', sync_type: 'full',
      reviews_added: 50, reviews_updated: 0,
      started_at: '2025-01-01T08:00:00Z',
      finished_at: '2025-01-01T08:05:00Z',
      status: 'ok',
    });
    const last = getLastSync(db, '111');
    assert.ok(last);
    assert.equal(last!.sync_type, 'full');
    assert.equal(last!.reviews_added, 50);
  });

  it('getLastSync returns undefined when no syncs exist', () => {
    assert.equal(getLastSync(db, '111'), undefined);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx tsx --test tests/db/competitors.test.ts tests/db/sync-log.test.ts`
Expected: FAIL

**Step 4: Write competitors implementation**

```typescript
// src/db/competitors.ts
import type Database from 'better-sqlite3';
import type { CompanyRow } from './companies.js';

export function addCompetitor(db: Database.Database, companyOrgId: string, competitorOrgId: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO company_relations (company_org_id, competitor_org_id)
    VALUES (?, ?)
  `).run(companyOrgId, competitorOrgId);
}

export function removeCompetitor(db: Database.Database, companyOrgId: string, competitorOrgId: string): void {
  db.prepare('DELETE FROM company_relations WHERE company_org_id = ? AND competitor_org_id = ?')
    .run(companyOrgId, competitorOrgId);
}

export function getCompetitors(db: Database.Database, companyOrgId: string): CompanyRow[] {
  return db.prepare(`
    SELECT c.* FROM companies c
    JOIN company_relations cr ON cr.competitor_org_id = c.org_id
    WHERE cr.company_org_id = ?
    ORDER BY c.name
  `).all(companyOrgId) as CompanyRow[];
}
```

**Step 5: Write sync-log implementation**

```typescript
// src/db/sync-log.ts
import type Database from 'better-sqlite3';

export interface SyncLogRow {
  id: number;
  org_id: string;
  sync_type: string;
  reviews_added: number;
  reviews_updated: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_message: string | null;
}

export interface LogSyncInput {
  org_id: string;
  sync_type: 'full' | 'incremental';
  reviews_added: number;
  reviews_updated: number;
  started_at: string;
  finished_at?: string;
  status: 'ok' | 'error';
  error_message?: string;
}

export function logSync(db: Database.Database, input: LogSyncInput): void {
  db.prepare(`
    INSERT INTO sync_log (org_id, sync_type, reviews_added, reviews_updated, started_at, finished_at, status, error_message)
    VALUES (@org_id, @sync_type, @reviews_added, @reviews_updated, @started_at, @finished_at, @status, @error_message)
  `).run({
    org_id: input.org_id,
    sync_type: input.sync_type,
    reviews_added: input.reviews_added,
    reviews_updated: input.reviews_updated,
    started_at: input.started_at,
    finished_at: input.finished_at ?? null,
    status: input.status,
    error_message: input.error_message ?? null,
  });
}

export function getLastSync(db: Database.Database, orgId: string): SyncLogRow | undefined {
  return db.prepare(
    'SELECT * FROM sync_log WHERE org_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orgId) as SyncLogRow | undefined;
}
```

**Step 6: Run tests to verify they pass**

Run: `npx tsx --test tests/db/competitors.test.ts tests/db/sync-log.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/db/competitors.ts src/db/sync-log.ts tests/db/competitors.test.ts tests/db/sync-log.test.ts
git commit -m "feat: competitor relations + sync log DB operations"
```

---

## Task 7: Scraper — Selectors and Types

**Files:**
- Create: `src/scraper/selectors.ts`

**Step 1: Port selectors from ya-reviews-mcp**

```typescript
// src/scraper/selectors.ts
// CSS selectors for Yandex Maps DOM parsing
// Ported from ya-reviews-mcp reviews/scraper.py

export const SEL = {
  // Review elements
  REVIEW: '.business-reviews-card-view__review',
  AUTHOR_NAME: "[itemprop='name']",
  DATE: "meta[itemprop='datePublished']",
  RATING: "meta[itemprop='ratingValue']",
  RATING_STARS: '.business-rating-badge-view__stars._spacing_normal > span',
  TEXT: '.business-review-view__body',
  TEXT_SPOILER: '.spoiler-view__text-container',
  AVATAR: '.user-icon-view__icon',
  PROFILE_LINK: '.business-review-view__link',
  BIZ_COMMENT_EXPAND: '.business-review-view__comment-expand',
  BIZ_COMMENT_TEXT: '.business-review-comment-content__bubble',
  REACTIONS_CONTAINER: '.business-reactions-view__container',
  REACTIONS_COUNTER: '.business-reactions-view__counter',

  // Company info
  COMPANY_NAME: 'h1.orgpage-header-view__header',
  COMPANY_RATING: '.business-summary-rating-badge-view__rating',
  COMPANY_REVIEW_COUNT: "meta[itemprop='reviewCount']",
  COMPANY_ADDRESS: "[class*='business-contacts-view__address-link']",
  COMPANY_CATEGORIES: '.business-categories-view__category',

  // Page verification
  PAGE_EXISTS: "[class*='orgpage-header'], [class*='business-card']",
} as const;

export const REVIEWS_URL_TEMPLATE = 'https://yandex.ru/maps/org/{org_id}/reviews/';
export const REVIEW_URL_TEMPLATE =
  'https://yandex.ru/maps/org/{org_id}/reviews?reviews%5BpublicId%5D={public_id}&utm_source=review';

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];
```

**Step 2: Commit**

```bash
git add src/scraper/selectors.ts
git commit -m "feat: port CSS selectors from ya-reviews-mcp"
```

---

## Task 8: Scraper — Browser Lifecycle

**Files:**
- Create: `src/scraper/browser.ts`

This module manages browser creation with 3 backends: Patchright (default), Playwright, remote CDP. Port from ya-reviews-mcp's backend classes.

**Step 1: Write browser module**

```typescript
// src/scraper/browser.ts
import type { Config } from '../config.js';
import { LAUNCH_ARGS, USER_AGENT } from './selectors.js';

// We use `any` for Playwright types since the browser package is optional
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwModule = any;

export interface BrowserInstance {
  browser: any;
  pw: any;
  handlesWebdriver: boolean;
  close: () => Promise<void>;
  newContext: (opts?: Record<string, unknown>) => Promise<any>;
}

async function importPatchright(): Promise<PwModule> {
  try {
    const mod = await import('patchright');
    return mod;
  } catch {
    throw new Error(
      'Patchright is not installed. Run: npx patchright install chromium\n' +
      'Or use --backend playwright instead.'
    );
  }
}

async function importPlaywright(): Promise<PwModule> {
  try {
    const mod = await import('playwright');
    return mod;
  } catch {
    throw new Error(
      'Playwright is not installed. Run: npx playwright install chromium\n' +
      'Or use --backend patchright instead.'
    );
  }
}

export async function createBrowser(cfg: Config): Promise<BrowserInstance> {
  const backend = cfg.browserBackend;

  if (backend === 'remote') {
    if (!cfg.browserWsUrl) {
      throw new Error('BROWSER_WS_URL is required for remote backend');
    }
    const pw = await importPlaywright();
    const pwInstance = await pw.chromium.launch();
    // Actually, for remote we connect instead of launch
    const pwApi = await pw.chromium.connectOverCDP(cfg.browserWsUrl);
    return {
      browser: pwApi,
      pw,
      handlesWebdriver: false,
      close: async () => { await pwApi.close(); },
      newContext: (opts) => pwApi.newContext({
        locale: cfg.browserLocale,
        viewport: { width: 1280, height: 720 },
        userAgent: USER_AGENT,
        ...opts,
      }),
    };
  }

  if (backend === 'playwright') {
    const pw = await importPlaywright();
    const browser = await pw.chromium.launch({
      headless: cfg.browserHeadless,
      args: LAUNCH_ARGS,
    });
    return {
      browser,
      pw,
      handlesWebdriver: false,
      close: async () => { await browser.close(); },
      newContext: (opts) => browser.newContext({
        locale: cfg.browserLocale,
        viewport: { width: 1280, height: 720 },
        userAgent: USER_AGENT,
        ...opts,
      }),
    };
  }

  // Default: patchright
  const pw = await importPatchright();
  const browser = await pw.chromium.launch({
    headless: cfg.browserHeadless,
    args: LAUNCH_ARGS,
  });
  return {
    browser,
    pw,
    handlesWebdriver: true,
    close: async () => { await browser.close(); },
    newContext: (opts) => browser.newContext({
      locale: cfg.browserLocale,
      viewport: { width: 1280, height: 720 },
      userAgent: USER_AGENT,
      ...opts,
    }),
  };
}
```

**Note:** The remote CDP backend will need refinement once tested against a real remote browser. The `connectOverCDP` path may differ between Playwright and Patchright — test both.

**Step 2: Commit**

```bash
git add src/scraper/browser.ts
git commit -m "feat: browser lifecycle — patchright/playwright/remote backends"
```

---

## Task 9: Scraper — Review Parsing and Company Info

**Files:**
- Create: `src/scraper/reviews.ts`
- Create: `src/scraper/company.ts`

This is the main scraper logic, ported from ya-reviews-mcp's `scraper.py`. Since it depends on a real browser and DOM, testing requires integration tests (Task 14). For now, we write the code and verify it compiles.

**Step 1: Write company info scraper**

```typescript
// src/scraper/company.ts
import { SEL } from './selectors.js';
import type { CompanyInfo } from '../types/index.js';

export async function parseCompanyInfo(page: any): Promise<CompanyInfo> {
  const name = await getText(page, SEL.COMPANY_NAME);

  const ratingText = await getText(page, SEL.COMPANY_RATING);
  const rating = extractRating(ratingText);

  const reviewCountStr = await getAttr(page, SEL.COMPANY_REVIEW_COUNT, 'content');
  const review_count = reviewCountStr ? parseInt(reviewCountStr, 10) : null;

  const address = await getText(page, SEL.COMPANY_ADDRESS);

  const catEls = await page.querySelectorAll(SEL.COMPANY_CATEGORIES);
  const categories: string[] = [];
  for (const el of catEls) {
    const text = await el.textContent();
    if (text?.trim()) categories.push(text.trim());
  }

  return { name, rating, review_count, address, categories };
}

async function getText(page: any, selector: string): Promise<string | null> {
  const el = await page.querySelector(selector);
  if (!el) return null;
  const text = await el.textContent();
  return text?.trim() || null;
}

async function getAttr(page: any, selector: string, attr: string): Promise<string | null> {
  const el = await page.querySelector(selector);
  if (!el) return null;
  return await el.getAttribute(attr);
}

export function extractRating(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d+[.,]\d+|\d+)/);
  if (match) return parseFloat(match[1].replace(',', '.'));
  return null;
}
```

**Step 2: Write reviews scraper**

```typescript
// src/scraper/reviews.ts
import type { Config } from '../config.js';
import type { Review, CompanyInfo, ScrapeResult } from '../types/index.js';
import type { BrowserInstance } from './browser.js';
import { SEL, REVIEWS_URL_TEMPLATE, REVIEW_URL_TEMPLATE } from './selectors.js';
import { parseCompanyInfo } from './company.js';

export async function scrapeReviews(
  browserInstance: BrowserInstance,
  orgId: string,
  cfg: Config,
  opts: { full?: boolean } = {},
): Promise<ScrapeResult> {
  const context = await browserInstance.newContext();

  try {
    const page = await context.newPage();

    // Hide webdriver flag if backend doesn't handle it natively
    if (!browserInstance.handlesWebdriver) {
      await page.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      `);
    }

    const url = REVIEWS_URL_TEMPLATE.replace('{org_id}', orgId);

    // Navigate with retry
    await navigateWithRetry(page, url, cfg);

    // Verify page exists
    await checkPageExists(page, orgId);

    // Wait for reviews
    await waitForReviews(page, cfg);

    // Parse company info
    const company = await parseCompanyInfo(page);
    const totalCount = company.review_count ?? 0;

    // Parse initial reviews
    let allReviews = await parseReviewsFromDom(page, orgId);

    // If full sync, scroll to load more
    if (opts.full) {
      const maxPages = cfg.maxPages;
      let prevCount = allReviews.length;

      for (let scroll = 2; scroll <= maxPages; scroll++) {
        await scrollToLoadMore(page, cfg);
        allReviews = await parseReviewsFromDom(page, orgId);
        if (allReviews.length <= prevCount) break;
        prevCount = allReviews.length;
      }
    }

    return {
      company,
      reviews: allReviews,
      total_count: totalCount || allReviews.length,
    };
  } finally {
    await context.close();
  }
}

async function navigateWithRetry(page: any, url: string, cfg: Config): Promise<void> {
  for (let attempt = 1; attempt <= cfg.scraperRetries; attempt++) {
    try {
      await page.goto(url, { timeout: cfg.pageTimeout, waitUntil: 'domcontentloaded' });
      return;
    } catch (err) {
      if (attempt < cfg.scraperRetries) {
        await sleep(cfg.scraperRetryDelay * attempt * 1000);
      } else {
        throw new Error(`Failed to load ${url} after ${attempt} attempts: ${err}`);
      }
    }
  }
}

async function checkPageExists(page: any, orgId: string): Promise<void> {
  try {
    await page.waitForSelector(SEL.PAGE_EXISTS, { timeout: 10000 });
  } catch {
    const title = await page.title();
    if (title.includes('404') || title.toLowerCase().includes('не найден')) {
      throw new Error(`Business with org_id=${orgId} not found`);
    }
  }
}

async function waitForReviews(page: any, cfg: Config): Promise<void> {
  try {
    await page.waitForSelector(SEL.REVIEW, { timeout: cfg.interceptTimeout });
  } catch {
    // Reviews may not be present — not fatal
  }
}

async function expandBusinessResponses(page: any): Promise<void> {
  await page.evaluate(`
    (() => {
      const btns = document.querySelectorAll('.business-review-view__comment-expand');
      btns.forEach(btn => {
        if (btn.textContent.includes('Посмотреть')) btn.click();
      });
    })()
  `);
  await sleep(2000);
}

async function parseReviewsFromDom(page: any, orgId: string): Promise<Review[]> {
  await expandBusinessResponses(page);
  const reviewEls = await page.querySelectorAll(SEL.REVIEW);
  const reviews: Review[] = [];

  for (const el of reviewEls) {
    // Author name
    const nameEl = await el.querySelector(SEL.AUTHOR_NAME);
    const nameText = nameEl ? await nameEl.textContent() : null;
    const author_name = nameText?.trim() || null;

    // Avatar URL from style attribute
    const avatarEl = await el.querySelector(SEL.AVATAR);
    const author_icon_url = await extractAvatarUrl(avatarEl);

    // Author profile URL + review URL
    const profileEl = await el.querySelector(SEL.PROFILE_LINK);
    const author_profile_url = profileEl ? await profileEl.getAttribute('href') : null;
    const review_url = buildReviewUrl(orgId, author_profile_url);

    // Date
    const dateEl = await el.querySelector(SEL.DATE);
    const date = dateEl ? await dateEl.getAttribute('content') : null;

    // Stars — try meta tag first, then count star spans
    const ratingEl = await el.querySelector(SEL.RATING);
    let stars = 0;
    if (ratingEl) {
      const ratingStr = await ratingEl.getAttribute('content');
      stars = ratingStr ? parseFloat(ratingStr.replace(',', '.')) || 0 : 0;
    } else {
      stars = await countStars(el);
    }

    // Text — prefer spoiler container, fall back to body
    let textContainer = await el.querySelector(SEL.TEXT_SPOILER);
    if (!textContainer) textContainer = await el.querySelector(SEL.TEXT);
    const rawText = textContainer ? await textContainer.textContent() : null;
    const text = rawText?.trim() || null;

    // Likes and dislikes
    const { likes, dislikes } = await extractReactions(el);

    // Business response
    const business_response = await extractBusinessResponse(el);

    reviews.push({
      author_name, author_icon_url, author_profile_url,
      date, text, stars, likes, dislikes, review_url, business_response,
    });
  }

  return reviews;
}

async function scrollToLoadMore(page: any, cfg: Config): Promise<void> {
  await page.evaluate(`
    (() => {
      const reviews = document.querySelectorAll('.business-reviews-card-view__review');
      if (reviews.length > 0) {
        reviews[reviews.length - 1].scrollIntoView();
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
    })()
  `);
  await sleep(cfg.requestDelay * 1000);
}

async function extractAvatarUrl(avatarEl: any): Promise<string | null> {
  if (!avatarEl) return null;
  const style = await avatarEl.getAttribute('style');
  if (!style) return null;
  const match = style.match(/url\(["']?(.*?)["']?\)/);
  return match ? match[1] : null;
}

async function countStars(reviewEl: any): Promise<number> {
  const starEls = await reviewEl.querySelectorAll('.business-rating-badge-view__stars span');
  let rating = 0;
  for (const star of starEls) {
    const cls = (await star.getAttribute('class')) ?? '';
    if (cls.includes('_empty')) continue;
    else if (cls.includes('_half')) rating += 0.5;
    else rating += 1.0;
  }
  return rating;
}

async function extractReactions(reviewEl: any): Promise<{ likes: number; dislikes: number }> {
  const containers = await reviewEl.querySelectorAll(SEL.REACTIONS_CONTAINER);
  let likes = 0;
  let dislikes = 0;
  for (const container of containers) {
    const label = (await container.getAttribute('aria-label')) ?? '';
    const counterEl = await container.querySelector(SEL.REACTIONS_COUNTER);
    const countText = counterEl ? await counterEl.textContent() : '0';
    const count = parseInt(countText, 10) || 0;
    if (label.includes('Лайк')) likes = count;
    else if (label.includes('Дизлайк')) dislikes = count;
  }
  return { likes, dislikes };
}

async function extractBusinessResponse(reviewEl: any): Promise<string | null> {
  const bubble = await reviewEl.querySelector(SEL.BIZ_COMMENT_TEXT);
  if (!bubble) return null;
  const text = await bubble.textContent();
  return text?.trim() || null;
}

function buildReviewUrl(orgId: string, profileUrl: string | null): string | null {
  if (!profileUrl) return null;
  const publicId = profileUrl.replace(/\/$/, '').split('/').pop();
  if (!publicId) return null;
  return REVIEW_URL_TEMPLATE
    .replace('{org_id}', orgId)
    .replace('{public_id}', publicId);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/scraper/reviews.ts src/scraper/company.ts
git commit -m "feat: port Yandex Maps scraper — review parsing, company info, pagination"
```

---

## Task 10: CLI — Output Helpers

**Files:**
- Create: `src/cli/helpers.ts`

**Step 1: Write output helper**

```typescript
// src/cli/helpers.ts

export function isJsonMode(opts: { json?: boolean }): boolean {
  return opts.json === true || !process.stdout.isTTY;
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );
  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');

  const fmtRow = (cells: string[]) =>
    cells.map((c, i) => ` ${(c ?? '').padEnd(widths[i])} `).join('│');

  console.log(fmtRow(headers));
  console.log(sep);
  for (const row of rows) {
    console.log(fmtRow(row));
  }
}

export function truncate(s: string | null, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
```

**Step 2: Commit**

```bash
git add src/cli/helpers.ts
git commit -m "feat: CLI output helpers — JSON/table auto-detect"
```

---

## Task 11: CLI — init, track, untrack, companies, status

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/init.ts`
- Create: `src/cli/track.ts`
- Create: `src/cli/untrack.ts`
- Create: `src/cli/companies.ts`
- Create: `src/cli/status.ts`

**Step 1: Write CLI registry**

```typescript
// src/cli/index.ts
import { Command } from 'commander';
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

import { initCommand } from './init.js';
import { trackCommand } from './track.js';
import { untrackCommand } from './untrack.js';
import { companiesCommand } from './companies.js';
import { statusCommand } from './status.js';
import { syncCommand } from './sync.js';
import { reviewsCommand } from './reviews.js';
import { competitorCommand } from './competitor.js';
import { compareCommand } from './compare.js';
import { queryCommand } from './query.js';
import { daemonCommand } from './daemon.js';

export const program = new Command();
program
  .name('yarev')
  .description('Yandex Maps review tracker — scrape, store, compare')
  .version(version);

program.addCommand(initCommand);
program.addCommand(trackCommand);
program.addCommand(untrackCommand);
program.addCommand(companiesCommand);
program.addCommand(statusCommand);
program.addCommand(syncCommand);
program.addCommand(reviewsCommand);
program.addCommand(competitorCommand);
program.addCommand(compareCommand);
program.addCommand(queryCommand);
program.addCommand(daemonCommand);
```

**Note:** This file imports all commands. Some commands (sync, reviews, competitor, compare, query, daemon) don't exist yet — create stub files that export empty commands to make the project compile. Then implement each in the following tasks.

**Step 2: Write init command**

```typescript
// src/cli/init.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { execSync } from 'node:child_process';
import type { BrowserBackend } from '../types/index.js';

export const initCommand = new Command('init')
  .description('Initialize database and install browser')
  .option('--backend <backend>', 'Browser to install: patchright, playwright', config.browserBackend)
  .action((opts) => {
    // Create DB
    const db = openDb(config.dbPath);
    db.close();
    console.log(`Database created at ${config.dbPath}`);

    // Install browser
    const backend = opts.backend as BrowserBackend;
    try {
      if (backend === 'patchright') {
        console.log('Installing Patchright Chromium...');
        execSync('npx patchright install chromium', { stdio: 'inherit' });
      } else if (backend === 'playwright') {
        console.log('Installing Playwright Chromium...');
        execSync('npx playwright install chromium', { stdio: 'inherit' });
      } else {
        console.log('Remote backend selected — no local browser to install.');
      }
      console.log('Done. Run `yarev track <org_id>` to start tracking an organization.');
    } catch (err) {
      console.error(`Failed to install browser: ${err}`);
      process.exit(1);
    }
  });
```

**Step 3: Write track command**

```typescript
// src/cli/track.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { upsertCompany, getCompany } from '../db/companies.js';
import type { CompanyRole } from '../types/index.js';

export const trackCommand = new Command('track')
  .description('Start tracking a Yandex Maps organization')
  .argument('<org_id>', 'Yandex Maps organization ID')
  .option('--name <name>', 'Business name (auto-detected on first sync)')
  .option('--role <role>', 'Role: mine, competitor, tracked', 'tracked')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);
    const existing = getCompany(db, orgId);
    upsertCompany(db, {
      org_id: orgId,
      name: opts.name,
      role: opts.role as CompanyRole,
    });
    if (existing) {
      console.log(`Updated org ${orgId} (role: ${opts.role})`);
    } else {
      console.log(`Now tracking org ${orgId} (role: ${opts.role})`);
      console.log('Run `yarev sync --org ' + orgId + ' --full` for initial full scrape.');
    }
    db.close();
  });
```

**Step 4: Write untrack command**

```typescript
// src/cli/untrack.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { removeCompany, getCompany } from '../db/companies.js';

export const untrackCommand = new Command('untrack')
  .description('Stop tracking an organization and remove its data')
  .argument('<org_id>', 'Yandex Maps organization ID')
  .action((orgId: string) => {
    const db = openDb(config.dbPath);
    const company = getCompany(db, orgId);
    if (!company) {
      console.error(`Organization ${orgId} is not being tracked.`);
      process.exit(1);
    }
    removeCompany(db, orgId);
    console.log(`Stopped tracking ${company.name ?? orgId}. All data removed.`);
    db.close();
  });
```

**Step 5: Write companies command**

```typescript
// src/cli/companies.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';
import type { CompanyRole } from '../types/index.js';

export const companiesCommand = new Command('companies')
  .description('List tracked companies')
  .option('--role <role>', 'Filter by role: mine, competitor, tracked')
  .option('--json', 'Force JSON output')
  .action((opts) => {
    const db = openDb(config.dbPath);
    const companies = listCompanies(db, opts.role as CompanyRole | undefined);

    if (isJsonMode(opts)) {
      outputJson(companies.map(c => ({
        org_id: c.org_id,
        name: c.name,
        rating: c.rating,
        review_count: c.review_count,
        role: c.role,
        address: c.address,
      })));
    } else {
      if (companies.length === 0) {
        console.log('No companies tracked. Run `yarev track <org_id>` to start.');
        return;
      }
      outputTable(
        ['org_id', 'name', 'rating', 'reviews', 'role'],
        companies.map(c => [
          c.org_id,
          truncate(c.name, 30),
          c.rating?.toFixed(1) ?? '—',
          String(c.review_count ?? '—'),
          c.role,
        ]),
      );
    }
    db.close();
  });
```

**Step 6: Write status command**

```typescript
// src/cli/status.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { getLastSync } from '../db/sync-log.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const statusCommand = new Command('status')
  .description('Show sync status for all tracked companies')
  .option('--json', 'Force JSON output')
  .action((opts) => {
    const db = openDb(config.dbPath);
    const companies = listCompanies(db);

    const statuses = companies.map(c => {
      const last = getLastSync(db, c.org_id);
      const reviewCount = db.prepare('SELECT COUNT(*) as cnt FROM reviews WHERE org_id = ?')
        .get(c.org_id) as { cnt: number };
      return {
        org_id: c.org_id,
        name: c.name,
        role: c.role,
        reviews_in_db: reviewCount.cnt,
        last_sync: last?.finished_at ?? 'never',
        last_sync_type: last?.sync_type ?? '—',
        last_status: last?.status ?? '—',
      };
    });

    if (isJsonMode(opts)) {
      outputJson(statuses);
    } else {
      if (statuses.length === 0) {
        console.log('No companies tracked.');
        return;
      }
      outputTable(
        ['org_id', 'name', 'reviews', 'last sync', 'type', 'status'],
        statuses.map(s => [
          s.org_id,
          s.name ?? '—',
          String(s.reviews_in_db),
          s.last_sync,
          s.last_sync_type,
          s.last_status,
        ]),
      );
    }
    db.close();
  });
```

**Step 7: Create stub files for commands not yet implemented**

Create stub files for: `sync.ts`, `reviews.ts`, `competitor.ts`, `compare.ts`, `query.ts`, `daemon.ts`. Each exports a Command with a placeholder action.

Example stub:
```typescript
// src/cli/sync.ts (stub — implemented in Task 12)
import { Command } from 'commander';
export const syncCommand = new Command('sync')
  .description('Sync reviews for tracked organizations')
  .action(() => { console.log('Not implemented yet'); });
```

Create similar stubs for reviews, competitor, compare, query, daemon.

**Step 8: Verify compilation and basic run**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npx tsx src/index.ts --help`
Expected: Shows yarev help with all commands listed

**Step 9: Commit**

```bash
git add src/cli/
git commit -m "feat: CLI framework — init, track, untrack, companies, status commands"
```

---

## Task 12: CLI — sync Command

**Files:**
- Modify: `src/cli/sync.ts` (replace stub)

This is the core command. It calls the scraper, upserts results into SQLite, and logs the sync.

**Step 1: Write sync command**

```typescript
// src/cli/sync.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies, upsertCompany } from '../db/companies.js';
import { upsertReviews } from '../db/reviews.js';
import { logSync } from '../db/sync-log.js';
import { createBrowser } from '../scraper/browser.js';
import { scrapeReviews } from '../scraper/reviews.js';
import { isJsonMode, outputJson } from './helpers.js';
import type { BrowserBackend } from '../types/index.js';

export const syncCommand = new Command('sync')
  .description('Sync reviews for tracked organizations')
  .option('--org <org_id>', 'Sync only this organization')
  .option('--full', 'Force full scrape (scroll all pages)', false)
  .option('--backend <backend>', 'Override browser backend')
  .option('--browser-url <url>', 'Remote browser WebSocket URL')
  .option('--json', 'Force JSON output')
  .action(async (opts) => {
    const db = openDb(config.dbPath);
    const cfg = {
      ...config,
      ...(opts.backend ? { browserBackend: opts.backend as BrowserBackend } : {}),
      ...(opts.browserUrl ? { browserWsUrl: opts.browserUrl } : {}),
    };

    const companies = opts.org
      ? listCompanies(db).filter(c => c.org_id === opts.org)
      : listCompanies(db);

    if (companies.length === 0) {
      console.error(opts.org
        ? `Organization ${opts.org} is not being tracked.`
        : 'No companies tracked. Run `yarev track <org_id>` first.');
      process.exit(1);
    }

    let browser;
    try {
      browser = await createBrowser(cfg);
    } catch (err) {
      console.error(`Failed to start browser: ${err}`);
      process.exit(1);
    }

    const results = [];

    for (const company of companies) {
      const startedAt = new Date().toISOString();
      const isFull = opts.full || !db.prepare(
        'SELECT id FROM sync_log WHERE org_id = ? AND status = ? LIMIT 1'
      ).get(company.org_id, 'ok');

      try {
        if (!isJsonMode(opts)) {
          console.log(`Syncing ${company.name ?? company.org_id} (${isFull ? 'full' : 'incremental'})...`);
        }

        const result = await scrapeReviews(browser, company.org_id, cfg, { full: isFull });

        // Update company metadata
        upsertCompany(db, {
          org_id: company.org_id,
          name: result.company.name,
          rating: result.company.rating,
          review_count: result.company.review_count,
          address: result.company.address,
          categories: result.company.categories,
          role: company.role,
        });

        // Upsert reviews
        const { added, updated } = upsertReviews(db, company.org_id, result.reviews);

        const finishedAt = new Date().toISOString();
        logSync(db, {
          org_id: company.org_id,
          sync_type: isFull ? 'full' : 'incremental',
          reviews_added: added,
          reviews_updated: updated,
          started_at: startedAt,
          finished_at: finishedAt,
          status: 'ok',
        });

        const summary = {
          org_id: company.org_id,
          name: result.company.name,
          sync_type: isFull ? 'full' : 'incremental',
          reviews_scraped: result.reviews.length,
          reviews_added: added,
          reviews_updated: updated,
          status: 'ok',
        };
        results.push(summary);

        if (!isJsonMode(opts)) {
          console.log(`  ${added} added, ${updated} updated (${result.reviews.length} scraped)`);
        }
      } catch (err) {
        const finishedAt = new Date().toISOString();
        logSync(db, {
          org_id: company.org_id,
          sync_type: isFull ? 'full' : 'incremental',
          reviews_added: 0,
          reviews_updated: 0,
          started_at: startedAt,
          finished_at: finishedAt,
          status: 'error',
          error_message: String(err),
        });

        results.push({
          org_id: company.org_id,
          name: company.name,
          status: 'error',
          error: String(err),
        });

        if (!isJsonMode(opts)) {
          console.error(`  Error: ${err}`);
        }
      }
    }

    await browser.close();
    db.close();

    if (isJsonMode(opts)) {
      outputJson(results);
    }
  });
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cli/sync.ts
git commit -m "feat: sync command — full + incremental scraping with upsert"
```

---

## Task 13: CLI — reviews, query, competitor, compare

**Files:**
- Modify: `src/cli/reviews.ts` (replace stub)
- Modify: `src/cli/query.ts` (replace stub)
- Modify: `src/cli/competitor.ts` (replace stub)
- Modify: `src/cli/compare.ts` (replace stub)

**Step 1: Write reviews command**

```typescript
// src/cli/reviews.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { queryReviews } from '../db/reviews.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const reviewsCommand = new Command('reviews')
  .description('Query reviews for an organization')
  .argument('<org_id>', 'Organization ID')
  .option('--since <date>', 'Reviews since date (YYYY-MM-DD)')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--limit <n>', 'Max results')
  .option('--json', 'Force JSON output')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);

    let starsMin: number | undefined;
    let starsMax: number | undefined;
    if (opts.stars) {
      const parts = opts.stars.split('-');
      starsMin = parseFloat(parts[0]);
      starsMax = parts.length > 1 ? parseFloat(parts[1]) : starsMin;
    }

    const reviews = queryReviews(db, orgId, {
      since: opts.since,
      starsMin,
      starsMax,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });

    if (isJsonMode(opts)) {
      outputJson(reviews);
    } else {
      if (reviews.length === 0) {
        console.log('No reviews found.');
        return;
      }
      outputTable(
        ['date', 'stars', 'author', 'text', 'response'],
        reviews.map(r => [
          r.date ?? '—',
          String(r.stars),
          truncate(r.author_name, 15),
          truncate(r.text, 40),
          r.business_response ? 'yes' : '',
        ]),
      );
      console.log(`\n${reviews.length} reviews`);
    }
    db.close();
  });
```

**Step 2: Write query command**

Pattern: copy directly from hae-vault `src/cli/query.ts`.

```typescript
// src/cli/query.ts
import { Command } from 'commander';
import { openDb } from '../db/schema.js';
import { config } from '../config.js';

export const queryCommand = new Command('query')
  .description('Run raw SQL against the reviews database (returns JSON)')
  .argument('<sql>', 'SQL query to run')
  .option('--pretty', 'Pretty-print JSON', false)
  .action((sql: string, opts) => {
    const db = openDb(config.dbPath);
    try {
      const rows = db.prepare(sql).all();
      console.log(opts.pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows));
    } catch (err) {
      console.error(JSON.stringify({ error: String(err) }));
      process.exit(1);
    }
    db.close();
  });
```

**Step 3: Write competitor command**

```typescript
// src/cli/competitor.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getCompany } from '../db/companies.js';
import { addCompetitor, removeCompetitor, getCompetitors } from '../db/competitors.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const competitorCommand = new Command('competitor')
  .description('Manage competitor relationships');

competitorCommand
  .command('add')
  .description('Add a competitor to a company')
  .requiredOption('--org <org_id>', 'Your company org ID')
  .requiredOption('--competitor <org_id>', 'Competitor org ID')
  .action((opts) => {
    const db = openDb(config.dbPath);
    if (!getCompany(db, opts.org)) {
      console.error(`Company ${opts.org} not tracked. Run \`yarev track ${opts.org}\` first.`);
      process.exit(1);
    }
    if (!getCompany(db, opts.competitor)) {
      console.error(`Competitor ${opts.competitor} not tracked. Run \`yarev track ${opts.competitor}\` first.`);
      process.exit(1);
    }
    addCompetitor(db, opts.org, opts.competitor);
    console.log(`Added competitor ${opts.competitor} to ${opts.org}`);
    db.close();
  });

competitorCommand
  .command('rm')
  .description('Remove a competitor from a company')
  .requiredOption('--org <org_id>', 'Your company org ID')
  .requiredOption('--competitor <org_id>', 'Competitor org ID')
  .action((opts) => {
    const db = openDb(config.dbPath);
    removeCompetitor(db, opts.org, opts.competitor);
    console.log(`Removed competitor ${opts.competitor} from ${opts.org}`);
    db.close();
  });

competitorCommand
  .command('list')
  .description('List competitors for a company')
  .requiredOption('--org <org_id>', 'Company org ID')
  .option('--json', 'Force JSON output')
  .action((opts) => {
    const db = openDb(config.dbPath);
    const competitors = getCompetitors(db, opts.org);

    if (isJsonMode(opts)) {
      outputJson(competitors.map(c => ({
        org_id: c.org_id, name: c.name, rating: c.rating, review_count: c.review_count,
      })));
    } else {
      if (competitors.length === 0) {
        console.log('No competitors configured.');
        return;
      }
      outputTable(
        ['org_id', 'name', 'rating', 'reviews'],
        competitors.map(c => [
          c.org_id, c.name ?? '—', c.rating?.toFixed(1) ?? '—', String(c.review_count ?? '—'),
        ]),
      );
    }
    db.close();
  });
```

**Step 4: Write compare command**

```typescript
// src/cli/compare.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getCompany } from '../db/companies.js';
import { getCompetitors } from '../db/competitors.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const compareCommand = new Command('compare')
  .description('Compare your company against its competitors')
  .requiredOption('--org <org_id>', 'Your company org ID')
  .option('--json', 'Force JSON output')
  .action((opts) => {
    const db = openDb(config.dbPath);
    const company = getCompany(db, opts.org);
    if (!company) {
      console.error(`Company ${opts.org} not tracked.`);
      process.exit(1);
    }

    const competitors = getCompetitors(db, opts.org);

    // Calculate avg stars from local DB
    const avgStars = (orgId: string): number | null => {
      const row = db.prepare(
        'SELECT AVG(stars) as avg FROM reviews WHERE org_id = ?'
      ).get(orgId) as { avg: number | null } | undefined;
      return row?.avg ?? null;
    };

    const reviewCount = (orgId: string): number => {
      const row = db.prepare(
        'SELECT COUNT(*) as cnt FROM reviews WHERE org_id = ?'
      ).get(orgId) as { cnt: number };
      return row.cnt;
    };

    const companyData = {
      org_id: company.org_id,
      name: company.name,
      rating: company.rating,
      review_count: company.review_count,
      reviews_in_db: reviewCount(company.org_id),
      avg_stars: avgStars(company.org_id),
    };

    const competitorData = competitors.map(c => ({
      org_id: c.org_id,
      name: c.name,
      rating: c.rating,
      review_count: c.review_count,
      reviews_in_db: reviewCount(c.org_id),
      avg_stars: avgStars(c.org_id),
    }));

    if (isJsonMode(opts)) {
      outputJson({ company: companyData, competitors: competitorData });
    } else {
      const all = [companyData, ...competitorData];
      outputTable(
        ['', 'org_id', 'name', 'rating', 'reviews', 'in DB', 'avg stars'],
        all.map((c, i) => [
          i === 0 ? '>>>' : '   ',
          c.org_id,
          c.name ?? '—',
          c.rating?.toFixed(1) ?? '—',
          String(c.review_count ?? '—'),
          String(c.reviews_in_db),
          c.avg_stars?.toFixed(2) ?? '—',
        ]),
      );
    }
    db.close();
  });
```

**Step 5: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/cli/reviews.ts src/cli/query.ts src/cli/competitor.ts src/cli/compare.ts
git commit -m "feat: reviews, query, competitor, compare CLI commands"
```

---

## Task 14: CLI — daemon Command

**Files:**
- Modify: `src/cli/daemon.ts` (replace stub)

**Step 1: Write daemon command**

```typescript
// src/cli/daemon.ts
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies, upsertCompany } from '../db/companies.js';
import { upsertReviews } from '../db/reviews.js';
import { logSync } from '../db/sync-log.js';
import { createBrowser } from '../scraper/browser.js';
import { scrapeReviews } from '../scraper/reviews.js';

export const daemonCommand = new Command('daemon')
  .description('Run scheduled sync in the background')
  .option('--cron <expression>', 'Cron expression for schedule', config.daemonCron)
  .action(async (opts) => {
    let nodeCron;
    try {
      nodeCron = await import('node-cron');
    } catch {
      console.error('node-cron not available. Install with: npm install node-cron');
      process.exit(1);
    }

    console.log(`Starting daemon with schedule: ${opts.cron}`);

    const runSync = async () => {
      const db = openDb(config.dbPath);
      const companies = listCompanies(db);
      if (companies.length === 0) {
        console.log(`[${new Date().toISOString()}] No companies to sync.`);
        db.close();
        return;
      }

      let browser;
      try {
        browser = await createBrowser(config);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Browser error: ${err}`);
        db.close();
        return;
      }

      for (const company of companies) {
        const startedAt = new Date().toISOString();
        const isFull = !db.prepare(
          'SELECT id FROM sync_log WHERE org_id = ? AND status = ? LIMIT 1'
        ).get(company.org_id, 'ok');

        try {
          console.log(`[${new Date().toISOString()}] Syncing ${company.name ?? company.org_id}...`);
          const result = await scrapeReviews(browser, company.org_id, config, { full: isFull });

          upsertCompany(db, {
            org_id: company.org_id,
            name: result.company.name,
            rating: result.company.rating,
            review_count: result.company.review_count,
            address: result.company.address,
            categories: result.company.categories,
            role: company.role,
          });

          const { added, updated } = upsertReviews(db, company.org_id, result.reviews);

          logSync(db, {
            org_id: company.org_id,
            sync_type: isFull ? 'full' : 'incremental',
            reviews_added: added,
            reviews_updated: updated,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            status: 'ok',
          });

          console.log(`  +${added} new, ~${updated} updated`);
        } catch (err) {
          logSync(db, {
            org_id: company.org_id,
            sync_type: isFull ? 'full' : 'incremental',
            reviews_added: 0,
            reviews_updated: 0,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            status: 'error',
            error_message: String(err),
          });
          console.error(`  Error: ${err}`);
        }
      }

      await browser.close();
      db.close();
    };

    // Run immediately on start
    await runSync();

    // Schedule future runs
    nodeCron.default.schedule(opts.cron, runSync);
    console.log(`Daemon running. Next sync per cron: ${opts.cron}`);
  });
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cli/daemon.ts
git commit -m "feat: daemon command — scheduled sync with node-cron"
```

---

## Task 15: Integration Test and Final Polish

**Files:**
- Create: `tests/cli/help.test.ts`
- Verify: all tests pass, project builds and runs

**Step 1: Write a basic smoke test**

```typescript
// tests/cli/help.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

describe('yarev CLI', () => {
  it('shows help text', () => {
    const output = execSync('npx tsx src/index.ts --help', { encoding: 'utf8' });
    assert.ok(output.includes('yarev'));
    assert.ok(output.includes('sync'));
    assert.ok(output.includes('track'));
    assert.ok(output.includes('compare'));
  });

  it('shows version', () => {
    const output = execSync('npx tsx src/index.ts --version', { encoding: 'utf8' });
    assert.ok(output.includes('0.1.0'));
  });
});
```

**Step 2: Run all tests**

Run: `npx tsx --test tests/**/*.test.ts`
Expected: All PASS

**Step 3: Build the project**

Run: `npx tsc`
Expected: Compiles to `dist/` with no errors

**Step 4: Test built version**

Run: `node dist/index.js --help`
Expected: Shows help text

**Step 5: Commit**

```bash
git add tests/cli/help.test.ts
git commit -m "feat: smoke test for CLI help + version"
```

---

## Task 16: Run Full Test Suite and Final Verification

**Step 1: Run all unit tests**

Run: `npx tsx --test tests/**/*.test.ts`
Expected: All PASS

**Step 2: Build**

Run: `npm run build`
Expected: Clean build

**Step 3: Manual smoke test**

```bash
# Init
npx tsx src/index.ts init --backend remote  # skip browser install
npx tsx src/index.ts companies              # should show empty
npx tsx src/index.ts track 1248139252 --role mine --name "Astra Motors"
npx tsx src/index.ts companies              # should show Astra Motors
npx tsx src/index.ts status                 # should show 'never' for last sync
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, project builds"
```

---

## Execution Summary

| Task | What it builds | Estimated steps |
|------|---------------|-----------------|
| 1 | Project scaffolding | 8 |
| 2 | Types + config | 5 |
| 3 | DB schema | 5 |
| 4 | Companies CRUD | 5 |
| 5 | Reviews upsert + query | 5 |
| 6 | Competitors + sync log | 7 |
| 7 | Scraper selectors | 2 |
| 8 | Browser lifecycle | 2 |
| 9 | Scraper (reviews + company) | 4 |
| 10 | Output helpers | 2 |
| 11 | CLI: init, track, untrack, companies, status | 9 |
| 12 | CLI: sync | 3 |
| 13 | CLI: reviews, query, competitor, compare | 6 |
| 14 | CLI: daemon | 3 |
| 15 | Smoke tests | 5 |
| 16 | Final verification | 4 |

**Total: 16 tasks, ~75 steps, ~16 commits**
