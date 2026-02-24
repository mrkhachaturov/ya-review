import type { DbClient } from './driver.js';

export class PgClient implements DbClient {
  readonly dialect = 'postgres' as const;

  private constructor() {
    // Use PgClient.connect() to create instances
  }

  static async connect(_connectionString: string): Promise<PgClient> {
    throw new Error(
      'PostgreSQL support is not yet fully implemented.\n' +
      'Remove YAREV_DB_URL to use SQLite.'
    );
  }

  async run(_sql: string, _params: unknown[] = []): Promise<void> {
    throw new Error('Not implemented');
  }

  async get<T>(_sql: string, _params: unknown[] = []): Promise<T | undefined> {
    throw new Error('Not implemented');
  }

  async all<T>(_sql: string, _params: unknown[] = []): Promise<T[]> {
    throw new Error('Not implemented');
  }

  async exec(_sql: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async transaction<T>(_fn: () => Promise<T>): Promise<T> {
    throw new Error('Not implemented');
  }

  async close(): Promise<void> {
    // no-op
  }
}
