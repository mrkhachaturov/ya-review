import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { listCompanies, upsertCompany } from '../db/companies.js';
import { upsertReviews } from '../db/reviews.js';
import { logSync } from '../db/sync-log.js';
import { createBrowser } from '../scraper/browser.js';
import { scrapeReviews } from '../scraper/reviews.js';

export const daemonCommand = new Command('daemon')
  .description('Run scheduled sync in the background')
  .option('--cron <expression>', 'Cron expression for schedule', config.daemonCron)
  .option('--embed-cron <cron>', 'Cron expression for embed pipeline', config.embedCron)
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
      const db = await createDbClient(config);
      await initSchema(db);
      const companies = await listCompanies(db);
      if (companies.length === 0) {
        console.log(`[${new Date().toISOString()}] No companies to sync.`);
        await db.close();
        return;
      }

      let browser;
      try {
        browser = await createBrowser(config);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Browser error: ${err}`);
        await db.close();
        return;
      }

      for (const company of companies) {
        const startedAt = new Date().toISOString();
        const hasPriorSync = await db.get<{ id: number }>(
          'SELECT id FROM sync_log WHERE org_id = ? AND status = ? LIMIT 1',
          [company.org_id, 'ok'],
        );
        const isFull = !hasPriorSync;

        try {
          console.log(`[${new Date().toISOString()}] Syncing ${company.name ?? company.org_id}...`);
          const result = await scrapeReviews(browser, company.org_id, config, { full: isFull });

          await upsertCompany(db, {
            org_id: company.org_id,
            name: result.company.name,
            rating: result.company.rating,
            review_count: result.company.review_count,
            address: result.company.address,
            categories: result.company.categories,
            role: company.role,
          });

          const { added, updated } = await upsertReviews(db, company.org_id, result.reviews);

          await logSync(db, {
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
          await logSync(db, {
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
      await db.close();
    };

    const runEmbed = async () => {
      console.log(`[${new Date().toISOString()}] Running embed pipeline...`);
    };

    // Run immediately on start
    await runSync();

    // Schedule future runs
    nodeCron.default.schedule(opts.cron, runSync);
    console.log(`Daemon running. Next sync per cron: ${opts.cron}`);

    // Schedule embed pipeline
    const embedCronExpr = opts.embedCron ?? config.embedCron;
    nodeCron.default.schedule(embedCronExpr, runEmbed);
    console.log(`Embed pipeline scheduled. Next run per cron: ${embedCronExpr}`);
  });
