import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies, upsertCompany } from '../db/companies.js';
import { upsertReviews } from '../db/reviews.js';
import { logSync } from '../db/sync-log.js';
import { createBrowser } from '../scraper/browser.js';
import { scrapeReviews } from '../scraper/reviews.js';

export const daemonCommand = new Command('daemon')
  .description('Run scheduled sync in the background')
  .option('--cron <expression>', 'Cron expression for schedule', config.daemonCron)
  .action(async (opts) => {
    let nodeCron;
    try {
      nodeCron = await import('node-cron');
    } catch {
      console.error('node-cron not available. Install with: npm install node-cron');
      process.exit(1);
    }

    console.log(`Starting daemon with schedule: ${opts.cron}`);

    const runSync = async () => {
      const db = openDb(config.dbPath);
      const companies = listCompanies(db);
      if (companies.length === 0) {
        console.log(`[${new Date().toISOString()}] No companies to sync.`);
        db.close();
        return;
      }

      let browser;
      try {
        browser = await createBrowser(config);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Browser error: ${err}`);
        db.close();
        return;
      }

      for (const company of companies) {
        const startedAt = new Date().toISOString();
        const isFull = !db.prepare(
          'SELECT id FROM sync_log WHERE org_id = ? AND status = ? LIMIT 1'
        ).get(company.org_id, 'ok');

        try {
          console.log(`[${new Date().toISOString()}] Syncing ${company.name ?? company.org_id}...`);
          const result = await scrapeReviews(browser, company.org_id, config, { full: isFull });

          upsertCompany(db, {
            org_id: company.org_id,
            name: result.company.name,
            rating: result.company.rating,
            review_count: result.company.review_count,
            address: result.company.address,
            categories: result.company.categories,
            role: company.role,
          });

          const { added, updated } = upsertReviews(db, company.org_id, result.reviews);

          logSync(db, {
            org_id: company.org_id,
            sync_type: isFull ? 'full' : 'incremental',
            reviews_added: added,
            reviews_updated: updated,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            status: 'ok',
          });

          console.log(`  +${added} new, ~${updated} updated`);
        } catch (err) {
          logSync(db, {
            org_id: company.org_id,
            sync_type: isFull ? 'full' : 'incremental',
            reviews_added: 0,
            reviews_updated: 0,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            status: 'error',
            error_message: String(err),
          });
          console.error(`  Error: ${err}`);
        }
      }

      await browser.close();
      db.close();
    };

    // Run immediately on start
    await runSync();

    // Schedule future runs
    nodeCron.default.schedule(opts.cron, runSync);
    console.log(`Daemon running. Next sync per cron: ${opts.cron}`);
  });
