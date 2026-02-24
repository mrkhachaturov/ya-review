import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const unansweredCommand = new Command('unanswered')
  .description('List reviews without a business response')
  .argument('<org_id>', 'Organization ID')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--since <date>', 'Reviews since date (YYYY-MM-DD)')
  .option('--limit <n>', 'Max results (default: 50)')
  .option('--json', 'Force JSON output')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);

    const conditions = ['org_id = ?', 'business_response IS NULL'];
    const params: (string | number)[] = [orgId];

    if (opts.since) {
      conditions.push('date >= ?');
      params.push(opts.since);
    }
    if (opts.stars) {
      const parts = opts.stars.split('-');
      const min = parseFloat(parts[0]);
      const max = parts.length > 1 ? parseFloat(parts[1]) : min;
      conditions.push('stars >= ?', 'stars <= ?');
      params.push(min, max);
    }

    const where = conditions.join(' AND ');
    const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

    const rows = db.prepare(`
      SELECT date, stars, text, author_name, review_url
      FROM reviews WHERE ${where}
      ORDER BY date DESC LIMIT ?
    `).all(...params, limit) as {
      date: string | null; stars: number; text: string | null;
      author_name: string | null; review_url: string | null;
    }[];

    if (isJsonMode(opts)) {
      outputJson(rows.map(r => ({
        date: r.date?.split('T')[0] ?? null,
        stars: r.stars,
        text: r.text,
        author_name: r.author_name,
        review_url: r.review_url,
      })));
    } else {
      if (rows.length === 0) {
        console.log('No unanswered reviews found.');
        return;
      }
      outputTable(
        ['date', 'stars', 'author', 'text'],
        rows.map(r => [
          r.date?.split('T')[0] ?? '—',
          String(r.stars),
          truncate(r.author_name, 15),
          truncate(r.text, 50),
        ]),
      );
      console.log(`\n${rows.length} unanswered reviews`);
    }
    db.close();
  });
