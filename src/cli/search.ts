import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { searchReviews } from '../db/stats.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const searchCommand = new Command('search')
  .description('Search review text across organizations')
  .argument('<text>', 'Text to search for')
  .option('--org <org_id>', 'Limit search to one organization')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--limit <n>', 'Max results (default: 50)')
  .option('--json', 'Force JSON output')
  .action((text: string, opts) => {
    const db = openDb(config.dbPath);

    let starsMin: number | undefined;
    let starsMax: number | undefined;
    if (opts.stars) {
      const parts = opts.stars.split('-');
      starsMin = parseFloat(parts[0]);
      starsMax = parts.length > 1 ? parseFloat(parts[1]) : starsMin;
    }

    const results = searchReviews(db, text, {
      orgId: opts.org,
      starsMin,
      starsMax,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });

    if (isJsonMode(opts)) {
      outputJson(results);
    } else {
      if (results.length === 0) {
        console.log('No reviews found.');
        return;
      }
      outputTable(
        ['org_id', 'date', 'stars', 'text', 'resp'],
        results.map(r => [
          r.org_id,
          r.date?.split('T')[0] ?? '—',
          String(r.stars),
          truncate(r.text, 50),
          r.has_response ? 'yes' : '',
        ]),
      );
      console.log(`\n${results.length} results`);
    }
    db.close();
  });
