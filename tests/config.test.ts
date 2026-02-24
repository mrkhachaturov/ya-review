import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

describe('config', () => {
  const origEnv = { ...process.env };

  after(() => {
    process.env = origEnv;
  });

  it('uses default values when no env vars set', async () => {
    delete process.env.YAREV_DB_PATH;
    delete process.env.BROWSER_BACKEND;
    // Re-import to pick up fresh env
    const { config } = await import('../src/config.js');
    assert.ok(config.dbPath.endsWith('.yarev/reviews.db'));
    assert.equal(config.browserBackend, 'patchright');
    assert.equal(config.browserHeadless, true);
    assert.equal(config.maxPages, 20);
    assert.equal(config.incrementalWindowSize, 50);
  });
});
