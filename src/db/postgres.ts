import type { DbClient } from './driver.js';

export class PgClient implements DbClient {
  readonly dialect = 'postgres' as const;
  private pool: any; // pg.Pool
  private txClient: any | null = null; // active transaction client

  private constructor(pool: any) {
    this.pool = pool;
  }

  static async connect(connectionString: string): Promise<PgClient> {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString });
    // Test connection
    const client = await pool.connect();
    client.release();
    return new PgClient(pool);
  }

  private get queryable(): any {
    return this.txClient ?? this.pool;
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    const pgSql = this.convertParams(sql);
    await this.queryable.query(pgSql, params);
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const pgSql = this.convertParams(sql);
    const result = await this.queryable.query(pgSql, params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pgSql = this.convertParams(sql);
    const result = await this.queryable.query(pgSql, params);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.queryable.query(sql);
  }

  private txDepth = 0;

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Nested transaction: use SAVEPOINTs
    if (this.txClient) {
      const sp = `sp_${++this.txDepth}`;
      try {
        await this.txClient.query(`SAVEPOINT ${sp}`);
        const result = await fn();
        await this.txClient.query(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (e) {
        await this.txClient.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw e;
      } finally {
        this.txDepth--;
      }
    }

    // Outer transaction
    const client = await this.pool.connect();
    this.txClient = client;
    try {
      await client.query('BEGIN');
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      this.txClient = null;
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Convert SQLite ? params to PG $1, $2, ... */
  private convertParams(sql: string): string {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
  }
}
