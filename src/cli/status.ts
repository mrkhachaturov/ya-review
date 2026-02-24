import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { getLastSync } from '../db/sync-log.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const statusCommand = new Command('status')
  .description('Show sync status for all tracked companies')
  .option('--json', 'Force JSON output')
  .action(async (opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    const companies = await listCompanies(db);

    const statuses = [];
    for (const c of companies) {
      const last = await getLastSync(db, c.org_id);
      const reviewCount = await db.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM reviews WHERE org_id = ?',
        [c.org_id],
      );
      statuses.push({
        org_id: c.org_id,
        name: c.name,
        role: c.role,
        reviews_in_db: reviewCount!.cnt,
        last_sync: last?.finished_at ?? 'never',
        last_sync_type: last?.sync_type ?? '—',
        last_status: last?.status ?? '—',
      });
    }

    if (isJsonMode(opts)) {
      outputJson(statuses);
    } else {
      if (statuses.length === 0) {
        console.log('No companies tracked.');
        return;
      }
      outputTable(
        ['org_id', 'name', 'reviews', 'last sync', 'type', 'status'],
        statuses.map(s => [
          s.org_id,
          s.name ?? '—',
          String(s.reviews_in_db),
          s.last_sync,
          s.last_sync_type,
          s.last_status,
        ]),
      );
    }
    await db.close();
  });
