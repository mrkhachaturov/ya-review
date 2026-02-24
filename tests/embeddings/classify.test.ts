import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReview } from '../../src/embeddings/classify.js';

describe('classifyReview', () => {
  it('returns top matching topics above threshold', () => {
    // Simulate: review embedding close to topic A, far from topic B
    const reviewVec = [1, 0, 0];
    const topics = [
      { id: 1, name: 'Topic A', embedding: [0.9, 0.1, 0.0] },
      { id: 2, name: 'Topic B', embedding: [0, 0, 1] },
    ];
    const matches = classifyReview(reviewVec, topics, 0.3);
    assert.ok(matches.length >= 1);
    assert.equal(matches[0].topicId, 1);
    assert.ok(matches[0].similarity > 0.9);
  });

  it('returns empty array when nothing above threshold', () => {
    const reviewVec = [1, 0, 0];
    const topics = [
      { id: 1, name: 'Topic A', embedding: [0, 1, 0] },
    ];
    const matches = classifyReview(reviewVec, topics, 0.9);
    assert.equal(matches.length, 0);
  });

  it('limits to maxTopics', () => {
    const reviewVec = [1, 1, 1];
    const topics = [
      { id: 1, name: 'A', embedding: [1, 1, 0] },
      { id: 2, name: 'B', embedding: [1, 0, 1] },
      { id: 3, name: 'C', embedding: [0, 1, 1] },
      { id: 4, name: 'D', embedding: [1, 1, 1] },
    ];
    const matches = classifyReview(reviewVec, topics, 0.1, 2);
    assert.equal(matches.length, 2);
  });
});
