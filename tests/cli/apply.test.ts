import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';
import { applyConfig } from '../../src/cli/apply.js';
import { getTopicsForOrg } from '../../src/db/topics.js';
import { getCompany, listCompanies } from '../../src/db/companies.js';
import type { DbClient } from '../../src/db/driver.js';
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
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('creates companies from config', async () => {
    await applyConfig(db, TEST_CONFIG);
    const companies = await listCompanies(db);
    assert.equal(companies.length, 2);
    assert.equal(companies.find(c => c.org_id === '111')?.role, 'mine');
  });

  it('sets service_type on companies', async () => {
    await applyConfig(db, TEST_CONFIG);
    const row = await db.get<{ service_type: string }>('SELECT service_type FROM companies WHERE org_id = ?', ['111']);
    assert.equal(row?.service_type, 'auto_service');
  });

  it('creates competitor relations with priority', async () => {
    await applyConfig(db, TEST_CONFIG);
    const rel = await db.get<{ priority: number; notes: string }>(
      'SELECT * FROM company_relations WHERE company_org_id = ? AND competitor_org_id = ?',
      ['111', '222']
    );
    assert.ok(rel);
    assert.equal(rel!.priority, 9);
    assert.equal(rel!.notes, 'Closest');
  });

  it('creates topic hierarchy', async () => {
    await applyConfig(db, TEST_CONFIG);
    const topics = await getTopicsForOrg(db, '111');
    assert.equal(topics.length, 5); // 2 parents + 3 children
  });

  it('is idempotent — applying twice does not duplicate', async () => {
    await applyConfig(db, TEST_CONFIG);
    await applyConfig(db, TEST_CONFIG);
    const companies = await listCompanies(db);
    assert.equal(companies.length, 2);
    const topics = await getTopicsForOrg(db, '111');
    assert.equal(topics.length, 5);
  });
});
