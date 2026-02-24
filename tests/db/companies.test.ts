import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb } from '../../src/db/schema.js';
import {
  upsertCompany,
  listCompanies,
  getCompany,
  removeCompany,
} from '../../src/db/companies.js';
import type Database from 'better-sqlite3';

describe('companies', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('upsertCompany inserts a new company', () => {
    upsertCompany(db, {
      org_id: '111',
      name: 'Test Biz',
      rating: 4.5,
      review_count: 100,
      address: 'ул. Тестовая, 1',
      categories: ['Автосервис'],
      role: 'mine',
    });
    const c = getCompany(db, '111');
    assert.ok(c);
    assert.equal(c!.name, 'Test Biz');
    assert.equal(c!.role, 'mine');
  });

  it('upsertCompany updates existing company metadata', () => {
    upsertCompany(db, { org_id: '111', name: 'Old', role: 'tracked' });
    upsertCompany(db, { org_id: '111', name: 'New', rating: 4.8, role: 'mine' });
    const c = getCompany(db, '111');
    assert.equal(c!.name, 'New');
    assert.equal(c!.rating, 4.8);
    assert.equal(c!.role, 'mine');
  });

  it('listCompanies filters by role', () => {
    upsertCompany(db, { org_id: '1', name: 'A', role: 'mine' });
    upsertCompany(db, { org_id: '2', name: 'B', role: 'competitor' });
    upsertCompany(db, { org_id: '3', name: 'C', role: 'tracked' });

    const mine = listCompanies(db, 'mine');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].org_id, '1');

    const all = listCompanies(db);
    assert.equal(all.length, 3);
  });

  it('removeCompany deletes the company', () => {
    upsertCompany(db, { org_id: '111', name: 'X', role: 'tracked' });
    removeCompany(db, '111');
    assert.equal(getCompany(db, '111'), undefined);
  });
});
