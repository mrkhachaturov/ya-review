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
