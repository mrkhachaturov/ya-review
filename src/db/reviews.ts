import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Review } from '../types/index.js';

export interface ReviewRow {
  id: number;
  org_id: string;
  review_key: string;
  author_name: string | null;
  author_icon_url: string | null;
  author_profile_url: string | null;
  date: string | null;
  text: string | null;
  stars: number;
  likes: number;
  dislikes: number;
  review_url: string | null;
  business_response: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface UpsertResult {
  added: number;
  updated: number;
}

export interface QueryReviewsOpts {
  since?: string;
  starsMin?: number;
  starsMax?: number;
  limit?: number;
}

export function reviewKey(
  orgId: string,
  review: { review_url: string | null; author_name: string | null; date: string | null; text: string | null },
): string {
  if (review.review_url) return review.review_url;
  const raw = `${orgId}|${review.author_name ?? ''}|${review.date ?? ''}|${(review.text ?? '').slice(0, 100)}`;
  return 'sha256:' + createHash('sha256').update(raw).digest('hex');
}

export function upsertReviews(db: Database.Database, orgId: string, reviews: Review[]): UpsertResult {
  let added = 0;
  let updated = 0;

  const insertStmt = db.prepare(`
    INSERT INTO reviews (org_id, review_key, author_name, author_icon_url, author_profile_url,
      date, text, stars, likes, dislikes, review_url, business_response)
    VALUES (@org_id, @review_key, @author_name, @author_icon_url, @author_profile_url,
      @date, @text, @stars, @likes, @dislikes, @review_url, @business_response)
    ON CONFLICT(review_key) DO UPDATE SET
      text = @text,
      stars = @stars,
      likes = @likes,
      dislikes = @dislikes,
      business_response = @business_response,
      updated_at = datetime('now')
  `);

  const existsStmt = db.prepare('SELECT id FROM reviews WHERE review_key = ?');

  const upsertMany = db.transaction((items: Review[]) => {
    for (const r of items) {
      const key = reviewKey(orgId, r);
      const exists = existsStmt.get(key);
      insertStmt.run({
        org_id: orgId,
        review_key: key,
        author_name: r.author_name,
        author_icon_url: r.author_icon_url,
        author_profile_url: r.author_profile_url,
        date: r.date,
        text: r.text,
        stars: r.stars,
        likes: r.likes,
        dislikes: r.dislikes,
        review_url: r.review_url,
        business_response: r.business_response,
      });
      if (exists) updated++; else added++;
    }
  });

  upsertMany(reviews);
  return { added, updated };
}

export function queryReviews(db: Database.Database, orgId: string, opts: QueryReviewsOpts = {}): ReviewRow[] {
  const conditions = ['org_id = ?'];
  const params: (string | number)[] = [orgId];

  if (opts.since) {
    conditions.push('date >= ?');
    params.push(opts.since);
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
  const limit = opts.limit ? `LIMIT ${opts.limit}` : '';
  return db.prepare(`SELECT * FROM reviews WHERE ${where} ORDER BY date DESC ${limit}`).all(...params) as ReviewRow[];
}
