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
