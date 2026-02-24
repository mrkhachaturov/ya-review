import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { getLastSync } from '../db/sync-log.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const statusCommand = new Command('status')
  .description('Show sync status for all tracked companies')
  .option('--json', 'Force JSON output')
  .action((opts) => {
    const db = openDb(config.dbPath);
    const companies = listCompanies(db);

    const statuses = companies.map(c => {
      const last = getLastSync(db, c.org_id);
      const reviewCount = db.prepare('SELECT COUNT(*) as cnt FROM reviews WHERE org_id = ?')
        .get(c.org_id) as { cnt: number };
      return {
        org_id: c.org_id,
        name: c.name,
        role: c.role,
        reviews_in_db: reviewCount.cnt,
        last_sync: last?.finished_at ?? 'never',
        last_sync_type: last?.sync_type ?? '—',
        last_status: last?.status ?? '—',
      };
    });

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
    db.close();
  });
