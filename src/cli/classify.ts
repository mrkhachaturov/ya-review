import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { getTopicsForOrg } from '../db/topics.js';
import { classifyReview } from '../embeddings/classify.js';
import { bufferToFloat32 } from '../embeddings/vectors.js';
import type Database from 'better-sqlite3';

function classifyOrg(db: Database.Database, orgId: string, threshold: number): number {
  // Load topic embeddings (only subtopics — parent topics are categories, not classifiers)
  const allTopics = getTopicsForOrg(db, orgId);
  const subtopics = allTopics
    .filter(t => t.parent_id !== null && t.embedding)
    .map(t => ({
      id: t.id,
      name: t.name,
      embedding: bufferToFloat32(t.embedding!),
    }));

  if (subtopics.length === 0) {
    return 0;
  }

  // Load review embeddings for this org
  const reviewRows = db.prepare(`
    SELECT re.review_id, re.text_embedding
    FROM review_embeddings re
    JOIN reviews r ON r.id = re.review_id
    WHERE r.org_id = ?
  `).all(orgId) as { review_id: number; text_embedding: Buffer }[];

  // Clear existing classifications for this org's reviews
  const deleteStmt = db.prepare(`
    DELETE FROM review_topics WHERE review_id IN (
      SELECT id FROM reviews WHERE org_id = ?
    )
  `);
  deleteStmt.run(orgId);

  const insertStmt = db.prepare(`
    INSERT INTO review_topics (review_id, topic_id, similarity)
    VALUES (?, ?, ?)
  `);

  let classified = 0;
  const batchInsert = db.transaction(() => {
    for (const row of reviewRows) {
      const vec = bufferToFloat32(row.text_embedding);
      const matches = classifyReview(vec, subtopics, threshold);
      for (const match of matches) {
        insertStmt.run(row.review_id, match.topicId, match.similarity);
      }
      if (matches.length > 0) classified++;
    }
  });
  batchInsert();

  return classified;
}

export const classifyCommand = new Command('classify')
  .description('Classify reviews into topics by embedding similarity')
  .option('--org <org_id>', 'Limit to one organization')
  .option('--threshold <n>', 'Minimum cosine similarity (default: 0.3)', '0.3')
  .action((opts) => {
    const db = openDb(config.dbPath);
    const threshold = parseFloat(opts.threshold);

    const companies = opts.org
      ? [{ org_id: opts.org }]
      : listCompanies(db).map(c => ({ org_id: c.org_id }));

    let totalClassified = 0;
    for (const { org_id } of companies) {
      const count = classifyOrg(db, org_id, threshold);
      if (count > 0) {
        console.log(`${org_id}: classified ${count} reviews`);
      }
      totalClassified += count;
    }

    console.log(`Done: ${totalClassified} reviews classified.`);
    db.close();
  });
