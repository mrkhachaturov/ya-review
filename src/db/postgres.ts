import type { DbClient } from './driver.js';

export class PgClient implements DbClient {
  readonly dialect = 'postgres' as const;

  constructor(_connectionString: string) {
    throw new Error(
      'PostgreSQL support is not yet fully implemented.\n' +
      'Remove YAREV_DB_URL to use SQLite.'
    );
  }

  run(_sql: string, _params: unknown[] = []): void {
    throw new Error('Not implemented');
  }

  get<T>(_sql: string, _params: unknown[] = []): T | undefined {
    throw new Error('Not implemented');
  }

  all<T>(_sql: string, _params: unknown[] = []): T[] {
    throw new Error('Not implemented');
  }

  exec(_sql: string): void {
    throw new Error('Not implemented');
  }

  transaction<T>(_fn: () => T): T {
    throw new Error('Not implemented');
  }

  close(): void {
    // no-op
  }
}
