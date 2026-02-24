import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb } from '../../src/db/schema.js';
import { createTestDb } from '../helpers.js';

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
});

describe('initSchema via createTestDb', () => {
  it('creates all tables via async DbClient', async () => {
    const db = await createTestDb();
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const names = tables.map(t => t.name);

    assert.ok(names.includes('companies'));
    assert.ok(names.includes('company_relations'));
    assert.ok(names.includes('reviews'));
    assert.ok(names.includes('sync_log'));
    assert.ok(names.includes('topic_templates'));
    assert.ok(names.includes('review_embeddings'));
    assert.ok(names.includes('review_topics'));
    assert.ok(names.includes('company_scores'));
    await db.close();
  });

  it('companies table has service_type column via DbClient', async () => {
    const db = await createTestDb();
    const cols = await db.all<{ name: string }>('PRAGMA table_info(companies)');
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('service_type'));
    await db.close();
  });
});
