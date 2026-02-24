import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { getParentTopics, getSubtopics } from '../db/topics.js';
import { isJsonMode, outputJson } from './helpers.js';
import type { DbClient } from '../db/driver.js';

interface TopicStats {
  topic_id: number;
  name: string;
  review_count: number;
  avg_stars: number;
  children?: TopicStats[];
}

async function getTopicStats(db: DbClient, topicId: number): Promise<{ review_count: number; avg_stars: number }> {
  const row = await db.get<{ review_count: number; avg_stars: number }>(`
    SELECT COUNT(*) as review_count, COALESCE(AVG(r.stars), 0) as avg_stars
    FROM review_topics rt
    JOIN reviews r ON r.id = rt.review_id
    WHERE rt.topic_id = ?
  `, [topicId]);
  return row!;
}

async function buildTopicTree(db: DbClient, orgId: string): Promise<TopicStats[]> {
  const parents = await getParentTopics(db, orgId);
  const result: TopicStats[] = [];

  for (const parent of parents) {
    const subs = await getSubtopics(db, parent.id);
    const children: TopicStats[] = [];
    let totalReviews = 0;
    let weightedStars = 0;

    for (const sub of subs) {
      const stats = await getTopicStats(db, sub.id);
      children.push({
        topic_id: sub.id,
        name: sub.name,
        review_count: stats.review_count,
        avg_stars: Math.round(stats.avg_stars * 10) / 10,
      });
      totalReviews += stats.review_count;
      weightedStars += stats.avg_stars * stats.review_count;
    }

    const parentAvg = totalReviews > 0 ? weightedStars / totalReviews : 0;

    result.push({
      topic_id: parent.id,
      name: parent.name,
      review_count: totalReviews,
      avg_stars: Math.round(parentAvg * 10) / 10,
      children,
    });
  }

  // Sort by review count descending
  result.sort((a, b) => b.review_count - a.review_count);
  return result;
}

function formatStars(stars: number): string {
  return `★${stars.toFixed(1)}`;
}

export const topicsCommand = new Command('topics')
  .description('Show topic analysis with review counts and avg stars')
  .argument('<org_id>', 'Organization ID')
  .option('--limit <n>', 'Max parent topics to show')
  .option('--json', 'Force JSON output')
  .action(async (orgId: string, opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    let tree = await buildTopicTree(db, orgId);

    if (opts.limit) {
      tree = tree.slice(0, parseInt(opts.limit, 10));
    }

    if (isJsonMode(opts)) {
      outputJson(tree);
    } else {
      if (tree.length === 0) {
        console.log('No topic data. Run: yarev apply, yarev embed, yarev classify');
        await db.close();
        return;
      }

      // Find max name width for alignment
      const allNames = tree.flatMap(t => [t.name, ...(t.children?.map(c => `  ${c.name}`) ?? [])]);
      const maxName = Math.max(...allNames.map(n => n.length));

      for (const topic of tree) {
        const pad = topic.name.padEnd(maxName);
        console.log(`${pad}  ${String(topic.review_count).padStart(4)} reviews  ${formatStars(topic.avg_stars)}`);
        if (topic.children) {
          for (const child of topic.children) {
            const cpad = (`  ${child.name}`).padEnd(maxName);
            console.log(`${cpad}  ${String(child.review_count).padStart(4)} reviews  ${formatStars(child.avg_stars)}`);
          }
        }
      }
    }

    await db.close();
  });
