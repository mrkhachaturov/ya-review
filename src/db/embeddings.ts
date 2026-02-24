import type Database from 'better-sqlite3';

export interface ReviewEmbeddingRow {
  review_id: number;
  model: string;
  text_embedding: Buffer;
  response_embedding: Buffer | null;
  created_at: string;
}

export function saveReviewEmbedding(
  db: Database.Database,
  reviewId: number,
  model: string,
  textEmbedding: Buffer,
  responseEmbedding: Buffer | null,
): void {
  db.prepare(`
    INSERT INTO review_embeddings (review_id, model, text_embedding, response_embedding)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(review_id) DO UPDATE SET
      model = excluded.model,
      text_embedding = excluded.text_embedding,
      response_embedding = excluded.response_embedding,
      created_at = datetime('now')
  `).run(reviewId, model, textEmbedding, responseEmbedding);
}

export function getReviewEmbedding(db: Database.Database, reviewId: number): ReviewEmbeddingRow | undefined {
  return db.prepare('SELECT * FROM review_embeddings WHERE review_id = ?').get(reviewId) as
    ReviewEmbeddingRow | undefined;
}

export function getUnembeddedReviewIds(db: Database.Database, orgId: string): { id: number; text: string }[] {
  return db.prepare(`
    SELECT r.id, r.text FROM reviews r
    LEFT JOIN review_embeddings re ON r.id = re.review_id
    WHERE r.org_id = ? AND re.review_id IS NULL AND r.text IS NOT NULL AND r.text != ''
    ORDER BY r.id
  `).all(orgId) as { id: number; text: string }[];
}

export function saveTopicEmbedding(db: Database.Database, topicId: number, embedding: Buffer): void {
  db.prepare('UPDATE topic_templates SET embedding = ? WHERE id = ?').run(embedding, topicId);
}
