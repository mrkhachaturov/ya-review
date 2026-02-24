import type { DbClient } from './driver.js';

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

export async function logSync(db: DbClient, input: LogSyncInput): Promise<void> {
  await db.run(`
    INSERT INTO sync_log (org_id, sync_type, reviews_added, reviews_updated, started_at, finished_at, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.org_id,
    input.sync_type,
    input.reviews_added,
    input.reviews_updated,
    input.started_at,
    input.finished_at ?? null,
    input.status,
    input.error_message ?? null,
  ]);
}

export async function getLastSync(db: DbClient, orgId: string): Promise<SyncLogRow | undefined> {
  return db.get<SyncLogRow>(
    'SELECT * FROM sync_log WHERE org_id = ? ORDER BY id DESC LIMIT 1',
    [orgId]
  );
}
