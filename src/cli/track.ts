import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { upsertCompany, getCompany } from '../db/companies.js';
import type { CompanyRole } from '../types/index.js';

export const trackCommand = new Command('track')
  .description('Start tracking a Yandex Maps organization')
  .argument('<org_id>', 'Yandex Maps organization ID')
  .option('--name <name>', 'Business name (auto-detected on first sync)')
  .option('--role <role>', 'Role: mine, competitor, tracked', 'tracked')
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);
    const existing = getCompany(db, orgId);
    upsertCompany(db, {
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
    db.close();
  });
