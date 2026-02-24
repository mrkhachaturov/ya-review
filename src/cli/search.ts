import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { searchReviews, semanticSearchReviews, hasEmbeddings } from '../db/stats.js';
import { embedTexts } from '../embeddings/client.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';

export const searchCommand = new Command('search')
  .description('Search review text across organizations')
  .argument('<text>', 'Text to search for')
  .option('--org <org_id>', 'Limit search to one organization')
  .option('--stars <range>', 'Star range, e.g. 1-3 or 5')
  .option('--limit <n>', 'Max results (default: 50)')
  .option('--json', 'Force JSON output')
  .option('--no-semantic', 'Force text-only search (skip embeddings)')
  .action(async (text: string, opts) => {
    const db = await createDbClient(config);
    await initSchema(db);

    let starsMin: number | undefined;
    let starsMax: number | undefined;
    if (opts.stars) {
      const parts = opts.stars.split('-');
      starsMin = parseFloat(parts[0]);
      starsMax = parts.length > 1 ? parseFloat(parts[1]) : starsMin;
    }

    const searchOpts = {
      orgId: opts.org,
      starsMin,
      starsMax,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    };

    // Try semantic search if embeddings exist and API key is set
    const useSemantic = opts.semantic !== false && config.openaiApiKey && await hasEmbeddings(db);
    let results;
    let mode = 'text';

    if (useSemantic) {
      try {
        const [queryVec] = await embedTexts([text]);
        results = await semanticSearchReviews(db, queryVec, searchOpts);
        mode = 'semantic';
      } catch {
        // Fall back to text search if embedding fails
        results = await searchReviews(db, text, searchOpts);
      }
    } else {
      results = await searchReviews(db, text, searchOpts);
    }

    if (isJsonMode(opts)) {
      outputJson(results);
    } else {
      if (results.length === 0) {
        console.log('No reviews found.');
        await db.close();
        return;
      }

      const headers = mode === 'semantic'
        ? ['org_id', 'sim', 'date', 'stars', 'text', 'resp']
        : ['org_id', 'date', 'stars', 'text', 'resp'];

      const rows = results.map(r => {
        const base = [
          r.org_id,
          r.date?.split('T')[0] ?? '—',
          String(r.stars),
          truncate(r.text, 50),
          r.has_response ? 'yes' : '',
        ];
        if (mode === 'semantic' && 'similarity' in r) {
          base.splice(1, 0, (r as any).similarity.toFixed(3));
        }
        return base;
      });

      outputTable(headers, rows);
      console.log(`\n${results.length} results (${mode} search)`);
    }
    await db.close();
  });
