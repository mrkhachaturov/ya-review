import { Command } from 'commander';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { getCompany } from '../db/companies.js';
import { getParentTopics, getSubtopics } from '../db/topics.js';
import { computeTopicScore } from '../embeddings/scoring.js';
import { isJsonMode, outputJson } from './helpers.js';
import type Database from 'better-sqlite3';

interface TopicScoreResult {
  topic_id: number;
  name: string;
  score: number;
  review_count: number;
  confidence: string;
  subtopics?: TopicScoreResult[];
}

interface CompanyScoreResult {
  org_id: string;
  name: string;
  overall_score: number;
  total_reviews: number;
  topics: TopicScoreResult[];
}

function getReviewsForTopic(db: Database.Database, topicId: number): { stars: number; date: string }[] {
  return db.prepare(`
    SELECT r.stars, r.date
    FROM review_topics rt
    JOIN reviews r ON r.id = rt.review_id
    WHERE rt.topic_id = ? AND r.date IS NOT NULL
  `).all(topicId) as { stars: number; date: string }[];
}

function computeCompanyScore(db: Database.Database, orgId: string, full: boolean): CompanyScoreResult {
  const company = getCompany(db, orgId);
  const companyName = company?.name ?? orgId;
  const parents = getParentTopics(db, orgId);

  const topics: TopicScoreResult[] = [];
  let totalWeightedScore = 0;
  let totalReviewCount = 0;

  for (const parent of parents) {
    const subs = getSubtopics(db, parent.id);
    let parentReviewCount = 0;
    let parentWeightedScore = 0;
    const subtopicResults: TopicScoreResult[] = [];

    for (const sub of subs) {
      const reviews = getReviewsForTopic(db, sub.id);
      const result = computeTopicScore(reviews);
      subtopicResults.push({
        topic_id: sub.id,
        name: sub.name,
        score: result.score,
        review_count: result.review_count,
        confidence: result.confidence,
      });
      parentReviewCount += result.review_count;
      parentWeightedScore += result.score * result.review_count;
    }

    const parentScore = parentReviewCount > 0
      ? Math.round((parentWeightedScore / parentReviewCount) * 10) / 10
      : 0;

    topics.push({
      topic_id: parent.id,
      name: parent.name,
      score: parentScore,
      review_count: parentReviewCount,
      confidence: parentReviewCount >= 20 ? 'high' : parentReviewCount >= 5 ? 'medium' : 'low',
      ...(full ? { subtopics: subtopicResults } : {}),
    });

    totalReviewCount += parentReviewCount;
    totalWeightedScore += parentScore * parentReviewCount;
  }

  // Sort topics by score descending
  topics.sort((a, b) => b.score - a.score);

  const overallScore = totalReviewCount > 0
    ? Math.round((totalWeightedScore / totalReviewCount) * 10) / 10
    : 0;

  return { org_id: orgId, name: companyName, overall_score: overallScore, total_reviews: totalReviewCount, topics };
}

function printCompanyScore(result: CompanyScoreResult, full: boolean): void {
  const header = `${result.name}`;
  const scoreLine = `AI Score: ${result.overall_score.toFixed(1)} / 10`;
  console.log(`${header.padEnd(40)} ${scoreLine}`);
  console.log('─'.repeat(58));

  for (const topic of result.topics) {
    const conf = topic.confidence === 'low' ? '  ⚠ low confidence' : '';
    console.log(
      `  ${topic.name.padEnd(36)} ${topic.score.toFixed(1)} / 10  (${topic.review_count} reviews)${conf}`,
    );
    if (full && topic.subtopics) {
      for (const sub of topic.subtopics) {
        console.log(`    ${sub.name.padEnd(34)} ${sub.score.toFixed(1)}`);
      }
    }
  }
}

function printComparison(a: CompanyScoreResult, b: CompanyScoreResult): void {
  const nameA = a.name.length > 16 ? a.name.slice(0, 15) + '…' : a.name;
  const nameB = b.name.length > 16 ? b.name.slice(0, 15) + '…' : b.name;

  console.log(`${''.padEnd(36)} ${nameA.padStart(16)} ${nameB.padStart(16)}`);
  console.log(
    `  ${'Overall'.padEnd(34)} ${a.overall_score.toFixed(1).padStart(10)} / 10 ${b.overall_score.toFixed(1).padStart(10)} / 10`,
  );
  console.log('─'.repeat(72));

  // Build topic map from both
  const allTopicNames = new Set([
    ...a.topics.map(t => t.name),
    ...b.topics.map(t => t.name),
  ]);

  for (const name of allTopicNames) {
    const ta = a.topics.find(t => t.name === name);
    const tb = b.topics.find(t => t.name === name);
    const sa = ta?.score ?? 0;
    const sb = tb?.score ?? 0;
    const delta = sa - sb;
    let marker = '  ';
    if (delta >= 0.5) marker = '✅';
    else if (delta <= -0.5) marker = '❌';

    console.log(
      `  ${name.padEnd(34)} ${sa.toFixed(1).padStart(10)}   ${sb.toFixed(1).padStart(10)}     ${marker} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`,
    );
  }
}

export const scoreCommand = new Command('score')
  .description('Show AI quality score per company, broken down by topic')
  .argument('[org_id]', 'Organization ID')
  .option('--full', 'Show subtopic breakdown')
  .option('--compare <org_ids>', 'Compare two orgs (comma-separated)')
  .option('--refresh', 'Recompute and store scores')
  .option('--json', 'Force JSON output')
  .action((orgId: string | undefined, opts) => {
    const db = openDb(config.dbPath);

    if (opts.compare) {
      const [idA, idB] = opts.compare.split(',').map((s: string) => s.trim());
      if (!idA || !idB) {
        console.error('Usage: yarev score --compare org1,org2');
        db.close();
        process.exitCode = 1;
        return;
      }
      const a = computeCompanyScore(db, idA, false);
      const b = computeCompanyScore(db, idB, false);

      if (isJsonMode(opts)) {
        outputJson({ companies: [a, b] });
      } else {
        printComparison(a, b);
      }
      db.close();
      return;
    }

    if (!orgId) {
      console.error('Usage: yarev score <org_id> [--full] [--compare org1,org2]');
      db.close();
      process.exitCode = 1;
      return;
    }

    const result = computeCompanyScore(db, orgId, !!opts.full);

    if (opts.refresh) {
      // Store scores in company_scores table
      const upsert = db.prepare(`
        INSERT INTO company_scores (org_id, topic_id, score, review_count, confidence)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(org_id, topic_id) DO UPDATE SET
          score = excluded.score,
          review_count = excluded.review_count,
          confidence = excluded.confidence,
          computed_at = datetime('now')
      `);
      db.transaction(() => {
        for (const topic of result.topics) {
          upsert.run(orgId, topic.topic_id, topic.score, topic.review_count, topic.confidence);
          if (topic.subtopics) {
            for (const sub of topic.subtopics) {
              upsert.run(orgId, sub.topic_id, sub.score, sub.review_count, sub.confidence);
            }
          }
        }
      })();
    }

    if (isJsonMode(opts)) {
      outputJson(result);
    } else {
      if (result.topics.length === 0) {
        console.log('No scoring data. Run: yarev apply, yarev embed, yarev classify');
        db.close();
        return;
      }
      printCompanyScore(result, !!opts.full);
    }
    db.close();
  });
