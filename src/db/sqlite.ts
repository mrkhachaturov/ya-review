import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DbClient } from './driver.js';

export class SqliteClient implements DbClient {
  readonly dialect = 'sqlite' as const;
  private db: Database.Database;
  private txDepth = 0;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.txDepth === 0) {
      this.db.exec('BEGIN');
    } else {
      this.db.exec(`SAVEPOINT sp_${this.txDepth}`);
    }
    this.txDepth++;
    try {
      const result = await fn();
      this.txDepth--;
      if (this.txDepth === 0) {
        this.db.exec('COMMIT');
      } else {
        this.db.exec(`RELEASE sp_${this.txDepth}`);
      }
      return result;
    } catch (e) {
      this.txDepth--;
      if (this.txDepth === 0) {
        this.db.exec('ROLLBACK');
      } else {
        this.db.exec(`ROLLBACK TO sp_${this.txDepth}`);
      }
      throw e;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
