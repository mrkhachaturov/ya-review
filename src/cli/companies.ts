import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { isJsonMode, outputJson, outputTable, truncate } from './helpers.js';
import type { CompanyRole } from '../types/index.js';

export const companiesCommand = new Command('companies')
  .description('List tracked companies')
  .option('--role <role>', 'Filter by role: mine, competitor, tracked')
  .option('--json', 'Force JSON output')
  .action((opts) => {
    const db = openDb(config.dbPath);
    const companies = listCompanies(db, opts.role as CompanyRole | undefined);

    if (isJsonMode(opts)) {
      outputJson(companies.map(c => ({
        org_id: c.org_id,
        name: c.name,
        rating: c.rating,
        review_count: c.review_count,
        role: c.role,
        address: c.address,
      })));
    } else {
      if (companies.length === 0) {
        console.log('No companies tracked. Run `yarev track <org_id>` to start.');
        return;
      }
      outputTable(
        ['org_id', 'name', 'rating', 'reviews', 'role'],
        companies.map(c => [
          c.org_id,
          truncate(c.name, 30),
          c.rating?.toFixed(1) ?? '—',
          String(c.review_count ?? '—'),
          c.role,
        ]),
      );
    }
    db.close();
  });
