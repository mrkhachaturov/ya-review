import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDbClient } from '../../src/db/driver.js';

describe('createDbClient', () => {
  it('creates a SQLite client when no dbUrl is provided', async () => {
    const client = await createDbClient({ dbUrl: undefined, dbPath: ':memory:' });
    assert.ok(client);
    await client.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    await client.run('INSERT INTO test (val) VALUES (?)', ['hello']);
    const row = await client.get<{ val: string }>('SELECT val FROM test WHERE id = 1');
    assert.equal(row?.val, 'hello');
    await client.close();
  });

  it('supports transactions', async () => {
    const client = await createDbClient({ dbUrl: undefined, dbPath: ':memory:' });
    await client.exec('CREATE TABLE nums (n INTEGER)');
    await client.transaction(async () => {
      await client.run('INSERT INTO nums (n) VALUES (?)', [1]);
      await client.run('INSERT INTO nums (n) VALUES (?)', [2]);
    });
    const rows = await client.all<{ n: number }>('SELECT n FROM nums ORDER BY n');
    assert.equal(rows.length, 2);
    await client.close();
  });
});
