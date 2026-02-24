import type Database from 'better-sqlite3';

export interface SyncLogRow {
  id: number;
  org_id: string;
  sync_type: string;
  reviews_added: number;
  reviews_updated: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_message: string | null;
}

export interface LogSyncInput {
  org_id: string;
  sync_type: 'full' | 'incremental';
  reviews_added: number;
  reviews_updated: number;
  started_at: string;
  finished_at?: string;
  status: 'ok' | 'error';
  error_message?: string;
}

export function logSync(db: Database.Database, input: LogSyncInput): void {
  db.prepare(`
    INSERT INTO sync_log (org_id, sync_type, reviews_added, reviews_updated, started_at, finished_at, status, error_message)
    VALUES (@org_id, @sync_type, @reviews_added, @reviews_updated, @started_at, @finished_at, @status, @error_message)
  `).run({
    org_id: input.org_id,
    sync_type: input.sync_type,
    reviews_added: input.reviews_added,
    reviews_updated: input.reviews_updated,
    started_at: input.started_at,
    finished_at: input.finished_at ?? null,
    status: input.status,
    error_message: input.error_message ?? null,
  });
}

export function getLastSync(db: Database.Database, orgId: string): SyncLogRow | undefined {
  return db.prepare(
    'SELECT * FROM sync_log WHERE org_id = ? ORDER BY id DESC LIMIT 1'
  ).get(orgId) as SyncLogRow | undefined;
}
