import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/schema.js';
import { upsertCompany } from '../../src/db/companies.js';
import { upsertReviews } from '../../src/db/reviews.js';
import {
  saveReviewEmbedding,
  getReviewEmbedding,
  getUnembeddedReviewIds,
  saveTopicEmbedding,
} from '../../src/db/embeddings.js';
import { upsertTopics, getTopicsForOrg } from '../../src/db/topics.js';
import { float32ToBuffer, bufferToFloat32 } from '../../src/embeddings/vectors.js';
import type Database from 'better-sqlite3';

describe('embeddings db', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { org_id: '111', name: 'Test', role: 'mine' });
    upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Great!', stars: 5,
      likes: 0, dislikes: 0, review_url: 'http://r/1', business_response: null,
    }]);
  });

  it('saveReviewEmbedding stores and retrieves embedding', () => {
    const vec = [0.1, 0.2, 0.3];
    const reviewId = (db.prepare('SELECT id FROM reviews LIMIT 1').get() as any).id;
    saveReviewEmbedding(db, reviewId, 'test-model', float32ToBuffer(vec), null);
    const row = getReviewEmbedding(db, reviewId);
    assert.ok(row);
    assert.equal(row!.model, 'test-model');
    const restored = bufferToFloat32(row!.text_embedding);
    assert.ok(Math.abs(restored[0] - 0.1) < 0.001);
  });

  it('getUnembeddedReviewIds returns reviews without embeddings', () => {
    const ids = getUnembeddedReviewIds(db, '111');
    assert.equal(ids.length, 1);
  });

  it('getUnembeddedReviewIds returns empty after embedding', () => {
    const reviewId = (db.prepare('SELECT id FROM reviews LIMIT 1').get() as any).id;
    saveReviewEmbedding(db, reviewId, 'model', float32ToBuffer([0.1]), null);
    const ids = getUnembeddedReviewIds(db, '111');
    assert.equal(ids.length, 0);
  });

  it('saveTopicEmbedding stores embedding on topic_templates row', () => {
    upsertTopics(db, '111', [{ name: 'Цены', subtopics: ['Наценка'] }]);
    const topics = getTopicsForOrg(db, '111');
    saveTopicEmbedding(db, topics[0].id, float32ToBuffer([0.5, 0.6]));
    const updated = getTopicsForOrg(db, '111');
    assert.ok(updated[0].embedding);
  });
});
