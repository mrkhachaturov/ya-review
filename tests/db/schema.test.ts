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
