import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { getTopicsForOrg } from '../db/topics.js';
import { classifyReview } from '../embeddings/classify.js';
import { sqlToEmbedding } from '../db/sql-helpers.js';
import type { DbClient } from '../db/driver.js';

async function classifyOrg(db: DbClient, orgId: string, threshold: number): Promise<number> {
  // Load topic embeddings (only subtopics — parent topics are categories, not classifiers)
  const allTopics = await getTopicsForOrg(db, orgId);
  const subtopics = allTopics
    .filter(t => t.parent_id !== null && t.embedding)
    .map(t => ({
      id: t.id,
      name: t.name,
      embedding: sqlToEmbedding(db, t.embedding!),
    }));

  if (subtopics.length === 0) {
    return 0;
  }

  // Load review embeddings for this org
  const reviewRows = await db.all<{ review_id: number; text_embedding: Buffer }>(`
    SELECT re.review_id, re.text_embedding
    FROM review_embeddings re
    JOIN reviews r ON r.id = re.review_id
    WHERE r.org_id = ?
  `, [orgId]);

  // Clear existing classifications for this org's reviews
  await db.run(`
    DELETE FROM review_topics WHERE review_id IN (
      SELECT id FROM reviews WHERE org_id = ?
    )
  `, [orgId]);

  let classified = 0;
  await db.transaction(async () => {
    for (const row of reviewRows) {
      const vec = sqlToEmbedding(db, row.text_embedding);
      const matches = classifyReview(vec, subtopics, threshold);
      for (const match of matches) {
        await db.run(`
          INSERT INTO review_topics (review_id, topic_id, similarity)
          VALUES (?, ?, ?)
        `, [row.review_id, match.topicId, match.similarity]);
      }
      if (matches.length > 0) classified++;
    }
  });

  return classified;
}

export const classifyCommand = new Command('classify')
  .description('Classify reviews into topics by embedding similarity')
  .option('--org <org_id>', 'Limit to one organization')
  .option('--threshold <n>', 'Minimum cosine similarity (default: 0.3)', '0.3')
  .action(async (opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    const threshold = parseFloat(opts.threshold);

    const companies = opts.org
      ? [{ org_id: opts.org }]
      : (await listCompanies(db)).map(c => ({ org_id: c.org_id }));

    let totalClassified = 0;
    for (const { org_id } of companies) {
      const count = await classifyOrg(db, org_id, threshold);
      if (count > 0) {
        console.log(`${org_id}: classified ${count} reviews`);
      }
      totalClassified += count;
    }

    console.log(`Done: ${totalClassified} reviews classified.`);
    await db.close();
  });
