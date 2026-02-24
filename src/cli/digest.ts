import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { queryReviews } from '../db/reviews.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const digestCommand = new Command('digest')
  .description('Compact review listing optimized for AI consumption')
  .argument('<org_id>', 'Organization ID')
  .option('--since <date>', 'Reviews since date (YYYY-MM-DD)')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--limit <n>', 'Max results (default: 50)')
  .option('--no-truncate', 'Show full review text')
  .option('--json', 'Force JSON output')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);

    let starsMin: number | undefined;
    let starsMax: number | undefined;
    if (opts.stars) {
      const parts = opts.stars.split('-');
      starsMin = parseFloat(parts[0]);
      starsMax = parts.length > 1 ? parseFloat(parts[1]) : starsMin;
    }

    const reviews = queryReviews(db, orgId, {
      since: opts.since,
      starsMin,
      starsMax,
      limit: opts.limit ? parseInt(opts.limit, 10) : 50,
    });

    const maxLen = opts.truncate === false ? Infinity : 200;
    const digest = reviews.map(r => ({
      date: r.date?.split('T')[0] ?? null,
      stars: r.stars,
      text: r.text && r.text.length > maxLen ? r.text.slice(0, maxLen) + '…' : r.text,
      has_response: r.business_response != null,
    }));

    if (isJsonMode(opts)) {
      outputJson(digest);
    } else {
      if (digest.length === 0) {
        console.log('No reviews found.');
        return;
      }
      outputTable(
        ['date', 'stars', 'text', 'resp'],
        digest.map(r => [
          r.date ?? '—',
          String(r.stars),
          truncate(r.text, 60),
          r.has_response ? 'yes' : '',
        ]),
      );
      console.log(`\n${digest.length} reviews`);
    }
    db.close();
  });
