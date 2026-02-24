import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { getCompany } from '../db/companies.js';
import { addCompetitor, removeCompetitor, getCompetitors } from '../db/competitors.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const competitorCommand = new Command('competitor')
  .description('Manage competitor relationships');

competitorCommand
  .command('add')
  .description('Add a competitor to a company')
  .requiredOption('--org <org_id>', 'Your company org ID')
  .requiredOption('--competitor <org_id>', 'Competitor org ID')
  .action(async (opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    if (!await getCompany(db, opts.org)) {
      console.error(`Company ${opts.org} not tracked. Run \`yarev track ${opts.org}\` first.`);
      process.exit(1);
    }
    if (!await getCompany(db, opts.competitor)) {
      console.error(`Competitor ${opts.competitor} not tracked. Run \`yarev track ${opts.competitor}\` first.`);
      process.exit(1);
    }
    await addCompetitor(db, opts.org, opts.competitor);
    console.log(`Added competitor ${opts.competitor} to ${opts.org}`);
    await db.close();
  });

competitorCommand
  .command('rm')
  .description('Remove a competitor from a company')
  .requiredOption('--org <org_id>', 'Your company org ID')
  .requiredOption('--competitor <org_id>', 'Competitor org ID')
  .action(async (opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    await removeCompetitor(db, opts.org, opts.competitor);
    console.log(`Removed competitor ${opts.competitor} from ${opts.org}`);
    await db.close();
  });

competitorCommand
  .command('list')
  .description('List competitors for a company')
  .requiredOption('--org <org_id>', 'Company org ID')
  .option('--json', 'Force JSON output')
  .action(async (opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    const competitors = await getCompetitors(db, opts.org);

    if (isJsonMode(opts)) {
      outputJson(competitors.map(c => ({
        org_id: c.org_id, name: c.name, rating: c.rating, review_count: c.review_count,
      })));
    } else {
      if (competitors.length === 0) {
        console.log('No competitors configured.');
        return;
      }
      outputTable(
        ['org_id', 'name', 'rating', 'reviews'],
        competitors.map(c => [
          c.org_id, c.name ?? '—', c.rating?.toFixed(1) ?? '—', String(c.review_count ?? '—'),
        ]),
      );
    }
    await db.close();
  });
