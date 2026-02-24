import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';
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
import type { DbClient } from '../../src/db/driver.js';

describe('embeddings db', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createTestDb();
    await upsertCompany(db, { org_id: '111', name: 'Test', role: 'mine' });
    await upsertReviews(db, '111', [{
      author_name: 'Ivan', author_icon_url: null, author_profile_url: null,
      date: '2025-01-01', text: 'Great!', stars: 5,
      likes: 0, dislikes: 0, review_url: 'http://r/1', business_response: null,
    }]);
  });

  it('saveReviewEmbedding stores and retrieves embedding', async () => {
    const vec = [0.1, 0.2, 0.3];
    const row = await db.get<{ id: number }>('SELECT id FROM reviews LIMIT 1');
    const reviewId = row!.id;
    await saveReviewEmbedding(db, reviewId, 'test-model', float32ToBuffer(vec), null);
    const emb = await getReviewEmbedding(db, reviewId);
    assert.ok(emb);
    assert.equal(emb!.model, 'test-model');
    const restored = bufferToFloat32(emb!.text_embedding);
    assert.ok(Math.abs(restored[0] - 0.1) < 0.001);
  });

  it('getUnembeddedReviewIds returns reviews without embeddings', async () => {
    const ids = await getUnembeddedReviewIds(db, '111');
    assert.equal(ids.length, 1);
  });

  it('getUnembeddedReviewIds returns empty after embedding', async () => {
    const row = await db.get<{ id: number }>('SELECT id FROM reviews LIMIT 1');
    const reviewId = row!.id;
    await saveReviewEmbedding(db, reviewId, 'model', float32ToBuffer([0.1]), null);
    const ids = await getUnembeddedReviewIds(db, '111');
    assert.equal(ids.length, 0);
  });

  it('saveTopicEmbedding stores embedding on topic_templates row', async () => {
    await upsertTopics(db, '111', [{ name: 'Цены', subtopics: ['Наценка'] }]);
    const topics = await getTopicsForOrg(db, '111');
    await saveTopicEmbedding(db, topics[0].id, float32ToBuffer([0.5, 0.6]));
    const updated = await getTopicsForOrg(db, '111');
    assert.ok(updated[0].embedding);
  });
});
