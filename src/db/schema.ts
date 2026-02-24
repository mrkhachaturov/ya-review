import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DbClient } from './driver.js';

const SCHEMA_SQL = `
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
`;

function runMigrations(db: Database.Database): void {
  const addColumnSafe = (table: string, col: string, type: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some(c => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  };

  addColumnSafe('companies', 'service_type', 'TEXT');
  addColumnSafe('company_relations', 'priority', 'INTEGER');
  addColumnSafe('company_relations', 'notes', 'TEXT');
}

/** @deprecated Use createDbClient() + initSchema() instead */
export function openDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  runMigrations(db);

  return db;
}

/** @deprecated Use createDbClient() + initSchema() instead */
export function closeDb(db: Database.Database): void {
  db.close();
}

/**
 * Initialize schema through the async DbClient interface.
 * For SQLite, uses the same SQL as openDb.
 * For PostgreSQL, delegates to pg-schema.ts.
 */
export async function initSchema(db: DbClient): Promise<void> {
  if (db.dialect === 'sqlite') {
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
