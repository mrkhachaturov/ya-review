import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getCompany } from '../db/companies.js';
import { getCompetitors } from '../db/competitors.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const compareCommand = new Command('compare')
  .description('Compare your company against its competitors')
  .requiredOption('--org <org_id>', 'Your company org ID')
  .option('--json', 'Force JSON output')
  .action((opts) => {
    const db = openDb(config.dbPath);
    const company = getCompany(db, opts.org);
    if (!company) {
      console.error(`Company ${opts.org} not tracked.`);
      process.exit(1);
    }

    const competitors = getCompetitors(db, opts.org);

    // Calculate avg stars from local DB
    const avgStars = (orgId: string): number | null => {
      const row = db.prepare(
        'SELECT AVG(stars) as avg FROM reviews WHERE org_id = ?'
      ).get(orgId) as { avg: number | null } | undefined;
      return row?.avg ?? null;
    };

    const reviewCount = (orgId: string): number => {
      const row = db.prepare(
        'SELECT COUNT(*) as cnt FROM reviews WHERE org_id = ?'
      ).get(orgId) as { cnt: number };
      return row.cnt;
    };

    const companyData = {
      org_id: company.org_id,
      name: company.name,
      rating: company.rating,
      review_count: company.review_count,
      reviews_in_db: reviewCount(company.org_id),
      avg_stars: avgStars(company.org_id),
    };

    const competitorData = competitors.map(c => ({
      org_id: c.org_id,
      name: c.name,
      rating: c.rating,
      review_count: c.review_count,
      reviews_in_db: reviewCount(c.org_id),
      avg_stars: avgStars(c.org_id),
    }));

    if (isJsonMode(opts)) {
      outputJson({ company: companyData, competitors: competitorData });
    } else {
      const all = [companyData, ...competitorData];
      outputTable(
        ['', 'org_id', 'name', 'rating', 'reviews', 'in DB', 'avg stars'],
        all.map((c, i) => [
          i === 0 ? '>>>' : '   ',
          c.org_id,
          c.name ?? '—',
          c.rating?.toFixed(1) ?? '—',
          String(c.review_count ?? '—'),
          String(c.reviews_in_db),
          c.avg_stars?.toFixed(2) ?? '—',
        ]),
      );
    }
    db.close();
  });
