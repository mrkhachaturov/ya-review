import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';
import {
  upsertCompany,
  listCompanies,
  getCompany,
  removeCompany,
} from '../../src/db/companies.js';
import type { DbClient } from '../../src/db/driver.js';

describe('companies', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('upsertCompany inserts a new company', async () => {
    await upsertCompany(db, {
      org_id: '111',
      name: 'Test Biz',
      rating: 4.5,
      review_count: 100,
      address: 'ул. Тестовая, 1',
      categories: ['Автосервис'],
      role: 'mine',
    });
    const c = await getCompany(db, '111');
    assert.ok(c);
    assert.equal(c!.name, 'Test Biz');
    assert.equal(c!.role, 'mine');
  });

  it('upsertCompany updates existing company metadata', async () => {
    await upsertCompany(db, { org_id: '111', name: 'Old', role: 'tracked' });
    await upsertCompany(db, { org_id: '111', name: 'New', rating: 4.8, role: 'mine' });
    const c = await getCompany(db, '111');
    assert.equal(c!.name, 'New');
    assert.equal(c!.rating, 4.8);
    assert.equal(c!.role, 'mine');
  });

  it('listCompanies filters by role', async () => {
    await upsertCompany(db, { org_id: '1', name: 'A', role: 'mine' });
    await upsertCompany(db, { org_id: '2', name: 'B', role: 'competitor' });
    await upsertCompany(db, { org_id: '3', name: 'C', role: 'tracked' });

    const mine = await listCompanies(db, 'mine');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].org_id, '1');

    const all = await listCompanies(db);
    assert.equal(all.length, 3);
  });

  it('removeCompany deletes the company', async () => {
    await upsertCompany(db, { org_id: '111', name: 'X', role: 'tracked' });
    await removeCompany(db, '111');
    assert.equal(await getCompany(db, '111'), undefined);
  });
});
