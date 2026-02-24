import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies, upsertCompany } from '../db/companies.js';
import { upsertReviews } from '../db/reviews.js';
import { logSync } from '../db/sync-log.js';
import { createBrowser } from '../scraper/browser.js';
import { scrapeReviews } from '../scraper/reviews.js';
import { isJsonMode, outputJson } from './helpers.js';
import type { BrowserBackend } from '../types/index.js';

export const syncCommand = new Command('sync')
  .description('Sync reviews for tracked organizations')
  .option('--org <org_id>', 'Sync only this organization')
  .option('--full', 'Force full scrape (scroll all pages)', false)
  .option('--backend <backend>', 'Override browser backend')
  .option('--browser-url <url>', 'Remote browser WebSocket URL')
  .option('--json', 'Force JSON output')
  .action(async (opts) => {
    const db = openDb(config.dbPath);
    const cfg = {
      ...config,
      ...(opts.backend ? { browserBackend: opts.backend as BrowserBackend } : {}),
      ...(opts.browserUrl ? { browserWsUrl: opts.browserUrl } : {}),
    };

    const companies = opts.org
      ? listCompanies(db).filter(c => c.org_id === opts.org)
      : listCompanies(db);

    if (companies.length === 0) {
      console.error(opts.org
        ? `Organization ${opts.org} is not being tracked.`
        : 'No companies tracked. Run `yarev track <org_id>` first.');
      process.exit(1);
    }

    let browser;
    try {
      browser = await createBrowser(cfg);
    } catch (err) {
      console.error(`Failed to start browser: ${err}`);
      process.exit(1);
    }

    const results = [];

    for (const company of companies) {
      const startedAt = new Date().toISOString();
      const isFull = opts.full || !db.prepare(
        'SELECT id FROM sync_log WHERE org_id = ? AND status = ? LIMIT 1'
      ).get(company.org_id, 'ok');

      try {
        if (!isJsonMode(opts)) {
          console.log(`Syncing ${company.name ?? company.org_id} (${isFull ? 'full' : 'incremental'})...`);
        }

        const result = await scrapeReviews(browser, company.org_id, cfg, { full: isFull });

        // Update company metadata
        upsertCompany(db, {
          org_id: company.org_id,
          name: result.company.name,
          rating: result.company.rating,
          review_count: result.company.review_count,
          address: result.company.address,
          categories: result.company.categories,
          role: company.role,
        });

        // Upsert reviews
        const { added, updated } = upsertReviews(db, company.org_id, result.reviews);

        const finishedAt = new Date().toISOString();
        logSync(db, {
          org_id: company.org_id,
          sync_type: isFull ? 'full' : 'incremental',
          reviews_added: added,
          reviews_updated: updated,
          started_at: startedAt,
          finished_at: finishedAt,
          status: 'ok',
        });

        const summary = {
          org_id: company.org_id,
          name: result.company.name,
          sync_type: isFull ? 'full' : 'incremental',
          reviews_scraped: result.reviews.length,
          reviews_added: added,
          reviews_updated: updated,
          status: 'ok',
        };
        results.push(summary);

        if (!isJsonMode(opts)) {
          console.log(`  ${added} added, ${updated} updated (${result.reviews.length} scraped)`);
        }
      } catch (err) {
        const finishedAt = new Date().toISOString();
        logSync(db, {
          org_id: company.org_id,
          sync_type: isFull ? 'full' : 'incremental',
          reviews_added: 0,
          reviews_updated: 0,
          started_at: startedAt,
          finished_at: finishedAt,
          status: 'error',
          error_message: String(err),
        });

        results.push({
          org_id: company.org_id,
          name: company.name,
          status: 'error',
          error: String(err),
        });

        if (!isJsonMode(opts)) {
          console.error(`  Error: ${err}`);
        }
      }
    }

    await browser.close();
    db.close();

    if (isJsonMode(opts)) {
      outputJson(results);
    }
  });
