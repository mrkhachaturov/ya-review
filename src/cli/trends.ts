import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getTrends } from '../db/stats.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const trendsCommand = new Command('trends')
  .description('Show review trends over time')
  .argument('<org_id>', 'Organization ID')
  .option('--period <type>', 'Group by: week, month, quarter (default: month)', 'month')
  .option('--since <date>', 'Reviews since date (YYYY-MM-DD)')
  .option('--limit <n>', 'Max periods to show')
  .option('--json', 'Force JSON output')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);
    const trends = getTrends(db, orgId, {
      groupBy: opts.period as 'week' | 'month' | 'quarter',
      since: opts.since,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });

    if (isJsonMode(opts)) {
      outputJson(trends);
    } else {
      if (trends.length === 0) {
        console.log('No review data found.');
        return;
      }
      outputTable(
        ['period', 'count', 'avg stars', 'bar'],
        trends.map(t => [
          t.period,
          String(t.count),
          String(t.avg_stars),
          '█'.repeat(Math.min(t.count, 40)),
        ]),
      );
    }
    db.close();
  });
