import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';
import { upsertCompany } from '../../src/db/companies.js';
import { upsertReviews } from '../../src/db/reviews.js';
import { getStats, getTrends, searchReviews } from '../../src/db/stats.js';
import type { DbClient } from '../../src/db/driver.js';

const review = (overrides: Record<string, unknown> = {}) => ({
  author_name: 'Test', author_icon_url: null, author_profile_url: null,
  date: '2025-06-01', text: 'Good service', stars: 5,
  likes: 0, dislikes: 0, review_url: null, business_response: null,
  ...overrides,
});

describe('getStats', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
    await upsertCompany(db, { org_id: '111', name: 'Test Co', rating: 4.5, role: 'mine' });
  });

  it('returns star distribution and averages correctly', async () => {
    await upsertReviews(db, '111', [
      review({ stars: 5, review_url: 'http://r/1', business_response: 'Thanks' }),
      review({ stars: 4, review_url: 'http://r/2', text: '' }),
      review({ stars: 3, review_url: 'http://r/3' }),
      review({ stars: 1, review_url: 'http://r/4', text: null }),
    ]);

    const stats = await getStats(db, '111');

    assert.equal(stats.org_id, '111');
    assert.equal(stats.name, 'Test Co');
    assert.equal(stats.rating, 4.5);
    assert.equal(stats.total_reviews, 4);
    assert.deepEqual(stats.star_distribution, { '1': 1, '2': 0, '3': 1, '4': 1, '5': 1 });
    assert.equal(stats.avg_stars, 3.25);
    assert.equal(stats.response_rate, 0.25);
    assert.equal(stats.reviews_with_text, 2); // 'Good service' x2, one empty, one null
    assert.equal(stats.period.first, '2025-06-01');
    assert.equal(stats.period.last, '2025-06-01');
  });

  it('returns zeros for org with no reviews', async () => {
    await upsertCompany(db, { org_id: '222', name: 'Empty Co', role: 'tracked' });
    const stats = await getStats(db, '222');

    assert.equal(stats.total_reviews, 0);
    assert.equal(stats.avg_stars, 0);
    assert.equal(stats.response_rate, 0);
    assert.equal(stats.reviews_with_text, 0);
    assert.deepEqual(stats.star_distribution, { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
    assert.equal(stats.period.first, null);
    assert.equal(stats.period.last, null);
  });

  it('filters by since date', async () => {
    await upsertReviews(db, '111', [
      review({ stars: 5, date: '2025-01-01', review_url: 'http://r/1' }),
      review({ stars: 3, date: '2025-06-01', review_url: 'http://r/2' }),
      review({ stars: 4, date: '2025-07-01', review_url: 'http://r/3' }),
    ]);

    const stats = await getStats(db, '111', { since: '2025-06-01' });

    assert.equal(stats.total_reviews, 2);
    assert.equal(stats.avg_stars, 3.5);
    assert.equal(stats.period.first, '2025-06-01');
    assert.equal(stats.period.last, '2025-07-01');
  });
});

describe('getTrends', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
    await upsertCompany(db, { org_id: '111', name: 'Test Co', role: 'mine' });
    await upsertReviews(db, '111', [
      review({ stars: 5, date: '2025-01-15', review_url: 'http://r/1' }),
      review({ stars: 4, date: '2025-01-20', review_url: 'http://r/2' }),
      review({ stars: 3, date: '2025-02-10', review_url: 'http://r/3' }),
      review({ stars: 2, date: '2025-03-05', review_url: 'http://r/4' }),
    ]);
  });

  it('groups by month by default', async () => {
    const trends = await getTrends(db, '111');

    assert.equal(trends.length, 3);
    // DESC order: 2025-03, 2025-02, 2025-01
    assert.equal(trends[0].period, '2025-03');
    assert.equal(trends[0].count, 1);
    assert.equal(trends[0].avg_stars, 2);

    assert.equal(trends[1].period, '2025-02');
    assert.equal(trends[1].count, 1);
    assert.equal(trends[1].avg_stars, 3);

    assert.equal(trends[2].period, '2025-01');
    assert.equal(trends[2].count, 2);
    assert.equal(trends[2].avg_stars, 4.5);
  });

  it('groups by week', async () => {
    const trends = await getTrends(db, '111', { groupBy: 'week' });

    // Each review is in a different week, so we get multiple entries
    assert.ok(trends.length >= 3);
    for (const row of trends) {
      assert.match(row.period, /^\d{4}-W\d{2}$/);
    }
  });

  it('respects limit', async () => {
    const trends = await getTrends(db, '111', { limit: 2 });
    assert.equal(trends.length, 2);
    // Should get the two most recent periods (DESC order)
    assert.equal(trends[0].period, '2025-03');
    assert.equal(trends[1].period, '2025-02');
  });
});

describe('searchReviews', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
    await upsertCompany(db, { org_id: '111', name: 'Alpha', role: 'mine' });
    await upsertCompany(db, { org_id: '222', name: 'Beta', role: 'tracked' });
    await upsertReviews(db, '111', [
      review({ text: 'Great coffee and atmosphere', stars: 5, review_url: 'http://r/1' }),
      review({ text: 'Terrible service', stars: 1, review_url: 'http://r/2' }),
    ]);
    await upsertReviews(db, '222', [
      review({ text: 'Amazing coffee selection', stars: 4, review_url: 'http://r/3' }),
    ]);
  });

  it('searches across all orgs by default', async () => {
    const results = await searchReviews(db, 'coffee');
    assert.equal(results.length, 2);
    const orgIds = results.map(r => r.org_id).sort();
    assert.deepEqual(orgIds, ['111', '222']);
  });

  it('filters by org_id', async () => {
    const results = await searchReviews(db, 'coffee', { orgId: '111' });
    assert.equal(results.length, 1);
    assert.equal(results[0].org_id, '111');
  });

  it('is case-insensitive', async () => {
    const lower = await searchReviews(db, 'coffee');
    const upper = await searchReviews(db, 'COFFEE');
    const mixed = await searchReviews(db, 'Coffee');

    assert.equal(lower.length, 2);
    assert.equal(upper.length, 2);
    assert.equal(mixed.length, 2);
  });

  it('returns empty for no match', async () => {
    const results = await searchReviews(db, 'nonexistent-query-xyz');
    assert.equal(results.length, 0);
  });
});
