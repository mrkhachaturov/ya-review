import { SqliteClient } from '../src/db/sqlite.js';
import { initSchema } from '../src/db/schema.js';
import type { DbClient } from '../src/db/driver.js';

export async function createTestDb(): Promise<DbClient> {
  const db = new SqliteClient(':memory:');
  await initSchema(db);
  return db;
}
