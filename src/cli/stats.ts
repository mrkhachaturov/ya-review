import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getStats } from '../db/stats.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const statsCommand = new Command('stats')
  .description('Show review statistics for an organization')
  .argument('<org_id>', 'Organization ID')
  .option('--since <date>', 'Only include reviews since date (YYYY-MM-DD)')
  .option('--json', 'Force JSON output')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);
    const stats = getStats(db, orgId, { since: opts.since });

    if (isJsonMode(opts)) {
      outputJson(stats);
    } else {
      console.log(`${stats.name ?? orgId} (${stats.org_id})`);
      console.log(`Yandex rating: ${stats.rating ?? '—'}  |  Avg stars in DB: ${stats.avg_stars}`);
      console.log(`Total reviews: ${stats.total_reviews}  |  With text: ${stats.reviews_with_text}`);
      console.log(`Response rate: ${(stats.response_rate * 100).toFixed(0)}%`);
      console.log(`Period: ${stats.period.first ?? '—'} → ${stats.period.last ?? '—'}`);
      console.log();
      outputTable(
        ['stars', 'count', 'bar'],
        ['5', '4', '3', '2', '1'].map(s => [
          s,
          String(stats.star_distribution[s]),
          '█'.repeat(Math.round((stats.star_distribution[s] / Math.max(stats.total_reviews, 1)) * 30)),
        ]),
      );
    }
    db.close();
  });
