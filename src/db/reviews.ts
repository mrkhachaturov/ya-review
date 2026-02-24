import { createHash } from 'node:crypto';
import type { DbClient } from './driver.js';
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

export async function upsertReviews(db: DbClient, orgId: string, reviews: Review[]): Promise<UpsertResult> {
  let added = 0;
  let updated = 0;

  await db.transaction(async () => {
    for (const r of reviews) {
      const key = reviewKey(orgId, r);
      const exists = await db.get<{ id: number }>('SELECT id FROM reviews WHERE review_key = ?', [key]);

      await db.run(
        `INSERT INTO reviews (org_id, review_key, author_name, author_icon_url, author_profile_url,
          date, text, stars, likes, dislikes, review_url, business_response)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(review_key) DO UPDATE SET
          text = ?,
          stars = ?,
          likes = ?,
          dislikes = ?,
          business_response = ?,
          updated_at = ?`,
        [
          orgId, key, r.author_name, r.author_icon_url, r.author_profile_url,
          r.date, r.text, r.stars, r.likes, r.dislikes, r.review_url, r.business_response,
          r.text, r.stars, r.likes, r.dislikes, r.business_response,
          new Date().toISOString(),
        ],
      );

      if (exists) updated++; else added++;
    }
  });

  return { added, updated };
}

export async function queryReviews(db: DbClient, orgId: string, opts: QueryReviewsOpts = {}): Promise<ReviewRow[]> {
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
  return db.all<ReviewRow>(`SELECT * FROM reviews WHERE ${where} ORDER BY date DESC ${limit}`, params);
}
