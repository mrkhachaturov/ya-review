import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

describe('yarev CLI', () => {
  it('shows help text', () => {
    const output = execSync('npx tsx src/index.ts --help', { encoding: 'utf8' });
    assert.ok(output.includes('yarev'));
    assert.ok(output.includes('sync'));
    assert.ok(output.includes('track'));
    assert.ok(output.includes('compare'));
    assert.ok(output.includes('stats'));
    assert.ok(output.includes('digest'));
    assert.ok(output.includes('search'));
    assert.ok(output.includes('trends'));
    assert.ok(output.includes('unanswered'));
    assert.ok(output.includes('apply'));
  });

  it('shows version', () => {
    const output = execSync('npx tsx src/index.ts --version', { encoding: 'utf8' });
    assert.ok(output.includes('0.1.0'));
  });
});
