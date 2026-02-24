import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';
import { upsertCompany } from '../../src/db/companies.js';
import {
  upsertTopics,
  getTopicsForOrg,
  clearTopicsForOrg,
} from '../../src/db/topics.js';
import type { DbClient } from '../../src/db/driver.js';

describe('topics', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
    await upsertCompany(db, { org_id: '111', name: 'Test', role: 'mine' });
  });

  it('upsertTopics creates parent and child topics', async () => {
    await upsertTopics(db, '111', [
      { name: 'Цены', subtopics: ['Наценка', 'Стоимость'] },
    ]);
    const topics = await getTopicsForOrg(db, '111');
    assert.equal(topics.length, 3); // 1 parent + 2 children
    const parent = topics.find(t => t.parent_id === null);
    assert.ok(parent);
    assert.equal(parent!.name, 'Цены');
    const children = topics.filter(t => t.parent_id === parent!.id);
    assert.equal(children.length, 2);
  });

  it('clearTopicsForOrg removes all topics for an org', async () => {
    await upsertTopics(db, '111', [
      { name: 'Цены', subtopics: ['Наценка'] },
    ]);
    assert.equal((await getTopicsForOrg(db, '111')).length, 2);
    await clearTopicsForOrg(db, '111');
    assert.equal((await getTopicsForOrg(db, '111')).length, 0);
  });

  it('upsertTopics is idempotent — re-running with same data does not duplicate', async () => {
    const topics = [{ name: 'Цены', subtopics: ['Наценка'] }];
    await upsertTopics(db, '111', topics);
    await upsertTopics(db, '111', topics);
    assert.equal((await getTopicsForOrg(db, '111')).length, 2);
  });
});
