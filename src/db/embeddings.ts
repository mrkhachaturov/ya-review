import type { DbClient } from './driver.js';

export interface ReviewEmbeddingRow {
  review_id: number;
  model: string;
  text_embedding: Buffer;
  response_embedding: Buffer | null;
  created_at: string;
}

export async function saveReviewEmbedding(
  db: DbClient,
  reviewId: number,
  model: string,
  textEmbedding: Buffer | string,
  responseEmbedding: Buffer | string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db.run(`
    INSERT INTO review_embeddings (review_id, model, text_embedding, response_embedding)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(review_id) DO UPDATE SET
      model = excluded.model,
      text_embedding = excluded.text_embedding,
      response_embedding = excluded.response_embedding,
      created_at = ?
  `, [reviewId, model, textEmbedding, responseEmbedding, now]);
}

export async function getReviewEmbedding(db: DbClient, reviewId: number): Promise<ReviewEmbeddingRow | undefined> {
  return db.get<ReviewEmbeddingRow>('SELECT * FROM review_embeddings WHERE review_id = ?', [reviewId]);
}

export async function getUnembeddedReviewIds(db: DbClient, orgId: string): Promise<{ id: number; text: string }[]> {
  return db.all<{ id: number; text: string }>(`
    SELECT r.id, r.text FROM reviews r
    LEFT JOIN review_embeddings re ON r.id = re.review_id
    WHERE r.org_id = ? AND re.review_id IS NULL AND r.text IS NOT NULL AND r.text != ''
    ORDER BY r.id
  `, [orgId]);
}

export async function saveTopicEmbedding(db: DbClient, topicId: number, embedding: Buffer | string): Promise<void> {
  await db.run('UPDATE topic_templates SET embedding = ? WHERE id = ?', [embedding, topicId]);
}
