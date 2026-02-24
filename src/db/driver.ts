import type { Config } from '../config.js';

export interface DbClient {
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly dialect: 'sqlite' | 'postgres';
}

export async function createDbClient(cfg: Pick<Config, 'dbUrl' | 'dbPath'>): Promise<DbClient> {
  if (cfg.dbUrl) {
    const { PgClient } = await import('./postgres.js');
    return PgClient.connect(cfg.dbUrl);
  }
  const { SqliteClient } = await import('./sqlite.js');
  return new SqliteClient(cfg.dbPath);
}
