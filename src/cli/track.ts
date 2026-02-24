import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { upsertCompany, getCompany } from '../db/companies.js';
import type { CompanyRole } from '../types/index.js';

export const trackCommand = new Command('track')
  .description('Start tracking a Yandex Maps organization')
  .argument('<org_id>', 'Yandex Maps organization ID')
  .option('--name <name>', 'Business name (auto-detected on first sync)')
  .option('--role <role>', 'Role: mine, competitor, tracked', 'tracked')
  .action(async (orgId: string, opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    const existing = await getCompany(db, orgId);
    await upsertCompany(db, {
      org_id: orgId,
      name: opts.name,
      role: opts.role as CompanyRole,
    });
    if (existing) {
      console.log(`Updated org ${orgId} (role: ${opts.role})`);
    } else {
      console.log(`Now tracking org ${orgId} (role: ${opts.role})`);
      console.log('Run `yarev sync --org ' + orgId + ' --full` for initial full scrape.');
    }
    await db.close();
  });
