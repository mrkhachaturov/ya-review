import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';
import { upsertCompany } from '../../src/db/companies.js';
import { addCompetitor, removeCompetitor, getCompetitors } from '../../src/db/competitors.js';
import type { DbClient } from '../../src/db/driver.js';

describe('competitors', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
    await upsertCompany(db, { org_id: '1', name: 'My Biz', role: 'mine' });
    await upsertCompany(db, { org_id: '2', name: 'Rival A', role: 'competitor' });
    await upsertCompany(db, { org_id: '3', name: 'Rival B', role: 'competitor' });
  });

  it('addCompetitor creates a relation', async () => {
    await addCompetitor(db, '1', '2');
    const rivals = await getCompetitors(db, '1');
    assert.equal(rivals.length, 1);
    assert.equal(rivals[0].org_id, '2');
  });

  it('addCompetitor is idempotent', async () => {
    await addCompetitor(db, '1', '2');
    await addCompetitor(db, '1', '2'); // no error
    assert.equal((await getCompetitors(db, '1')).length, 1);
  });

  it('removeCompetitor deletes the relation', async () => {
    await addCompetitor(db, '1', '2');
    await addCompetitor(db, '1', '3');
    await removeCompetitor(db, '1', '2');
    const rivals = await getCompetitors(db, '1');
    assert.equal(rivals.length, 1);
    assert.equal(rivals[0].org_id, '3');
  });

  it('getCompetitors returns empty for org with no competitors', async () => {
    assert.equal((await getCompetitors(db, '1')).length, 0);
  });
});
