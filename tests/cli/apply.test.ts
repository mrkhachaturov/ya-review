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
