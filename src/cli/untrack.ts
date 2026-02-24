import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { removeCompany, getCompany } from '../db/companies.js';

export const untrackCommand = new Command('untrack')
  .description('Stop tracking an organization and remove its data')
  .argument('<org_id>', 'Yandex Maps organization ID')
  .action(async (orgId: string) => {
    const db = await createDbClient(config);
    await initSchema(db);
    const company = await getCompany(db, orgId);
    if (!company) {
      console.error(`Organization ${orgId} is not being tracked.`);
      process.exit(1);
    }
    await removeCompany(db, orgId);
    console.log(`Stopped tracking ${company.name ?? orgId}. All data removed.`);
    await db.close();
  });
