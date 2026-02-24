import { createRequire } from 'node:module';
import type { Config } from '../config.js';

const require = createRequire(import.meta.url);

export interface DbClient {
  run(sql: string, params?: unknown[]): void;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
  readonly dialect: 'sqlite' | 'postgres';
}

export function createDbClient(cfg: Pick<Config, 'dbUrl' | 'dbPath'>): DbClient {
  if (cfg.dbUrl) {
    // PostgreSQL support is a stub for now — requires async refinement
    throw new Error(
      'PostgreSQL support is not yet implemented. Remove YAREV_DB_URL to use SQLite.'
    );
  }
  const { SqliteClient } = require('./sqlite.js') as typeof import('./sqlite.js');
  return new SqliteClient(cfg.dbPath);
}
