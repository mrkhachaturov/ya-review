import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, float32ToBuffer, bufferToFloat32 } from '../../src/embeddings/vectors.js';

describe('vectors', () => {
  it('cosineSimilarity returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1.0) < 0.0001);
  });

  it('cosineSimilarity returns 0.0 for orthogonal vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 0.0001);
  });

  it('cosineSimilarity returns -1.0 for opposite vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) - (-1.0)) < 0.0001);
  });

  it('float32ToBuffer and bufferToFloat32 roundtrip', () => {
    const original = [0.1, -0.5, 3.14, 0.0, -999.999];
    const buf = float32ToBuffer(original);
    assert.equal(buf.length, original.length * 4);
    const restored = bufferToFloat32(buf);
    assert.equal(restored.length, original.length);
    for (let i = 0; i < original.length; i++) {
      assert.ok(Math.abs(restored[i] - original[i]) < 0.001);
    }
  });
});
