import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { queryReviews } from '../db/reviews.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const reviewsCommand = new Command('reviews')
  .description('Query reviews for an organization')
  .argument('<org_id>', 'Organization ID')
  .option('--since <date>', 'Reviews since date (YYYY-MM-DD)')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--limit <n>', 'Max results')
  .option('--json', 'Force JSON output')
  .action(async (orgId: string, opts) => {
    const db = await createDbClient(config);
    await initSchema(db);

    let starsMin: number | undefined;
    let starsMax: number | undefined;
    if (opts.stars) {
      const parts = opts.stars.split('-');
      starsMin = parseFloat(parts[0]);
      starsMax = parts.length > 1 ? parseFloat(parts[1]) : starsMin;
    }

    const reviews = await queryReviews(db, orgId, {
      since: opts.since,
      starsMin,
      starsMax,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });

    if (isJsonMode(opts)) {
      outputJson(reviews);
    } else {
      if (reviews.length === 0) {
        console.log('No reviews found.');
        return;
      }
      outputTable(
        ['date', 'stars', 'author', 'text', 'response'],
        reviews.map(r => [
          r.date ?? '—',
          String(r.stars),
          truncate(r.author_name, 15),
          truncate(r.text, 40),
          r.business_response ? 'yes' : '',
        ]),
      );
      console.log(`\n${reviews.length} reviews`);
    }
    await db.close();
  });
