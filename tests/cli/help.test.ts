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
  });

  it('shows version', () => {
    const output = execSync('npx tsx src/index.ts --version', { encoding: 'utf8' });
    assert.ok(output.includes('0.1.0'));
  });
});
