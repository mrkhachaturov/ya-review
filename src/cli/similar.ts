import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { getReviewEmbedding } from '../db/embeddings.js';
import { semanticSearchReviews } from '../db/stats.js';
import { embedTexts } from '../embeddings/client.js';
import { sqlToEmbedding } from '../db/sql-helpers.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const similarCommand = new Command('similar')
  .description('Find semantically similar reviews')
  .option('--text <text>', 'Find reviews similar to this text')
  .option('--review <id>', 'Find reviews similar to this review ID')
  .option('--org <org_id>', 'Limit to one organization')
  .option('--limit <n>', 'Max results (default: 10)', '10')
  .option('--json', 'Force JSON output')
  .action(async (opts) => {
    if (!opts.text && !opts.review) {
      console.error('Provide either --text or --review');
      process.exitCode = 1;
      return;
    }

    const db = await createDbClient(config);
    await initSchema(db);
    let queryVec: number[];

    if (opts.review) {
      const reviewId = parseInt(opts.review, 10);
      const emb = await getReviewEmbedding(db, reviewId);
      if (!emb) {
        console.error(`No embedding found for review ${reviewId}. Run: yarev embed`);
        await db.close();
        process.exitCode = 1;
        return;
      }
      queryVec = sqlToEmbedding(db, emb.text_embedding);
    } else {
      const [vec] = await embedTexts([opts.text]);
      queryVec = vec;
    }

    const results = await semanticSearchReviews(db, queryVec, {
      orgId: opts.org,
      limit: parseInt(opts.limit, 10),
    });

    if (isJsonMode(opts)) {
      outputJson(results);
    } else {
      if (results.length === 0) {
        console.log('No similar reviews found.');
        await db.close();
        return;
      }
      outputTable(
        ['org_id', 'sim', 'date', 'stars', 'text'],
        results.map(r => [
          r.org_id,
          r.similarity.toFixed(3),
          r.date?.split('T')[0] ?? '—',
          String(r.stars),
          truncate(r.text, 60),
        ]),
      );
      console.log(`\n${results.length} similar reviews`);
    }
    await db.close();
  });
