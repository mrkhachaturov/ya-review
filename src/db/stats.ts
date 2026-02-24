import type { DbClient } from './driver.js';
import { cosineSimilarity } from '../embeddings/vectors.js';
import { sqlToEmbedding } from './sql-helpers.js';

export interface StatsResult {
  org_id: string;
  name: string | null;
  rating: number | null;
  total_reviews: number;
  star_distribution: Record<string, number>;
  avg_stars: number;
  response_rate: number;
  reviews_with_text: number;
  period: { first: string | null; last: string | null };
}

export interface StatsOpts {
  since?: string;
}

export async function getStats(db: DbClient, orgId: string, opts: StatsOpts = {}): Promise<StatsResult> {
  const company = await db.get<{ name: string | null; rating: number | null }>(
    'SELECT name, rating FROM companies WHERE org_id = ?',
    [orgId],
  );

  const sinceClause = opts.since ? ' AND date >= ?' : '';
  const params: (string | number)[] = [orgId];
  if (opts.since) params.push(opts.since);

  const agg = await db.get<{
    total: number; avg_stars: number; responded: number;
    with_text: number; first_date: string | null; last_date: string | null;
  }>(`
    SELECT
      COUNT(*) as total,
      COALESCE(AVG(stars), 0) as avg_stars,
      COALESCE(SUM(CASE WHEN business_response IS NOT NULL THEN 1 ELSE 0 END), 0) as responded,
      COALESCE(SUM(CASE WHEN text IS NOT NULL AND text != '' THEN 1 ELSE 0 END), 0) as with_text,
      MIN(date) as first_date,
      MAX(date) as last_date
    FROM reviews WHERE org_id = ?${sinceClause}
  `, params);

  const distRows = await db.all<{ star: number; cnt: number }>(`
    SELECT CAST(ROUND(stars) AS INTEGER) as star, COUNT(*) as cnt
    FROM reviews WHERE org_id = ?${sinceClause}
    GROUP BY CAST(ROUND(stars) AS INTEGER)
  `, params);

  const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const row of distRows) dist[String(row.star)] = row.cnt;

  return {
    org_id: orgId,
    name: company?.name ?? null,
    rating: company?.rating ?? null,
    total_reviews: agg!.total,
    star_distribution: dist,
    avg_stars: Math.round(agg!.avg_stars * 100) / 100,
    response_rate: agg!.total > 0 ? Math.round((agg!.responded / agg!.total) * 100) / 100 : 0,
    reviews_with_text: agg!.with_text,
    period: { first: agg!.first_date, last: agg!.last_date },
  };
}

export interface TrendRow {
  period: string;
  count: number;
  avg_stars: number;
}

export interface TrendsOpts {
  groupBy?: 'week' | 'month' | 'quarter';
  since?: string;
  limit?: number;
}

export async function getTrends(db: DbClient, orgId: string, opts: TrendsOpts = {}): Promise<TrendRow[]> {
  const groupBy = opts.groupBy ?? 'month';
  const fmt = groupBy === 'week' ? '%Y-W%W'
    : groupBy === 'quarter' ? '%Y-Q' : '%Y-%m';

  const sinceClause = opts.since ? ' AND date >= ?' : '';
  const limitClause = opts.limit ? ` LIMIT ${opts.limit}` : '';
  const params: (string | number)[] = [orgId];
  if (opts.since) params.push(opts.since);

  let sql: string;
  if (groupBy === 'quarter') {
    sql = `
      SELECT
        strftime('%Y', date) || '-Q' || ((CAST(strftime('%m', date) AS INTEGER) - 1) / 3 + 1) as period,
        COUNT(*) as count,
        ROUND(AVG(stars), 2) as avg_stars
      FROM reviews
      WHERE org_id = ? AND date IS NOT NULL${sinceClause}
      GROUP BY period
      ORDER BY period DESC${limitClause}
    `;
  } else {
    sql = `
      SELECT
        strftime('${fmt}', date) as period,
        COUNT(*) as count,
        ROUND(AVG(stars), 2) as avg_stars
      FROM reviews
      WHERE org_id = ? AND date IS NOT NULL${sinceClause}
      GROUP BY period
      ORDER BY period DESC${limitClause}
    `;
  }

  return await db.all<TrendRow>(sql, params);
}

export interface SearchOpts {
  orgId?: string;
  starsMin?: number;
  starsMax?: number;
  limit?: number;
}

export interface SearchRow {
  org_id: string;
  date: string | null;
  stars: number;
  text: string | null;
  has_response: boolean;
  author_name: string | null;
}

export interface SemanticSearchRow extends SearchRow {
  similarity: number;
}

export async function semanticSearchReviews(
  db: DbClient,
  queryEmbedding: number[],
  opts: SearchOpts = {},
): Promise<SemanticSearchRow[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.orgId) {
    conditions.push('r.org_id = ?');
    params.push(opts.orgId);
  }
  if (opts.starsMin != null) {
    conditions.push('r.stars >= ?');
    params.push(opts.starsMin);
  }
  if (opts.starsMax != null) {
    conditions.push('r.stars <= ?');
    params.push(opts.starsMax);
  }

  const where = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

  const rows = await db.all<SearchRow & { text_embedding: Buffer }>(`
    SELECT r.org_id, r.date, r.stars, r.text, r.author_name,
      CASE WHEN r.business_response IS NOT NULL THEN 1 ELSE 0 END as has_response,
      re.text_embedding
    FROM reviews r
    JOIN review_embeddings re ON r.id = re.review_id
    WHERE r.text IS NOT NULL AND r.text != '' ${where}
  `, params);

  const scored = rows
    .map(r => {
      const vec = sqlToEmbedding(db, r.text_embedding);
      const similarity = cosineSimilarity(queryEmbedding, vec);
      return {
        org_id: r.org_id,
        date: r.date,
        stars: r.stars,
        text: r.text,
        author_name: r.author_name,
        has_response: !!r.has_response,
        similarity,
      };
    })
    .sort((a, b) => b.similarity - a.similarity);

  const limit = opts.limit ?? 50;
  return scored.slice(0, limit);
}

export async function hasEmbeddings(db: DbClient): Promise<boolean> {
  const row = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM review_embeddings');
  return row!.cnt > 0;
}

export async function searchReviews(db: DbClient, query: string, opts: SearchOpts = {}): Promise<SearchRow[]> {
  const conditions = ["text LIKE '%' || ? || '%' COLLATE NOCASE"];
  const params: (string | number)[] = [query];

  if (opts.orgId) {
    conditions.push('org_id = ?');
    params.push(opts.orgId);
  }
  if (opts.starsMin != null) {
    conditions.push('stars >= ?');
    params.push(opts.starsMin);
  }
  if (opts.starsMax != null) {
    conditions.push('stars <= ?');
    params.push(opts.starsMax);
  }

  const where = conditions.join(' AND ');
  const limit = opts.limit ? `LIMIT ${opts.limit}` : 'LIMIT 50';

  const rows = await db.all<SearchRow & { has_response: number | boolean }>(`
    SELECT org_id, date, stars, text, author_name,
      CASE WHEN business_response IS NOT NULL THEN 1 ELSE 0 END as has_response
    FROM reviews WHERE ${where}
    ORDER BY date DESC ${limit}
  `, params);

  return rows.map((r) => ({ ...r, has_response: !!r.has_response }));
}
