import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { listCompanies } from '../db/companies.js';
import { getUnembeddedReviewIds, saveReviewEmbedding, saveTopicEmbedding } from '../db/embeddings.js';
import { getTopicsForOrg } from '../db/topics.js';
import { embedBatched } from '../embeddings/client.js';
import { float32ToBuffer } from '../embeddings/vectors.js';

export const embedCommand = new Command('embed')
  .description('Generate embeddings for reviews and topic labels')
  .option('--org <org_id>', 'Limit to one organization')
  .option('--force', 'Re-embed even if already exists')
  .option('--batch', 'Use OpenAI Batch API (50% cheaper, async)')
  .action(async (opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    const model = config.embeddingModel;

    // Determine which orgs to process
    const companies = opts.org
      ? [{ org_id: opts.org }]
      : (await listCompanies(db)).map(c => ({ org_id: c.org_id }));

    if (opts.batch) {
      console.log('Batch mode not yet implemented. Use sync mode (without --batch).');
      await db.close();
      return;
    }

    let totalReviews = 0;
    let totalTopics = 0;

    for (const { org_id } of companies) {
      // 1. Embed unembedded reviews
      const reviews = opts.force
        ? await db.all<{ id: number; text: string }>(
            "SELECT id, text FROM reviews WHERE org_id = ? AND text IS NOT NULL AND text != '' ORDER BY id",
            [org_id],
          )
        : await getUnembeddedReviewIds(db, org_id);

      if (reviews.length > 0) {
        console.log(`${org_id}: embedding ${reviews.length} reviews...`);
        const texts = reviews.map(r => r.text);
        const embeddings = await embedBatched(texts, undefined, model, (done, total) => {
          process.stdout.write(`\r  ${done}/${total} reviews`);
        });
        process.stdout.write('\n');

        for (let i = 0; i < reviews.length; i++) {
          await saveReviewEmbedding(db, reviews[i].id, model, float32ToBuffer(embeddings[i]), null);
        }
        totalReviews += reviews.length;
      }

      // 2. Embed topic labels (always re-embed — they're few and labels may change)
      const topics = await getTopicsForOrg(db, org_id);
      const unembeddedTopics = opts.force
        ? topics
        : topics.filter(t => !t.embedding);

      if (unembeddedTopics.length > 0) {
        console.log(`${org_id}: embedding ${unembeddedTopics.length} topic labels...`);
        const topicTexts = unembeddedTopics.map(t => t.name);
        const topicEmbeddings = await embedBatched(topicTexts, undefined, model);
        for (let i = 0; i < unembeddedTopics.length; i++) {
          await saveTopicEmbedding(db, unembeddedTopics[i].id, float32ToBuffer(topicEmbeddings[i]));
        }
        totalTopics += unembeddedTopics.length;
      }
    }

    console.log(`Done: ${totalReviews} reviews, ${totalTopics} topics embedded.`);
    await db.close();
  });
