# Embeddings & Semantic Analysis — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add declarative YAML config, OpenAI embeddings, topic classification, and AI quality scoring to ya-review CLI.

**Architecture:** YAML config as source of truth for companies/topics. sqlite-vec for vector storage (BLOB fallback). OpenAI `text-embedding-3-small` for embeddings. Topic classification via cosine similarity. Per-company AI quality scores.

**Tech Stack:** TypeScript ESM, better-sqlite3, sqlite-vec, Commander.js, OpenAI API, yaml (npm package)

**Design doc:** `docs/plans/2026-02-24-embeddings-design.md`

---

## Phase 1: YAML Config + `yarev apply`

### Task 1.1: Add yaml dependency

**Step 1: Install yaml package**

Run: `npm install yaml`

**Step 2: Verify installation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add yaml package for config parsing"
```

---

### Task 1.2: Add config types

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add YAML config types to `src/types/index.ts`**

Append after existing types:

```typescript
// ─── YAML Config types ───

export interface YarevTopicConfig {
  name: string;
  subtopics: string[];
}

export interface YarevCompetitorRef {
  org_id: string;
  priority: number;
  notes?: string;
}

export interface YarevCompanyConfig {
  org_id: string;
  name: string;
  role: CompanyRole;
  service_type: string;
  competitors?: YarevCompetitorRef[];
  topics: YarevTopicConfig[] | 'inherit';
}

export interface YarevEmbeddingsConfig {
  model: string;
  batch_size: number;
}

export interface YarevConfig {
  companies: YarevCompanyConfig[];
  embeddings: YarevEmbeddingsConfig;
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add YAML config types for companies and topics"
```

---

### Task 1.3: Config loader with tests (TDD)

**Files:**
- Create: `src/yaml-config.ts`
- Create: `tests/yaml-config.test.ts`

**Step 1: Write the failing test**

Create `tests/yaml-config.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYarevConfig } from '../src/yaml-config.js';

const VALID_YAML = `
companies:
  - org_id: "111"
    name: Test Service
    role: mine
    service_type: auto_service
    competitors:
      - org_id: "222"
        priority: 9
        notes: "Direct competitor"
    topics:
      - name: Цены
        subtopics:
          - Стоимость работ
          - Наценка на запчасти
      - name: Качество
        subtopics:
          - Качество ремонта
  - org_id: "222"
    name: Competitor
    role: competitor
    service_type: auto_service
    topics: inherit
embeddings:
  model: text-embedding-3-small
  batch_size: 100
`;

describe('parseYarevConfig', () => {
  it('parses valid YAML config', () => {
    const config = parseYarevConfig(VALID_YAML);
    assert.equal(config.companies.length, 2);
    assert.equal(config.companies[0].org_id, '111');
    assert.equal(config.companies[0].service_type, 'auto_service');
    assert.deepEqual(config.companies[0].competitors, [
      { org_id: '222', priority: 9, notes: 'Direct competitor' },
    ]);
  });

  it('parses topic hierarchy', () => {
    const config = parseYarevConfig(VALID_YAML);
    const topics = config.companies[0].topics;
    assert.ok(Array.isArray(topics));
    assert.equal((topics as any)[0].name, 'Цены');
    assert.deepEqual((topics as any)[0].subtopics, ['Стоимость работ', 'Наценка на запчасти']);
  });

  it('resolves inherit topics from same service_type', () => {
    const config = parseYarevConfig(VALID_YAML);
    const competitor = config.companies[1];
    // After parsing, inherit should be resolved to the same topics as the first auto_service
    assert.ok(Array.isArray(competitor.topics));
    assert.equal((competitor.topics as any).length, 2);
    assert.equal((competitor.topics as any)[0].name, 'Цены');
  });

  it('parses embeddings config', () => {
    const config = parseYarevConfig(VALID_YAML);
    assert.equal(config.embeddings.model, 'text-embedding-3-small');
    assert.equal(config.embeddings.batch_size, 100);
  });

  it('throws on missing companies', () => {
    assert.throws(() => parseYarevConfig('embeddings:\n  model: x'), /companies/);
  });

  it('throws on invalid role', () => {
    const bad = `
companies:
  - org_id: "1"
    name: X
    role: invalid
    service_type: auto
    topics: []
embeddings:
  model: x
  batch_size: 1
`;
    assert.throws(() => parseYarevConfig(bad), /role/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/yaml-config.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/yaml-config.ts`:

```typescript
import { parse } from 'yaml';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { YarevConfig, YarevCompanyConfig, YarevTopicConfig } from './types/index.js';

const DEFAULT_CONFIG_PATH = join(homedir(), '.yarev', 'config.yaml');

export function getConfigPath(): string {
  return process.env.YAREV_CONFIG ?? DEFAULT_CONFIG_PATH;
}

export function loadYarevConfig(path?: string): YarevConfig {
  const configPath = path ?? getConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, 'utf-8');
  return parseYarevConfig(raw);
}

export function parseYarevConfig(raw: string): YarevConfig {
  const doc = parse(raw);

  if (!doc?.companies || !Array.isArray(doc.companies)) {
    throw new Error('Config must have a "companies" array');
  }

  const validRoles = new Set(['mine', 'competitor', 'tracked']);
  const companies: YarevCompanyConfig[] = doc.companies.map((c: any) => {
    if (!validRoles.has(c.role)) {
      throw new Error(`Invalid role "${c.role}" for company "${c.org_id}". Must be: mine, competitor, tracked`);
    }
    return {
      org_id: String(c.org_id),
      name: c.name,
      role: c.role,
      service_type: c.service_type ?? 'auto_service',
      competitors: c.competitors ?? [],
      topics: c.topics ?? [],
    } as YarevCompanyConfig;
  });

  // Resolve "inherit" topics
  for (const company of companies) {
    if (company.topics === 'inherit') {
      const donor = companies.find(
        c => c.service_type === company.service_type && Array.isArray(c.topics) && c.topics.length > 0,
      );
      if (donor) {
        company.topics = (donor.topics as YarevTopicConfig[]).map(t => ({ ...t, subtopics: [...t.subtopics] }));
      } else {
        company.topics = [];
      }
    }
  }

  const embeddings = {
    model: doc.embeddings?.model ?? 'text-embedding-3-small',
    batch_size: doc.embeddings?.batch_size ?? 100,
  };

  return { companies, embeddings };
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/yaml-config.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/yaml-config.ts tests/yaml-config.test.ts
git commit -m "feat: YAML config parser with inherit resolution and validation"
```

---

### Task 1.4: Add config path to main config

**Files:**
- Modify: `src/config.ts`

**Step 1: Add YAREV_CONFIG and embedding env vars to config**

Add after `daemonCron` in `src/config.ts`:

```typescript
  yarevConfig:          process.env.YAREV_CONFIG ?? join(homedir(), '.yarev', 'config.yaml'),
  openaiApiKey:         process.env.YAREV_OPENAI_API_KEY,
  embeddingModel:       process.env.YAREV_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  embeddingBatchSize:   Number(process.env.YAREV_EMBEDDING_BATCH_SIZE ?? 100),
  batchPollInterval:    Number(process.env.YAREV_BATCH_POLL_INTERVAL ?? 30),
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add embedding and YAML config env vars"
```

---

### Task 1.5: Schema migration — new tables and ALTERs

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `tests/db/schema.test.ts`

**Step 1: Write failing test**

Add to `tests/db/schema.test.ts`:

```typescript
it('creates embedding-related tables', () => {
  const db = openDb(':memory:');
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all() as { name: string }[];
  const names = tables.map(t => t.name);

  assert.ok(names.includes('topic_templates'));
  assert.ok(names.includes('review_embeddings'));
  assert.ok(names.includes('review_topics'));
  assert.ok(names.includes('company_scores'));
  closeDb(db);
});

it('companies table has service_type column', () => {
  const db = openDb(':memory:');
  const info = db.prepare("PRAGMA table_info(companies)").all() as { name: string }[];
  const cols = info.map(c => c.name);
  assert.ok(cols.includes('service_type'));
  closeDb(db);
});

it('company_relations has priority and notes columns', () => {
  const db = openDb(':memory:');
  const info = db.prepare("PRAGMA table_info(company_relations)").all() as { name: string }[];
  const cols = info.map(c => c.name);
  assert.ok(cols.includes('priority'));
  assert.ok(cols.includes('notes'));
  closeDb(db);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/schema.test.ts`
Expected: FAIL — tables/columns don't exist

**Step 3: Add new tables and columns to `src/db/schema.ts`**

Add after the `sync_log` table creation, before the `return db;`:

```sql
    CREATE TABLE IF NOT EXISTS topic_templates (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES companies(org_id),
      FOREIGN KEY (parent_id) REFERENCES topic_templates(id)
    );
    CREATE INDEX IF NOT EXISTS idx_topic_templates_org ON topic_templates(org_id);

    CREATE TABLE IF NOT EXISTS review_embeddings (
      review_id INTEGER PRIMARY KEY REFERENCES reviews(id),
      model TEXT NOT NULL,
      text_embedding BLOB NOT NULL,
      response_embedding BLOB,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_topics (
      id INTEGER PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      topic_id INTEGER NOT NULL REFERENCES topic_templates(id),
      similarity REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(review_id, topic_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_topics_review ON review_topics(review_id);
    CREATE INDEX IF NOT EXISTS idx_review_topics_topic ON review_topics(topic_id);

    CREATE TABLE IF NOT EXISTS company_scores (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      topic_id INTEGER REFERENCES topic_templates(id),
      score REAL NOT NULL,
      review_count INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      computed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(org_id, topic_id)
    );
```

Also add columns to existing tables. Since SQLite `ALTER TABLE ADD COLUMN` with `IF NOT EXISTS` isn't supported before 3.35, use a safe approach — wrap each in try/catch or check pragma. Add after the CREATE TABLE block:

```typescript
  // Migration: add columns to existing tables (safe for re-runs)
  const addColumnSafe = (table: string, col: string, type: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some(c => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  };

  addColumnSafe('companies', 'service_type', 'TEXT');
  addColumnSafe('company_relations', 'priority', 'INTEGER');
  addColumnSafe('company_relations', 'notes', 'TEXT');
```

**Step 4: Run tests**

Run: `npx tsx --test tests/db/schema.test.ts`
Expected: All PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All PASS (existing tests unaffected)

**Step 6: Commit**

```bash
git add src/db/schema.ts tests/db/schema.test.ts
git commit -m "feat: add embedding schema — topic_templates, review_embeddings, review_topics, company_scores"
```

---

### Task 1.6: Topic templates DB operations (TDD)

**Files:**
- Create: `src/db/topics.ts`
- Create: `tests/db/topics.test.ts`

**Step 1: Write failing tests**

Create `tests/db/topics.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/schema.js';
import { upsertCompany } from '../../src/db/companies.js';
import {
  upsertTopics,
  getTopicsForOrg,
  clearTopicsForOrg,
} from '../../src/db/topics.js';
import type Database from 'better-sqlite3';

describe('topics', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '111', name: 'Test', role: 'mine' });
  });

  it('upsertTopics creates parent and child topics', () => {
    upsertTopics(db, '111', [
      { name: 'Цены', subtopics: ['Наценка', 'Стоимость'] },
    ]);
    const topics = getTopicsForOrg(db, '111');
    assert.equal(topics.length, 3); // 1 parent + 2 children
    const parent = topics.find(t => t.parent_id === null);
    assert.ok(parent);
    assert.equal(parent!.name, 'Цены');
    const children = topics.filter(t => t.parent_id === parent!.id);
    assert.equal(children.length, 2);
  });

  it('clearTopicsForOrg removes all topics for an org', () => {
    upsertTopics(db, '111', [
      { name: 'Цены', subtopics: ['Наценка'] },
    ]);
    assert.equal(getTopicsForOrg(db, '111').length, 2);
    clearTopicsForOrg(db, '111');
    assert.equal(getTopicsForOrg(db, '111').length, 0);
  });

  it('upsertTopics is idempotent — re-running with same data does not duplicate', () => {
    const topics = [{ name: 'Цены', subtopics: ['Наценка'] }];
    upsertTopics(db, '111', topics);
    upsertTopics(db, '111', topics);
    assert.equal(getTopicsForOrg(db, '111').length, 2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/topics.test.ts`
Expected: FAIL — module not found

**Step 3: Implement**

Create `src/db/topics.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { YarevTopicConfig } from '../types/index.js';

export interface TopicRow {
  id: number;
  org_id: string;
  parent_id: number | null;
  name: string;
  embedding: Buffer | null;
  created_at: string;
}

export function upsertTopics(db: Database.Database, orgId: string, topics: YarevTopicConfig[]): void {
  clearTopicsForOrg(db, orgId);

  const insertParent = db.prepare(`
    INSERT INTO topic_templates (org_id, parent_id, name) VALUES (?, NULL, ?)
  `);
  const insertChild = db.prepare(`
    INSERT INTO topic_templates (org_id, parent_id, name) VALUES (?, ?, ?)
  `);

  const run = db.transaction(() => {
    for (const topic of topics) {
      const result = insertParent.run(orgId, topic.name);
      const parentId = result.lastInsertRowid as number;
      for (const sub of topic.subtopics) {
        insertChild.run(orgId, parentId, sub);
      }
    }
  });

  run();
}

export function getTopicsForOrg(db: Database.Database, orgId: string): TopicRow[] {
  return db.prepare('SELECT * FROM topic_templates WHERE org_id = ? ORDER BY id').all(orgId) as TopicRow[];
}

export function getParentTopics(db: Database.Database, orgId: string): TopicRow[] {
  return db.prepare(
    'SELECT * FROM topic_templates WHERE org_id = ? AND parent_id IS NULL ORDER BY id',
  ).all(orgId) as TopicRow[];
}

export function getSubtopics(db: Database.Database, parentId: number): TopicRow[] {
  return db.prepare('SELECT * FROM topic_templates WHERE parent_id = ? ORDER BY id').all(parentId) as TopicRow[];
}

export function clearTopicsForOrg(db: Database.Database, orgId: string): void {
  // Delete children first (FK constraint), then parents
  db.prepare('DELETE FROM topic_templates WHERE org_id = ? AND parent_id IS NOT NULL').run(orgId);
  db.prepare('DELETE FROM topic_templates WHERE org_id = ?').run(orgId);
}
```

**Step 4: Run tests**

Run: `npx tsx --test tests/db/topics.test.ts`
Expected: All 3 PASS

**Step 5: Commit**

```bash
git add src/db/topics.ts tests/db/topics.test.ts
git commit -m "feat: topic_templates CRUD operations with parent/child hierarchy"
```

---

### Task 1.7: `yarev apply` command (TDD)

**Files:**
- Create: `src/cli/apply.ts`
- Create: `tests/cli/apply.test.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write failing test**

Create `tests/cli/apply.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/schema.js';
import { applyConfig } from '../../src/cli/apply.js';
import { getTopicsForOrg } from '../../src/db/topics.js';
import { getCompany, listCompanies } from '../../src/db/companies.js';
import type Database from 'better-sqlite3';
import type { YarevConfig } from '../../src/types/index.js';

const TEST_CONFIG: YarevConfig = {
  companies: [
    {
      org_id: '111',
      name: 'My Service',
      role: 'mine',
      service_type: 'auto_service',
      competitors: [{ org_id: '222', priority: 9, notes: 'Closest' }],
      topics: [
        { name: 'Цены', subtopics: ['Наценка', 'Стоимость'] },
        { name: 'Качество', subtopics: ['Ремонт'] },
      ],
    },
    {
      org_id: '222',
      name: 'Competitor',
      role: 'competitor',
      service_type: 'auto_service',
      topics: [
        { name: 'Цены', subtopics: ['Наценка', 'Стоимость'] },
        { name: 'Качество', subtopics: ['Ремонт'] },
      ],
    },
  ],
  embeddings: { model: 'text-embedding-3-small', batch_size: 100 },
};

describe('applyConfig', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('creates companies from config', () => {
    applyConfig(db, TEST_CONFIG);
    const companies = listCompanies(db);
    assert.equal(companies.length, 2);
    assert.equal(companies.find(c => c.org_id === '111')?.role, 'mine');
  });

  it('sets service_type on companies', () => {
    applyConfig(db, TEST_CONFIG);
    const row = db.prepare('SELECT service_type FROM companies WHERE org_id = ?').get('111') as any;
    assert.equal(row.service_type, 'auto_service');
  });

  it('creates competitor relations with priority', () => {
    applyConfig(db, TEST_CONFIG);
    const rel = db.prepare(
      'SELECT * FROM company_relations WHERE company_org_id = ? AND competitor_org_id = ?'
    ).get('111', '222') as any;
    assert.ok(rel);
    assert.equal(rel.priority, 9);
    assert.equal(rel.notes, 'Closest');
  });

  it('creates topic hierarchy', () => {
    applyConfig(db, TEST_CONFIG);
    const topics = getTopicsForOrg(db, '111');
    assert.equal(topics.length, 5); // 2 parents + 3 children
  });

  it('is idempotent — applying twice does not duplicate', () => {
    applyConfig(db, TEST_CONFIG);
    applyConfig(db, TEST_CONFIG);
    const companies = listCompanies(db);
    assert.equal(companies.length, 2);
    const topics = getTopicsForOrg(db, '111');
    assert.equal(topics.length, 5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/cli/apply.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `applyConfig` and the CLI command**

Create `src/cli/apply.ts`:

```typescript
import { Command } from 'commander';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { loadYarevConfig } from '../yaml-config.js';
import { upsertCompany } from '../db/companies.js';
import { upsertTopics } from '../db/topics.js';
import type { YarevConfig, YarevTopicConfig } from '../types/index.js';

export function applyConfig(db: Database.Database, yarevConfig: YarevConfig): void {
  const updateServiceType = db.prepare('UPDATE companies SET service_type = ? WHERE org_id = ?');
  const upsertRelation = db.prepare(`
    INSERT INTO company_relations (company_org_id, competitor_org_id, priority, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(company_org_id, competitor_org_id) DO UPDATE SET
      priority = excluded.priority,
      notes = excluded.notes
  `);

  db.transaction(() => {
    // 1. Upsert companies
    for (const company of yarevConfig.companies) {
      upsertCompany(db, {
        org_id: company.org_id,
        name: company.name,
        role: company.role,
      });
      updateServiceType.run(company.service_type, company.org_id);
    }

    // 2. Upsert competitor relations
    for (const company of yarevConfig.companies) {
      if (company.competitors) {
        for (const comp of company.competitors) {
          upsertRelation.run(company.org_id, comp.org_id, comp.priority, comp.notes ?? null);
        }
      }
    }

    // 3. Upsert topics
    for (const company of yarevConfig.companies) {
      if (Array.isArray(company.topics)) {
        upsertTopics(db, company.org_id, company.topics as YarevTopicConfig[]);
      }
    }
  })();
}

export const applyCommand = new Command('apply')
  .description('Apply YAML config to database (companies, topics, competitors)')
  .option('--config <path>', 'Path to config.yaml')
  .option('--dry-run', 'Show what would change without applying')
  .action((opts) => {
    const yarevConfig = loadYarevConfig(opts.config);
    const db = openDb(config.dbPath);

    if (opts.dryRun) {
      console.log(`Would apply ${yarevConfig.companies.length} companies:`);
      for (const c of yarevConfig.companies) {
        const topicCount = Array.isArray(c.topics) ? c.topics.length : 0;
        console.log(`  ${c.org_id} ${c.name} (${c.role}, ${topicCount} topics)`);
      }
      db.close();
      return;
    }

    applyConfig(db, yarevConfig);

    console.log(`Applied config: ${yarevConfig.companies.length} companies`);
    for (const c of yarevConfig.companies) {
      const topicCount = Array.isArray(c.topics)
        ? c.topics.reduce((sum, t) => sum + 1 + t.subtopics.length, 0)
        : 0;
      console.log(`  ${c.org_id} ${c.name} — ${topicCount} topics`);
    }
    db.close();
  });
```

**Step 4: Register command in `src/cli/index.ts`**

Add import and `.addCommand(applyCommand)`:

```typescript
import { applyCommand } from './apply.js';
// ... after other addCommand calls:
program.addCommand(applyCommand);
```

**Step 5: Run tests**

Run: `npx tsx --test tests/cli/apply.test.ts`
Expected: All 5 PASS

**Step 6: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 7: Smoke test with real CLI**

Run: `npm run dev -- apply --help`
Expected: Shows apply command help

**Step 8: Commit**

```bash
git add src/cli/apply.ts tests/cli/apply.test.ts src/cli/index.ts
git commit -m "feat: yarev apply command — sync YAML config to DB"
```

---

### Task 1.8: Update CLI help test

**Files:**
- Modify: `tests/cli/help.test.ts`

**Step 1: Add 'apply' to help test assertions**

Add `assert.ok(output.includes('apply'));` to the existing help test.

**Step 2: Run tests**

Run: `npm test`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/cli/help.test.ts
git commit -m "test: add apply command to CLI help test"
```

---

## Phase 2: OpenAI Embedding Client + `yarev embed`

### Task 2.1: Add openai dependency

**Step 1: Install OpenAI SDK**

Run: `npm install openai`

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add openai SDK for embeddings"
```

---

### Task 2.2: Embedding client with vector utilities (TDD)

**Files:**
- Create: `src/embeddings/client.ts`
- Create: `src/embeddings/vectors.ts`
- Create: `tests/embeddings/vectors.test.ts`

**Step 1: Write failing test for vector utilities**

Create `tests/embeddings/vectors.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, float32ToBuffer, bufferToFloat32 } from '../../src/embeddings/vectors.js';

describe('vectors', () => {
  it('cosineSimilarity returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1.0) < 0.0001);
  });

  it('cosineSimilarity returns 0.0 for orthogonal vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 0.0001);
  });

  it('cosineSimilarity returns -1.0 for opposite vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) - (-1.0)) < 0.0001);
  });

  it('float32ToBuffer and bufferToFloat32 roundtrip', () => {
    const original = [0.1, -0.5, 3.14, 0.0, -999.999];
    const buf = float32ToBuffer(original);
    assert.equal(buf.length, original.length * 4);
    const restored = bufferToFloat32(buf);
    assert.equal(restored.length, original.length);
    for (let i = 0; i < original.length; i++) {
      assert.ok(Math.abs(restored[i] - original[i]) < 0.001);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/embeddings/vectors.test.ts`
Expected: FAIL — module not found

**Step 3: Implement vectors**

Create `src/embeddings/vectors.ts`:

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function float32ToBuffer(arr: number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i], i * 4);
  }
  return buf;
}

export function bufferToFloat32(buf: Buffer): number[] {
  const arr: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    arr.push(buf.readFloatLE(i));
  }
  return arr;
}
```

**Step 4: Run tests**

Run: `npx tsx --test tests/embeddings/vectors.test.ts`
Expected: All 4 PASS

**Step 5: Create OpenAI client wrapper**

Create `src/embeddings/client.ts`:

```typescript
import OpenAI from 'openai';
import { config } from '../config.js';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    if (!config.openaiApiKey) {
      throw new Error('YAREV_OPENAI_API_KEY is required for embeddings. Set it in .env or environment.');
    }
    _client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return _client;
}

export async function embedTexts(texts: string[], model?: string): Promise<number[][]> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: model ?? config.embeddingModel,
    input: texts,
  });
  // Sort by index to ensure order matches input
  return response.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

export async function embedBatched(
  texts: string[],
  batchSize?: number,
  model?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const size = batchSize ?? config.embeddingBatchSize;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += size) {
    const batch = texts.slice(i, i + size);
    const embeddings = await embedTexts(batch, model);
    results.push(...embeddings);
    onProgress?.(Math.min(i + size, texts.length), texts.length);
  }
  return results;
}
```

**Step 6: Commit**

```bash
git add src/embeddings/vectors.ts src/embeddings/client.ts tests/embeddings/vectors.test.ts
git commit -m "feat: vector utilities and OpenAI embedding client"
```

---

### Task 2.3: Review embeddings DB operations (TDD)

**Files:**
- Create: `src/db/embeddings.ts`
- Create: `tests/db/embeddings.test.ts`

**Step 1: Write failing test**

Create `tests/db/embeddings.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/schema.js';
import { upsertCompany } from '../../src/db/companies.js';
import { upsertReviews } from '../../src/db/reviews.js';
import {
  saveReviewEmbedding,
  getReviewEmbedding,
  getUnembeddedReviewIds,
  saveTopicEmbedding,
} from '../../src/db/embeddings.js';
import { upsertTopics, getTopicsForOrg } from '../../src/db/topics.js';
import { float32ToBuffer, bufferToFloat32 } from '../../src/embeddings/vectors.js';
import type Database from 'better-sqlite3';

describe('embeddings db', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '111', name: 'Test', role: 'mine' });
    upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Great!', stars: 5,
      likes: 0, dislikes: 0, review_url: 'http://r/1', business_response: null,
    }]);
  });

  it('saveReviewEmbedding stores and retrieves embedding', () => {
    const vec = [0.1, 0.2, 0.3];
    const reviewId = (db.prepare('SELECT id FROM reviews LIMIT 1').get() as any).id;
    saveReviewEmbedding(db, reviewId, 'test-model', float32ToBuffer(vec), null);
    const row = getReviewEmbedding(db, reviewId);
    assert.ok(row);
    assert.equal(row!.model, 'test-model');
    const restored = bufferToFloat32(row!.text_embedding);
    assert.ok(Math.abs(restored[0] - 0.1) < 0.001);
  });

  it('getUnembeddedReviewIds returns reviews without embeddings', () => {
    const ids = getUnembeddedReviewIds(db, '111');
    assert.equal(ids.length, 1);
  });

  it('getUnembeddedReviewIds returns empty after embedding', () => {
    const reviewId = (db.prepare('SELECT id FROM reviews LIMIT 1').get() as any).id;
    saveReviewEmbedding(db, reviewId, 'model', float32ToBuffer([0.1]), null);
    const ids = getUnembeddedReviewIds(db, '111');
    assert.equal(ids.length, 0);
  });

  it('saveTopicEmbedding stores embedding on topic_templates row', () => {
    upsertTopics(db, '111', [{ name: 'Цены', subtopics: ['Наценка'] }]);
    const topics = getTopicsForOrg(db, '111');
    saveTopicEmbedding(db, topics[0].id, float32ToBuffer([0.5, 0.6]));
    const updated = getTopicsForOrg(db, '111');
    assert.ok(updated[0].embedding);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/db/embeddings.test.ts`
Expected: FAIL — module not found

**Step 3: Implement**

Create `src/db/embeddings.ts`:

```typescript
import type Database from 'better-sqlite3';

export interface ReviewEmbeddingRow {
  review_id: number;
  model: string;
  text_embedding: Buffer;
  response_embedding: Buffer | null;
  created_at: string;
}

export function saveReviewEmbedding(
  db: Database.Database,
  reviewId: number,
  model: string,
  textEmbedding: Buffer,
  responseEmbedding: Buffer | null,
): void {
  db.prepare(`
    INSERT INTO review_embeddings (review_id, model, text_embedding, response_embedding)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(review_id) DO UPDATE SET
      model = excluded.model,
      text_embedding = excluded.text_embedding,
      response_embedding = excluded.response_embedding,
      created_at = datetime('now')
  `).run(reviewId, model, textEmbedding, responseEmbedding);
}

export function getReviewEmbedding(db: Database.Database, reviewId: number): ReviewEmbeddingRow | undefined {
  return db.prepare('SELECT * FROM review_embeddings WHERE review_id = ?').get(reviewId) as
    ReviewEmbeddingRow | undefined;
}

export function getUnembeddedReviewIds(db: Database.Database, orgId: string): { id: number; text: string }[] {
  return db.prepare(`
    SELECT r.id, r.text FROM reviews r
    LEFT JOIN review_embeddings re ON r.id = re.review_id
    WHERE r.org_id = ? AND re.review_id IS NULL AND r.text IS NOT NULL AND r.text != ''
    ORDER BY r.id
  `).all(orgId) as { id: number; text: string }[];
}

export function saveTopicEmbedding(db: Database.Database, topicId: number, embedding: Buffer): void {
  db.prepare('UPDATE topic_templates SET embedding = ? WHERE id = ?').run(embedding, topicId);
}
```

**Step 4: Run tests**

Run: `npx tsx --test tests/db/embeddings.test.ts`
Expected: All 4 PASS

**Step 5: Commit**

```bash
git add src/db/embeddings.ts tests/db/embeddings.test.ts
git commit -m "feat: review and topic embedding DB operations"
```

---

### Task 2.4: `yarev embed` command

**Files:**
- Create: `src/cli/embed.ts`
- Modify: `src/cli/index.ts`

**Step 1: Implement the embed command**

Create `src/cli/embed.ts`:

```typescript
import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { getUnembeddedReviewIds, saveReviewEmbedding, saveTopicEmbedding } from '../db/embeddings.js';
import { getTopicsForOrg } from '../db/topics.js';
import { embedBatched } from '../embeddings/client.js';
import { float32ToBuffer } from '../embeddings/vectors.js';

export const embedCommand = new Command('embed')
  .description('Generate embeddings for reviews and topic labels')
  .option('--org <org_id>', 'Limit to one organization')
  .option('--force', 'Re-embed even if already exists')
  .option('--batch', 'Use OpenAI Batch API (50% cheaper, async)')
  .action(async (opts) => {
    const db = openDb(config.dbPath);
    const model = config.embeddingModel;

    // Determine which orgs to process
    const companies = opts.org
      ? [{ org_id: opts.org }]
      : listCompanies(db).map(c => ({ org_id: c.org_id }));

    if (opts.batch) {
      console.log('Batch mode not yet implemented. Use sync mode (without --batch).');
      db.close();
      return;
    }

    let totalReviews = 0;
    let totalTopics = 0;

    for (const { org_id } of companies) {
      // 1. Embed unembedded reviews
      const reviews = opts.force
        ? db.prepare(
            "SELECT id, text FROM reviews WHERE org_id = ? AND text IS NOT NULL AND text != '' ORDER BY id"
          ).all(org_id) as { id: number; text: string }[]
        : getUnembeddedReviewIds(db, org_id);

      if (reviews.length > 0) {
        console.log(`${org_id}: embedding ${reviews.length} reviews...`);
        const texts = reviews.map(r => r.text);
        const embeddings = await embedBatched(texts, undefined, model, (done, total) => {
          process.stdout.write(`\r  ${done}/${total} reviews`);
        });
        process.stdout.write('\n');

        for (let i = 0; i < reviews.length; i++) {
          saveReviewEmbedding(db, reviews[i].id, model, float32ToBuffer(embeddings[i]), null);
        }
        totalReviews += reviews.length;
      }

      // 2. Embed topic labels (always re-embed — they're few and labels may change)
      const topics = getTopicsForOrg(db, org_id);
      const unembeddedTopics = opts.force
        ? topics
        : topics.filter(t => !t.embedding);

      if (unembeddedTopics.length > 0) {
        console.log(`${org_id}: embedding ${unembeddedTopics.length} topic labels...`);
        const topicTexts = unembeddedTopics.map(t => t.name);
        const topicEmbeddings = await embedBatched(topicTexts, undefined, model);
        for (let i = 0; i < unembeddedTopics.length; i++) {
          saveTopicEmbedding(db, unembeddedTopics[i].id, float32ToBuffer(topicEmbeddings[i]));
        }
        totalTopics += unembeddedTopics.length;
      }
    }

    console.log(`Done: ${totalReviews} reviews, ${totalTopics} topics embedded.`);
    db.close();
  });
```

**Step 2: Register in `src/cli/index.ts`**

Add import and `.addCommand(embedCommand)`.

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/cli/embed.ts src/cli/index.ts
git commit -m "feat: yarev embed command — sync mode for reviews and topic labels"
```

---

## Phase 3: Topic Classification + `yarev classify` + `yarev topics`

### Task 3.1: Classification logic (TDD)

**Files:**
- Create: `src/embeddings/classify.ts`
- Create: `tests/embeddings/classify.test.ts`

**Step 1: Write failing test**

Create `tests/embeddings/classify.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReview } from '../../src/embeddings/classify.js';

describe('classifyReview', () => {
  it('returns top matching topics above threshold', () => {
    // Simulate: review embedding close to topic A, far from topic B
    const reviewVec = [1, 0, 0];
    const topics = [
      { id: 1, name: 'Topic A', embedding: [0.9, 0.1, 0.0] },
      { id: 2, name: 'Topic B', embedding: [0, 0, 1] },
    ];
    const matches = classifyReview(reviewVec, topics, 0.3);
    assert.ok(matches.length >= 1);
    assert.equal(matches[0].topicId, 1);
    assert.ok(matches[0].similarity > 0.9);
  });

  it('returns empty array when nothing above threshold', () => {
    const reviewVec = [1, 0, 0];
    const topics = [
      { id: 1, name: 'Topic A', embedding: [0, 1, 0] },
    ];
    const matches = classifyReview(reviewVec, topics, 0.9);
    assert.equal(matches.length, 0);
  });

  it('limits to maxTopics', () => {
    const reviewVec = [1, 1, 1];
    const topics = [
      { id: 1, name: 'A', embedding: [1, 1, 0] },
      { id: 2, name: 'B', embedding: [1, 0, 1] },
      { id: 3, name: 'C', embedding: [0, 1, 1] },
      { id: 4, name: 'D', embedding: [1, 1, 1] },
    ];
    const matches = classifyReview(reviewVec, topics, 0.1, 2);
    assert.equal(matches.length, 2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/embeddings/classify.test.ts`
Expected: FAIL

**Step 3: Implement**

Create `src/embeddings/classify.ts`:

```typescript
import { cosineSimilarity } from './vectors.js';

export interface TopicMatch {
  topicId: number;
  name: string;
  similarity: number;
}

export interface TopicCandidate {
  id: number;
  name: string;
  embedding: number[];
}

export function classifyReview(
  reviewVec: number[],
  topics: TopicCandidate[],
  threshold = 0.3,
  maxTopics = 3,
): TopicMatch[] {
  return topics
    .map(t => ({
      topicId: t.id,
      name: t.name,
      similarity: cosineSimilarity(reviewVec, t.embedding),
    }))
    .filter(m => m.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxTopics);
}
```

**Step 4: Run tests**

Run: `npx tsx --test tests/embeddings/classify.test.ts`
Expected: All 3 PASS

**Step 5: Commit**

```bash
git add src/embeddings/classify.ts tests/embeddings/classify.test.ts
git commit -m "feat: review-to-topic classification by cosine similarity"
```

---

### Task 3.2: `yarev classify` command

**Files:**
- Create: `src/cli/classify.ts`
- Modify: `src/cli/index.ts`

**Step 1: Implement**

Create `src/cli/classify.ts` — reads review embeddings from DB, reads topic embeddings, runs classification, saves to `review_topics` table. Register in `src/cli/index.ts`.

Pattern: same as `embed.ts` — iterate orgs, load from DB, compute, save.

**Step 2: Commit**

```bash
git add src/cli/classify.ts src/cli/index.ts
git commit -m "feat: yarev classify — assign reviews to topics by embedding similarity"
```

---

### Task 3.3: `yarev topics` command

**Files:**
- Create: `src/cli/topics.ts`
- Modify: `src/cli/index.ts`

**Step 1: Implement**

Create `src/cli/topics.ts` — query `review_topics` joined with `topic_templates` and `reviews`, aggregate by topic hierarchy, show counts + avg stars. Register in `src/cli/index.ts`.

Output format from design:
```
Цены и стоимость          87 reviews  ★2.4  ↑12%
  Наценка на запчасти      34 reviews  ★1.8
  Стоимость работ          28 reviews  ★2.6
```

**Step 2: Commit**

```bash
git add src/cli/topics.ts src/cli/index.ts
git commit -m "feat: yarev topics — hierarchical topic analysis with counts and avg stars"
```

---

## Phase 4: Semantic Search + Similar

### Task 4.1: Enhance `yarev search` with embeddings

**Files:**
- Modify: `src/cli/search.ts`
- Modify: `src/db/stats.ts`

When embeddings exist, embed the query text and find nearest neighbors by cosine similarity. Fall back to LIKE when no embeddings.

**Commit:** `feat: semantic search — uses embeddings when available, falls back to LIKE`

---

### Task 4.2: `yarev similar` command

**Files:**
- Create: `src/cli/similar.ts`
- Modify: `src/cli/index.ts`

Find reviews most similar to a given text or review ID.

**Commit:** `feat: yarev similar — find semantically similar reviews`

---

## Phase 5: AI Quality Scoring + `yarev score`

### Task 5.1: Scoring logic (TDD)

**Files:**
- Create: `src/embeddings/scoring.ts`
- Create: `tests/embeddings/scoring.test.ts`

Implement the scoring algorithm from the design: base score from stars, recency weighting, sentiment adjustment, confidence levels.

**Commit:** `feat: AI quality scoring algorithm with recency weighting`

---

### Task 5.2: `yarev score` command

**Files:**
- Create: `src/cli/score.ts`
- Modify: `src/cli/index.ts`

Shows per-company score broken down by topic. `--full` for subtopics. `--compare` for side-by-side.

**Commit:** `feat: yarev score — per-company AI quality scoring with topic breakdown`

---

## Phase 6+: Future (sqlite-vec, pgvector, batch API)

These phases are separate follow-up work:

- **sqlite-vec integration** — virtual tables for ANN search
- **pgvector export** — mirror data to PostgreSQL for Power BI
- **Batch API mode** — `--batch` flag for `yarev embed`

Not detailed here — tackle after Phases 1-5 are working.

---

## Summary of all commits (expected)

| # | Commit message |
|---|---|
| 1 | `deps: add yaml package for config parsing` |
| 2 | `feat: add YAML config types for companies and topics` |
| 3 | `feat: YAML config parser with inherit resolution and validation` |
| 4 | `feat: add embedding and YAML config env vars` |
| 5 | `feat: add embedding schema — topic_templates, review_embeddings, review_topics, company_scores` |
| 6 | `feat: topic_templates CRUD operations with parent/child hierarchy` |
| 7 | `feat: yarev apply command — sync YAML config to DB` |
| 8 | `test: add apply command to CLI help test` |
| 9 | `deps: add openai SDK for embeddings` |
| 10 | `feat: vector utilities and OpenAI embedding client` |
| 11 | `feat: review and topic embedding DB operations` |
| 12 | `feat: yarev embed command — sync mode for reviews and topic labels` |
| 13 | `feat: review-to-topic classification by cosine similarity` |
| 14 | `feat: yarev classify — assign reviews to topics by embedding similarity` |
| 15 | `feat: yarev topics — hierarchical topic analysis with counts and avg stars` |
| 16 | `feat: semantic search — uses embeddings when available, falls back to LIKE` |
| 17 | `feat: yarev similar — find semantically similar reviews` |
| 18 | `feat: AI quality scoring algorithm with recency weighting` |
| 19 | `feat: yarev score — per-company AI quality scoring with topic breakdown` |
