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
