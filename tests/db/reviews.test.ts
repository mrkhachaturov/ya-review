import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';
import { upsertCompany } from '../../src/db/companies.js';
import { upsertReviews, queryReviews, reviewKey } from '../../src/db/reviews.js';
import type { DbClient } from '../../src/db/driver.js';

describe('reviews', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
    await upsertCompany(db, { org_id: '111', name: 'Test', role: 'mine' });
  });

  it('reviewKey uses review_url when available', () => {
    const key = reviewKey('111', {
      review_url: 'https://yandex.ru/maps/org/111/reviews?reviews[publicId]=abc',
      author_name: 'Test',
      date: '2025-01-01',
      text: 'Great',
    });
    assert.equal(key, 'https://yandex.ru/maps/org/111/reviews?reviews[publicId]=abc');
  });

  it('reviewKey falls back to hash when no review_url', () => {
    const key = reviewKey('111', {
      review_url: null,
      author_name: 'Ivan',
      date: '2025-06-01',
      text: 'Excellent service for everyone',
    });
    assert.ok(key.startsWith('sha256:'));
    assert.equal(key.length, 7 + 64); // "sha256:" + 64 hex chars
  });

  it('upsertReviews inserts new reviews and returns counts', async () => {
    const result = await upsertReviews(db, '111', [
      {
        author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
        date: '2025-01-01', text: 'Great!', stars: 5,
        likes: 2, dislikes: 0, review_url: 'http://r/1', business_response: null,
      },
      {
        author_name: 'Maria', author_icon_url: null, author_profile_url: null,
        date: '2025-01-02', text: 'Good', stars: 4,
        likes: 0, dislikes: 0, review_url: 'http://r/2', business_response: 'Thanks!',
      },
    ]);
    assert.equal(result.added, 2);
    assert.equal(result.updated, 0);
  });

  it('upsertReviews updates existing review when text changes', async () => {
    await upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Great!', stars: 5,
      likes: 2, dislikes: 0, review_url: 'http://r/1', business_response: null,
    }]);
    const result = await upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Updated text!', stars: 5,
      likes: 5, dislikes: 1, review_url: 'http://r/1', business_response: 'Thanks!',
    }]);
    assert.equal(result.added, 0);
    assert.equal(result.updated, 1);
  });

  it('queryReviews returns reviews for an org', async () => {
    await upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Great!', stars: 5,
      likes: 0, dislikes: 0, review_url: 'http://r/1', business_response: null,
    }]);
    const rows = await queryReviews(db, '111');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].author_name, 'Ivan');
  });

  it('queryReviews filters by stars range', async () => {
    await upsertReviews(db, '111', [
      { author_name: 'A', author_icon_url: null, author_profile_url: null,
        date: '2025-01-01', text: 'Bad', stars: 1,
        likes: 0, dislikes: 0, review_url: 'http://r/1', business_response: null },
      { author_name: 'B', author_icon_url: null, author_profile_url: null,
        date: '2025-01-02', text: 'Great', stars: 5,
        likes: 0, dislikes: 0, review_url: 'http://r/2', business_response: null },
    ]);
    const bad = await queryReviews(db, '111', { starsMin: 1, starsMax: 3 });
    assert.equal(bad.length, 1);
    assert.equal(bad[0].author_name, 'A');
  });
});
