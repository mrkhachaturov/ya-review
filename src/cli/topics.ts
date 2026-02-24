import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getParentTopics, getSubtopics } from '../db/topics.js';
import { isJsonMode, outputJson } from './helpers.js';
import type Database from 'better-sqlite3';

interface TopicStats {
  topic_id: number;
  name: string;
  review_count: number;
  avg_stars: number;
  children?: TopicStats[];
}

function getTopicStats(db: Database.Database, topicId: number): { review_count: number; avg_stars: number } {
  const row = db.prepare(`
    SELECT COUNT(*) as review_count, COALESCE(AVG(r.stars), 0) as avg_stars
    FROM review_topics rt
    JOIN reviews r ON r.id = rt.review_id
    WHERE rt.topic_id = ?
  `).get(topicId) as { review_count: number; avg_stars: number };
  return row;
}

function buildTopicTree(db: Database.Database, orgId: string): TopicStats[] {
  const parents = getParentTopics(db, orgId);
  const result: TopicStats[] = [];

  for (const parent of parents) {
    const subs = getSubtopics(db, parent.id);
    const children: TopicStats[] = [];
    let totalReviews = 0;
    let weightedStars = 0;

    for (const sub of subs) {
      const stats = getTopicStats(db, sub.id);
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
  .action((orgId: string, opts) => {
    const db = openDb(config.dbPath);
    let tree = buildTopicTree(db, orgId);

    if (opts.limit) {
      tree = tree.slice(0, parseInt(opts.limit, 10));
    }

    if (isJsonMode(opts)) {
      outputJson(tree);
    } else {
      if (tree.length === 0) {
        console.log('No topic data. Run: yarev apply, yarev embed, yarev classify');
        db.close();
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

    db.close();
  });
