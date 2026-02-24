# AI-Friendly CLI Commands — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add five CLI commands (`stats`, `digest`, `search`, `trends`, `unanswered`) that give AI assistants fast, structured access to review data for reputation management and competitive intelligence.

**Architecture:** Each command follows the existing pattern: one file in `src/cli/`, query logic in `src/db/stats.ts` (new shared module), registered in `src/cli/index.ts`. All queries are pure SQL on the existing schema — no new tables, no new dependencies.

**Tech Stack:** TypeScript ESM, Commander.js, better-sqlite3, Node.js native test runner

---

### Task 1: DB query module — `getStats()`

**Files:**
- Create: `src/db/stats.ts`
- Create: `tests/db/stats.test.ts`

**Step 1: Write the failing test**

In `tests/db/stats.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/schema.js';
import { upsertCompany } from '../../src/db/companies.js';
import { upsertReviews } from '../../src/db/reviews.js';
import { getStats } from '../../src/db/stats.js';
import type Database from 'better-sqlite3';

const review = (overrides: Record<string, unknown> = {}) => ({
  author_name: 'Test', author_icon_url: null, author_profile_url: null,
  date: '2025-06-01', text: 'Good service', stars: 5,
  likes: 0, dislikes: 0, review_url: null, business_response: null,
  ...overrides,
});

describe('getStats', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '111', name: 'Test Corp', role: 'mine' });
  });

  it('returns star distribution and averages', () => {
    upsertReviews(db, '111', [
      review({ stars: 5, review_url: 'http://r/1' }),
      review({ stars: 5, review_url: 'http://r/2' }),
      review({ stars: 3, review_url: 'http://r/3' }),
      review({ stars: 1, review_url: 'http://r/4', business_response: 'Sorry' }),
    ]);
    const stats = getStats(db, '111');
    assert.equal(stats.total_reviews, 4);
    assert.equal(stats.star_distribution['5'], 2);
    assert.equal(stats.star_distribution['3'], 1);
    assert.equal(stats.star_distribution['1'], 1);
    assert.equal(stats.star_distribution['2'], 0);
    assert.equal(stats.avg_stars, 3.5);
    assert.equal(stats.response_rate, 0.25);
    assert.equal(stats.reviews_with_text, 4);
  });

  it('returns zeros for org with no reviews', () => {
    const stats = getStats(db, '111');
    assert.equal(stats.total_reviews, 0);
    assert.equal(stats.avg_stars, 0);
    assert.equal(stats.response_rate, 0);
  });

  it('filters by since date', () => {
    upsertReviews(db, '111', [
      review({ date: '2025-01-01', review_url: 'http://r/1' }),
      review({ date: '2025-06-01', review_url: 'http://r/2' }),
    ]);
    const stats = getStats(db, '111', { since: '2025-03-01' });
    assert.equal(stats.total_reviews, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/stats.test.ts`
Expected: FAIL — module `../../src/db/stats.js` not found

**Step 3: Write minimal implementation**

In `src/db/stats.ts`:

```typescript
import type Database from 'better-sqlite3';

export interface StatsResult {
  org_id: string;
  name: string | null;
  rating: number | null;
  total_reviews: number;
  star_distribution: Record<string, number>;
  avg_stars: number;
  response_rate: number;
  reviews_with_text: number;
  period: { first: string | null; last: string | null };
}

export interface StatsOpts {
  since?: string;
}

export function getStats(db: Database.Database, orgId: string, opts: StatsOpts = {}): StatsResult {
  const company = db.prepare('SELECT name, rating FROM companies WHERE org_id = ?').get(orgId) as
    { name: string | null; rating: number | null } | undefined;

  const sinceClause = opts.since ? ' AND date >= ?' : '';
  const params: (string | number)[] = [orgId];
  if (opts.since) params.push(opts.since);

  const agg = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(AVG(stars), 0) as avg_stars,
      SUM(CASE WHEN business_response IS NOT NULL THEN 1 ELSE 0 END) as responded,
      SUM(CASE WHEN text IS NOT NULL AND text != '' THEN 1 ELSE 0 END) as with_text,
      MIN(date) as first_date,
      MAX(date) as last_date
    FROM reviews WHERE org_id = ?${sinceClause}
  `).get(...params) as {
    total: number; avg_stars: number; responded: number;
    with_text: number; first_date: string | null; last_date: string | null;
  };

  const distRows = db.prepare(`
    SELECT CAST(ROUND(stars) AS INTEGER) as star, COUNT(*) as cnt
    FROM reviews WHERE org_id = ?${sinceClause}
    GROUP BY CAST(ROUND(stars) AS INTEGER)
  `).all(...params) as { star: number; cnt: number }[];

  const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const row of distRows) dist[String(row.star)] = row.cnt;

  return {
    org_id: orgId,
    name: company?.name ?? null,
    rating: company?.rating ?? null,
    total_reviews: agg.total,
    star_distribution: dist,
    avg_stars: Math.round(agg.avg_stars * 100) / 100,
    response_rate: agg.total > 0 ? Math.round((agg.responded / agg.total) * 100) / 100 : 0,
    reviews_with_text: agg.with_text,
    period: { first: agg.first_date, last: agg.last_date },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/db/stats.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add src/db/stats.ts tests/db/stats.test.ts
git commit -m "feat: add getStats() query for review statistics"
```

---

### Task 2: DB query module — `getTrends()`

**Files:**
- Modify: `src/db/stats.ts`
- Modify: `tests/db/stats.test.ts`

**Step 1: Write the failing test**

Append to `tests/db/stats.test.ts`:

```typescript
import { getTrends } from '../../src/db/stats.js';

describe('getTrends', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '111', name: 'Test Corp', role: 'mine' });
    upsertReviews(db, '111', [
      review({ date: '2025-01-15', stars: 5, review_url: 'http://r/1' }),
      review({ date: '2025-01-20', stars: 3, review_url: 'http://r/2' }),
      review({ date: '2025-02-10', stars: 4, review_url: 'http://r/3' }),
    ]);
  });

  it('groups by month by default', () => {
    const trends = getTrends(db, '111');
    assert.equal(trends.length, 2);
    assert.equal(trends[0].period, '2025-02');
    assert.equal(trends[0].count, 1);
    assert.equal(trends[1].period, '2025-01');
    assert.equal(trends[1].count, 2);
  });

  it('groups by week', () => {
    const trends = getTrends(db, '111', { groupBy: 'week' });
    assert.ok(trends.length >= 2);
    assert.ok(trends[0].period.includes('W'));
  });

  it('respects limit', () => {
    const trends = getTrends(db, '111', { limit: 1 });
    assert.equal(trends.length, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/stats.test.ts`
Expected: FAIL — `getTrends` is not exported

**Step 3: Write minimal implementation**

Append to `src/db/stats.ts`:

```typescript
export interface TrendRow {
  period: string;
  count: number;
  avg_stars: number;
}

export interface TrendsOpts {
  groupBy?: 'week' | 'month' | 'quarter';
  since?: string;
  limit?: number;
}

export function getTrends(db: Database.Database, orgId: string, opts: TrendsOpts = {}): TrendRow[] {
  const groupBy = opts.groupBy ?? 'month';
  const fmt = groupBy === 'week' ? '%Y-W%W'
    : groupBy === 'quarter' ? '%Y-Q' : '%Y-%m';

  const sinceClause = opts.since ? ' AND date >= ?' : '';
  const limitClause = opts.limit ? ` LIMIT ${opts.limit}` : '';
  const params: (string | number)[] = [orgId];
  if (opts.since) params.push(opts.since);

  let sql: string;
  if (groupBy === 'quarter') {
    sql = `
      SELECT
        strftime('%Y', date) || '-Q' || ((CAST(strftime('%m', date) AS INTEGER) - 1) / 3 + 1) as period,
        COUNT(*) as count,
        ROUND(AVG(stars), 2) as avg_stars
      FROM reviews
      WHERE org_id = ? AND date IS NOT NULL${sinceClause}
      GROUP BY period
      ORDER BY period DESC${limitClause}
    `;
  } else {
    sql = `
      SELECT
        strftime('${fmt}', date) as period,
        COUNT(*) as count,
        ROUND(AVG(stars), 2) as avg_stars
      FROM reviews
      WHERE org_id = ? AND date IS NOT NULL${sinceClause}
      GROUP BY period
      ORDER BY period DESC${limitClause}
    `;
  }

  return db.prepare(sql).all(...params) as TrendRow[];
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/db/stats.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/db/stats.ts tests/db/stats.test.ts
git commit -m "feat: add getTrends() for time-series review aggregation"
```

---

### Task 3: DB query module — `searchReviews()`

**Files:**
- Modify: `src/db/stats.ts`
- Modify: `tests/db/stats.test.ts`

**Step 1: Write the failing test**

Append to `tests/db/stats.test.ts`:

```typescript
import { searchReviews } from '../../src/db/stats.js';

describe('searchReviews', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '111', name: 'Test Corp', role: 'mine' });
    upsertCompany(db, { org_id: '222', name: 'Other Corp', role: 'competitor' });
    upsertReviews(db, '111', [
      review({ text: 'Отличный сервис, быстро и дёшево', review_url: 'http://r/1' }),
      review({ text: 'Долго ждать, дорого', stars: 2, review_url: 'http://r/2' }),
    ]);
    upsertReviews(db, '222', [
      review({ text: 'Тоже дорого здесь', stars: 3, review_url: 'http://r/3' }),
    ]);
  });

  it('searches across all orgs by default', () => {
    const results = searchReviews(db, 'дорого');
    assert.equal(results.length, 2);
  });

  it('filters by org_id', () => {
    const results = searchReviews(db, 'дорого', { orgId: '111' });
    assert.equal(results.length, 1);
  });

  it('is case-insensitive', () => {
    const results = searchReviews(db, 'СЕРВИС');
    assert.equal(results.length, 1);
  });

  it('returns empty for no match', () => {
    const results = searchReviews(db, 'несуществующее');
    assert.equal(results.length, 0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/stats.test.ts`
Expected: FAIL — `searchReviews` is not exported

**Step 3: Write minimal implementation**

Append to `src/db/stats.ts`:

```typescript
export interface SearchOpts {
  orgId?: string;
  starsMin?: number;
  starsMax?: number;
  limit?: number;
}

export interface SearchRow {
  org_id: string;
  date: string | null;
  stars: number;
  text: string | null;
  has_response: boolean;
  author_name: string | null;
}

export function searchReviews(db: Database.Database, query: string, opts: SearchOpts = {}): SearchRow[] {
  const conditions = ["text LIKE '%' || ? || '%' COLLATE NOCASE"];
  const params: (string | number)[] = [query];

  if (opts.orgId) {
    conditions.push('org_id = ?');
    params.push(opts.orgId);
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
  const limit = opts.limit ? `LIMIT ${opts.limit}` : 'LIMIT 50';

  return db.prepare(`
    SELECT org_id, date, stars, text, author_name,
      CASE WHEN business_response IS NOT NULL THEN 1 ELSE 0 END as has_response
    FROM reviews WHERE ${where}
    ORDER BY date DESC ${limit}
  `).all(...params).map((r: any) => ({ ...r, has_response: !!r.has_response })) as SearchRow[];
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/db/stats.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/db/stats.ts tests/db/stats.test.ts
git commit -m "feat: add searchReviews() for full-text review search"
```

---

### Task 4: CLI command — `stats`

**Files:**
- Create: `src/cli/stats.ts`
- Modify: `src/cli/index.ts` (add import + `program.addCommand`)

**Step 1: Write the CLI command**

In `src/cli/stats.ts`:

```typescript
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getStats } from '../db/stats.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const statsCommand = new Command('stats')
  .description('Show review statistics for an organization')
  .argument('<org_id>', 'Organization ID')
  .option('--since <date>', 'Only include reviews since date (YYYY-MM-DD)')
  .option('--json', 'Force JSON output')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);
    const stats = getStats(db, orgId, { since: opts.since });

    if (isJsonMode(opts)) {
      outputJson(stats);
    } else {
      console.log(`${stats.name ?? orgId} (${stats.org_id})`);
      console.log(`Yandex rating: ${stats.rating ?? '—'}  |  Avg stars in DB: ${stats.avg_stars}`);
      console.log(`Total reviews: ${stats.total_reviews}  |  With text: ${stats.reviews_with_text}`);
      console.log(`Response rate: ${(stats.response_rate * 100).toFixed(0)}%`);
      console.log(`Period: ${stats.period.first ?? '—'} → ${stats.period.last ?? '—'}`);
      console.log();
      outputTable(
        ['stars', 'count', 'bar'],
        ['5', '4', '3', '2', '1'].map(s => [
          s,
          String(stats.star_distribution[s]),
          '█'.repeat(Math.round((stats.star_distribution[s] / Math.max(stats.total_reviews, 1)) * 30)),
        ]),
      );
    }
    db.close();
  });
```

**Step 2: Register command in `src/cli/index.ts`**

Add import line:
```typescript
import { statsCommand } from './stats.js';
```

Add registration line after `compareCommand`:
```typescript
program.addCommand(statsCommand);
```

**Step 3: Manual test**

Run: `npm run dev -- stats 1248139252`
Expected: Table with star distribution and summary metrics

Run: `npm run dev -- stats 1248139252 --json`
Expected: JSON output with all stats fields

**Step 4: Commit**

```bash
git add src/cli/stats.ts src/cli/index.ts
git commit -m "feat: add stats command — review statistics overview"
```

---

### Task 5: CLI command — `digest`

**Files:**
- Create: `src/cli/digest.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write the CLI command**

In `src/cli/digest.ts`:

```typescript
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { queryReviews } from '../db/reviews.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const digestCommand = new Command('digest')
  .description('Compact review listing optimized for AI consumption')
  .argument('<org_id>', 'Organization ID')
  .option('--since <date>', 'Reviews since date (YYYY-MM-DD)')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--limit <n>', 'Max results (default: 50)')
  .option('--no-truncate', 'Show full review text')
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
      limit: opts.limit ? parseInt(opts.limit, 10) : 50,
    });

    const maxLen = opts.truncate === false ? Infinity : 200;
    const digest = reviews.map(r => ({
      date: r.date?.split('T')[0] ?? null,
      stars: r.stars,
      text: r.text && r.text.length > maxLen ? r.text.slice(0, maxLen) + '…' : r.text,
      has_response: r.business_response != null,
    }));

    if (isJsonMode(opts)) {
      outputJson(digest);
    } else {
      if (digest.length === 0) {
        console.log('No reviews found.');
        return;
      }
      outputTable(
        ['date', 'stars', 'text', 'resp'],
        digest.map(r => [
          r.date ?? '—',
          String(r.stars),
          truncate(r.text, 60),
          r.has_response ? 'yes' : '',
        ]),
      );
      console.log(`\n${digest.length} reviews`);
    }
    db.close();
  });
```

**Step 2: Register in `src/cli/index.ts`**

Add import: `import { digestCommand } from './digest.js';`
Add: `program.addCommand(digestCommand);`

**Step 3: Manual test**

Run: `npm run dev -- digest 1248139252 --stars 1-3 --limit 5`
Expected: Compact table with 5 negative reviews

Run: `npm run dev -- digest 1248139252 --json --limit 3`
Expected: JSON array with 3 items, each having date/stars/text/has_response only

**Step 4: Commit**

```bash
git add src/cli/digest.ts src/cli/index.ts
git commit -m "feat: add digest command — compact AI-friendly review listing"
```

---

### Task 6: CLI command — `search`

**Files:**
- Create: `src/cli/search.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write the CLI command**

In `src/cli/search.ts`:

```typescript
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { searchReviews } from '../db/stats.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const searchCommand = new Command('search')
  .description('Search review text across organizations')
  .argument('<text>', 'Text to search for')
  .option('--org <org_id>', 'Limit search to one organization')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--limit <n>', 'Max results (default: 50)')
  .option('--json', 'Force JSON output')
  .action((text: string, opts) => {
    const db = openDb(config.dbPath);

    let starsMin: number | undefined;
    let starsMax: number | undefined;
    if (opts.stars) {
      const parts = opts.stars.split('-');
      starsMin = parseFloat(parts[0]);
      starsMax = parts.length > 1 ? parseFloat(parts[1]) : starsMin;
    }

    const results = searchReviews(db, text, {
      orgId: opts.org,
      starsMin,
      starsMax,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });

    if (isJsonMode(opts)) {
      outputJson(results);
    } else {
      if (results.length === 0) {
        console.log('No reviews found.');
        return;
      }
      outputTable(
        ['org_id', 'date', 'stars', 'text', 'resp'],
        results.map(r => [
          r.org_id,
          r.date?.split('T')[0] ?? '—',
          String(r.stars),
          truncate(r.text, 50),
          r.has_response ? 'yes' : '',
        ]),
      );
      console.log(`\n${results.length} results`);
    }
    db.close();
  });
```

**Step 2: Register in `src/cli/index.ts`**

Add import: `import { searchCommand } from './search.js';`
Add: `program.addCommand(searchCommand);`

**Step 3: Manual test**

Run: `npm run dev -- search "дорого"`
Expected: Reviews mentioning "дорого" from both companies

Run: `npm run dev -- search "дорого" --org 1248139252 --json`
Expected: JSON results from Astra Motors only

**Step 4: Commit**

```bash
git add src/cli/search.ts src/cli/index.ts
git commit -m "feat: add search command — full-text review search"
```

---

### Task 7: CLI command — `trends`

**Files:**
- Create: `src/cli/trends.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write the CLI command**

In `src/cli/trends.ts`:

```typescript
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getTrends } from '../db/stats.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const trendsCommand = new Command('trends')
  .description('Show review trends over time')
  .argument('<org_id>', 'Organization ID')
  .option('--period <type>', 'Group by: week, month, quarter (default: month)', 'month')
  .option('--since <date>', 'Reviews since date (YYYY-MM-DD)')
  .option('--limit <n>', 'Max periods to show')
  .option('--json', 'Force JSON output')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);
    const trends = getTrends(db, orgId, {
      groupBy: opts.period as 'week' | 'month' | 'quarter',
      since: opts.since,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });

    if (isJsonMode(opts)) {
      outputJson(trends);
    } else {
      if (trends.length === 0) {
        console.log('No review data found.');
        return;
      }
      outputTable(
        ['period', 'count', 'avg stars', 'bar'],
        trends.map(t => [
          t.period,
          String(t.count),
          String(t.avg_stars),
          '█'.repeat(Math.min(t.count, 40)),
        ]),
      );
    }
    db.close();
  });
```

**Step 2: Register in `src/cli/index.ts`**

Add import: `import { trendsCommand } from './trends.js';`
Add: `program.addCommand(trendsCommand);`

**Step 3: Manual test**

Run: `npm run dev -- trends 1248139252`
Expected: Monthly table with counts and avg stars

Run: `npm run dev -- trends 1248139252 --period quarter --json`
Expected: JSON array grouped by quarter

**Step 4: Commit**

```bash
git add src/cli/trends.ts src/cli/index.ts
git commit -m "feat: add trends command — time-series review aggregation"
```

---

### Task 8: CLI command — `unanswered`

**Files:**
- Create: `src/cli/unanswered.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write the CLI command**

In `src/cli/unanswered.ts`:

```typescript
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const unansweredCommand = new Command('unanswered')
  .description('List reviews without a business response')
  .argument('<org_id>', 'Organization ID')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--since <date>', 'Reviews since date (YYYY-MM-DD)')
  .option('--limit <n>', 'Max results (default: 50)')
  .option('--json', 'Force JSON output')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);

    const conditions = ['org_id = ?', 'business_response IS NULL'];
    const params: (string | number)[] = [orgId];

    if (opts.since) {
      conditions.push('date >= ?');
      params.push(opts.since);
    }
    if (opts.stars) {
      const parts = opts.stars.split('-');
      const min = parseFloat(parts[0]);
      const max = parts.length > 1 ? parseFloat(parts[1]) : min;
      conditions.push('stars >= ?', 'stars <= ?');
      params.push(min, max);
    }

    const where = conditions.join(' AND ');
    const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

    const rows = db.prepare(`
      SELECT date, stars, text, author_name, review_url
      FROM reviews WHERE ${where}
      ORDER BY date DESC LIMIT ?
    `).all(...params, limit) as {
      date: string | null; stars: number; text: string | null;
      author_name: string | null; review_url: string | null;
    }[];

    if (isJsonMode(opts)) {
      outputJson(rows.map(r => ({
        date: r.date?.split('T')[0] ?? null,
        stars: r.stars,
        text: r.text,
        author_name: r.author_name,
        review_url: r.review_url,
      })));
    } else {
      if (rows.length === 0) {
        console.log('No unanswered reviews found.');
        return;
      }
      outputTable(
        ['date', 'stars', 'author', 'text'],
        rows.map(r => [
          r.date?.split('T')[0] ?? '—',
          String(r.stars),
          truncate(r.author_name, 15),
          truncate(r.text, 50),
        ]),
      );
      console.log(`\n${rows.length} unanswered reviews`);
    }
    db.close();
  });
```

**Step 2: Register in `src/cli/index.ts`**

Add import: `import { unansweredCommand } from './unanswered.js';`
Add: `program.addCommand(unansweredCommand);`

**Step 3: Manual test**

Run: `npm run dev -- unanswered 1248139252 --stars 1-3`
Expected: Negative reviews with no business response

Run: `npm run dev -- unanswered 1248139252 --json`
Expected: JSON array with review_url for each (so the business owner can click and respond)

**Step 4: Commit**

```bash
git add src/cli/unanswered.ts src/cli/index.ts
git commit -m "feat: add unanswered command — reviews needing business response"
```

---

### Task 9: Update help test + type check + full test run

**Files:**
- Modify: `tests/cli/help.test.ts`

**Step 1: Update smoke test to verify new commands appear in help**

Add assertions to the existing `shows help text` test:

```typescript
assert.ok(output.includes('stats'));
assert.ok(output.includes('digest'));
assert.ok(output.includes('search'));
assert.ok(output.includes('trends'));
assert.ok(output.includes('unanswered'));
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add tests/cli/help.test.ts
git commit -m "test: update smoke test to cover new CLI commands"
```

---

### Task 10: Final verification with real data

**Step 1: Test each command with real data**

```bash
npm run dev -- stats 1248139252
npm run dev -- stats 184053062683 --json
npm run dev -- digest 1248139252 --stars 1-3 --limit 5
npm run dev -- search "дорого"
npm run dev -- search "цена" --org 1248139252
npm run dev -- trends 1248139252
npm run dev -- trends 1248139252 --period quarter
npm run dev -- unanswered 1248139252 --stars 1-3
```

**Step 2: Verify JSON output pipes correctly**

```bash
npm run dev -- stats 1248139252 | jq .total_reviews
npm run dev -- search "дорого" | jq length
```

No commit needed — this is validation only.
