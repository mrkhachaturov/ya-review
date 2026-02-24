import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTopicScore, starsToScore, recencyWeight, confidenceLevel } from '../../src/embeddings/scoring.js';

describe('scoring', () => {
  it('starsToScore maps 1-5 stars to 2-10 scale', () => {
    assert.equal(starsToScore(1), 2);
    assert.equal(starsToScore(3), 6);
    assert.equal(starsToScore(5), 10);
  });

  it('recencyWeight gives 2x for recent reviews', () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    assert.equal(recencyWeight(recent.toISOString()), 2.0);
  });

  it('recencyWeight gives 1.5x for 6-12 month old reviews', () => {
    const now = new Date();
    const mid = new Date(now.getTime() - 9 * 30 * 24 * 60 * 60 * 1000); // ~9 months ago
    assert.equal(recencyWeight(mid.toISOString()), 1.5);
  });

  it('recencyWeight gives 1x for old reviews', () => {
    assert.equal(recencyWeight('2020-01-01'), 1.0);
  });

  it('confidenceLevel is low for <5 reviews', () => {
    assert.equal(confidenceLevel(3), 'low');
  });

  it('confidenceLevel is medium for 5-19 reviews', () => {
    assert.equal(confidenceLevel(10), 'medium');
  });

  it('confidenceLevel is high for 20+ reviews', () => {
    assert.equal(confidenceLevel(25), 'high');
  });

  it('computeTopicScore calculates weighted average', () => {
    const reviews = [
      { stars: 5, date: new Date().toISOString() },
      { stars: 1, date: new Date().toISOString() },
    ];
    const result = computeTopicScore(reviews);
    // Average of starsToScore(5)=10 and starsToScore(1)=2 with equal recency weight
    // (10*2 + 2*2) / (2+2) = 24/4 = 6.0
    assert.equal(result.score, 6.0);
    assert.equal(result.review_count, 2);
    assert.equal(result.confidence, 'low');
  });

  it('computeTopicScore returns 0 for empty reviews', () => {
    const result = computeTopicScore([]);
    assert.equal(result.score, 0);
    assert.equal(result.review_count, 0);
    assert.equal(result.confidence, 'low');
  });
});
