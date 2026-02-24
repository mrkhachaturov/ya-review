import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDbClient } from '../../src/db/driver.js';

describe('createDbClient', () => {
  it('creates a SQLite client when no dbUrl is provided', () => {
    const client = createDbClient({ dbUrl: undefined, dbPath: ':memory:' });
    assert.ok(client);
    client.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    client.run('INSERT INTO test (val) VALUES (?)', ['hello']);
    const row = client.get<{ val: string }>('SELECT val FROM test WHERE id = 1');
    assert.equal(row?.val, 'hello');
    client.close();
  });

  it('supports transactions', () => {
    const client = createDbClient({ dbUrl: undefined, dbPath: ':memory:' });
    client.exec('CREATE TABLE nums (n INTEGER)');
    client.transaction(() => {
      client.run('INSERT INTO nums (n) VALUES (?)', [1]);
      client.run('INSERT INTO nums (n) VALUES (?)', [2]);
    });
    const rows = client.all<{ n: number }>('SELECT n FROM nums ORDER BY n');
    assert.equal(rows.length, 2);
    client.close();
  });
});
