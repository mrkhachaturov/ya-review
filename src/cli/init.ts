import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { execSync } from 'node:child_process';
import type { BrowserBackend } from '../types/index.js';

export const initCommand = new Command('init')
  .description('Initialize database and install browser')
  .option('--backend <backend>', 'Browser to install: patchright, playwright', config.browserBackend)
  .action(async (opts) => {
    // Create DB
    const db = await createDbClient(config);
    await initSchema(db);
    await db.close();
    console.log(`Database created at ${config.dbPath}`);

    // Install browser
    const backend = opts.backend as BrowserBackend;
    try {
      if (backend === 'patchright') {
        console.log('Installing Patchright Chromium...');
        execSync('npx patchright install chromium', { stdio: 'inherit' });
      } else if (backend === 'playwright') {
        console.log('Installing Playwright Chromium...');
        execSync('npx playwright install chromium', { stdio: 'inherit' });
      } else {
        console.log('Remote backend selected — no local browser to install.');
      }
      console.log('Done. Run `yarev track <org_id>` to start tracking an organization.');
    } catch (err) {
      console.error(`Failed to install browser: ${err}`);
      process.exit(1);
    }
  });
