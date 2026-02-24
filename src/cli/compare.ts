import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { getCompany } from '../db/companies.js';
import { getCompetitors } from '../db/competitors.js';
import { isJsonMode, outputJson, outputTable } from './helpers.js';

export const compareCommand = new Command('compare')
  .description('Compare your company against its competitors')
  .requiredOption('--org <org_id>', 'Your company org ID')
  .option('--json', 'Force JSON output')
  .action(async (opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    const company = await getCompany(db, opts.org);
    if (!company) {
      console.error(`Company ${opts.org} not tracked.`);
      process.exit(1);
    }

    const competitors = await getCompetitors(db, opts.org);

    // Calculate avg stars from local DB
    const avgStars = async (orgId: string): Promise<number | null> => {
      const row = await db.get<{ avg: number | null }>(
        'SELECT AVG(stars) as avg FROM reviews WHERE org_id = ?',
        [orgId],
      );
      return row?.avg ?? null;
    };

    const reviewCount = async (orgId: string): Promise<number> => {
      const row = await db.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM reviews WHERE org_id = ?',
        [orgId],
      );
      return row!.cnt;
    };

    const companyData = {
      org_id: company.org_id,
      name: company.name,
      rating: company.rating,
      review_count: company.review_count,
      reviews_in_db: await reviewCount(company.org_id),
      avg_stars: await avgStars(company.org_id),
    };

    const competitorData = [];
    for (const c of competitors) {
      competitorData.push({
        org_id: c.org_id,
        name: c.name,
        rating: c.rating,
        review_count: c.review_count,
        reviews_in_db: await reviewCount(c.org_id),
        avg_stars: await avgStars(c.org_id),
      });
    }

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
    await db.close();
  });
