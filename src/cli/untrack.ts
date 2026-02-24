import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { removeCompany, getCompany } from '../db/companies.js';

export const untrackCommand = new Command('untrack')
  .description('Stop tracking an organization and remove its data')
  .argument('<org_id>', 'Yandex Maps organization ID')
  .action((orgId: string) => {
    const db = openDb(config.dbPath);
    const company = getCompany(db, orgId);
    if (!company) {
      console.error(`Organization ${orgId} is not being tracked.`);
      process.exit(1);
    }
    removeCompany(db, orgId);
    console.log(`Stopped tracking ${company.name ?? orgId}. All data removed.`);
    db.close();
  });
