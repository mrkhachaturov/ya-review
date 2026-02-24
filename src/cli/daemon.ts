import { Command } from 'commander';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import type { DbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { listCompanies, upsertCompany } from '../db/companies.js';
import { upsertReviews } from '../db/reviews.js';
import { logSync } from '../db/sync-log.js';
import { createBrowser } from '../scraper/browser.js';
import { scrapeReviews } from '../scraper/reviews.js';
import { loadYarevConfig } from '../yaml-config.js';
import { applyConfig } from './apply.js';
import { getUnembeddedReviewIds, saveReviewEmbedding, saveTopicEmbedding } from '../db/embeddings.js';
import { getTopicsForOrg } from '../db/topics.js';
import { embedBatched } from '../embeddings/client.js';
import { classifyReview } from '../embeddings/classify.js';
import { embeddingToSql, sqlToEmbedding } from '../db/sql-helpers.js';

// ── Structured logger ──
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info') as LogLevel;

function log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[LOG_LEVEL]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...data,
  };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(entry));
}

// ── Embed + Classify pipeline ──
async function runEmbedPipeline(db: DbClient): Promise<void> {
  const model = config.embeddingModel;
  const companies = await listCompanies(db);

  let totalReviews = 0;
  let totalTopics = 0;
  for (const { org_id } of companies) {
    const reviews = await getUnembeddedReviewIds(db, org_id);
    if (reviews.length > 0) {
      log('info', 'Embedding reviews', { org_id, count: reviews.length });
      const embeddings = await embedBatched(reviews.map(r => r.text), undefined, model);
      for (let i = 0; i < reviews.length; i++) {
        await saveReviewEmbedding(db, reviews[i].id, model, embeddingToSql(db, embeddings[i]), null);
      }
      totalReviews += reviews.length;
    } else {
      log('debug', 'No unembedded reviews', { org_id });
    }

    const topics = (await getTopicsForOrg(db, org_id)).filter(t => !t.embedding);
    if (topics.length > 0) {
      log('info', 'Embedding topic labels', { org_id, count: topics.length });
      const topicEmbeddings = await embedBatched(topics.map(t => t.name), undefined, model);
      for (let i = 0; i < topics.length; i++) {
        await saveTopicEmbedding(db, topics[i].id, embeddingToSql(db, topicEmbeddings[i]));
      }
      totalTopics += topics.length;
    }
  }
  log('info', 'Embedding complete', { reviews: totalReviews, topics: totalTopics });

  // Classify reviews into topics
  let totalClassified = 0;
  for (const { org_id } of companies) {
    const allTopics = await getTopicsForOrg(db, org_id);
    const subtopics = allTopics
      .filter(t => t.parent_id !== null && t.embedding)
      .map(t => ({ id: t.id, name: t.name, embedding: sqlToEmbedding(db, t.embedding!) }));

    if (subtopics.length === 0) {
      log('debug', 'No subtopics with embeddings, skipping classify', { org_id });
      continue;
    }

    const reviewRows = await db.all<{ review_id: number; text_embedding: Buffer }>(`
      SELECT re.review_id, re.text_embedding
      FROM review_embeddings re
      JOIN reviews r ON r.id = re.review_id
      WHERE r.org_id = ?
    `, [org_id]);

    await db.run(`
      DELETE FROM review_topics WHERE review_id IN (
        SELECT id FROM reviews WHERE org_id = ?
      )
    `, [org_id]);

    let classified = 0;
    await db.transaction(async () => {
      for (const row of reviewRows) {
        const vec = sqlToEmbedding(db, row.text_embedding);
        const matches = classifyReview(vec, subtopics, 0.3);
        for (const match of matches) {
          await db.run(`INSERT INTO review_topics (review_id, topic_id, similarity) VALUES (?, ?, ?)`,
            [row.review_id, match.topicId, match.similarity]);
        }
        if (matches.length > 0) classified++;
      }
    });

    if (classified > 0) {
      log('info', 'Classified reviews', { org_id, classified, total: reviewRows.length });
    }
    totalClassified += classified;
  }
  log('info', 'Classification complete', { total_classified: totalClassified });
}

// ── Daemon command ──
export const daemonCommand = new Command('daemon')
  .description('Run scheduled sync in the background')
  .option('--cron <expression>', 'Cron expression for schedule', config.daemonCron)
  .option('--embed-cron <cron>', 'Cron expression for embed pipeline', config.embedCron)
  .action(async (opts) => {
    let nodeCron;
    try {
      nodeCron = await import('node-cron');
    } catch {
      log('error', 'node-cron not available — install with: npm install node-cron');
      process.exit(1);
    }

    log('info', 'Daemon starting', {
      sync_cron: opts.cron,
      embed_cron: opts.embedCron ?? config.embedCron,
      embed_on_sync: config.embedOnSync,
      db: config.dbUrl ? 'postgres' : 'sqlite',
      config_path: config.yarevConfig,
      log_level: LOG_LEVEL,
    });

    // Apply YAML config on startup (so companies/topics exist in DB)
    const initDb = await createDbClient(config);
    await initSchema(initDb);
    try {
      const yarevConfig = loadYarevConfig();
      await applyConfig(initDb, yarevConfig);
      const companyNames = yarevConfig.companies.map(c => `${c.name} (${c.org_id})`);
      log('info', 'Config applied', { companies: companyNames });
    } catch (err) {
      log('warn', 'Could not apply YAML config', { error: String(err) });
    }
    await initDb.close();

    const runSync = async () => {
      log('info', 'Sync started');
      const db = await createDbClient(config);
      await initSchema(db);
      const companies = await listCompanies(db);
      if (companies.length === 0) {
        log('warn', 'No companies to sync');
        await db.close();
        return;
      }

      let browser;
      try {
        browser = await createBrowser(config);
        log('debug', 'Browser launched', { backend: config.browserBackend });
      } catch (err) {
        log('error', 'Browser launch failed', { error: String(err) });
        await db.close();
        return;
      }

      for (const company of companies) {
        const startedAt = new Date().toISOString();
        const hasPriorSync = await db.get<{ id: number }>(
          'SELECT id FROM sync_log WHERE org_id = ? AND status = ? LIMIT 1',
          [company.org_id, 'ok'],
        );
        const isFull = !hasPriorSync;

        log('info', 'Syncing company', {
          org_id: company.org_id,
          name: company.name,
          mode: isFull ? 'full' : 'incremental',
        });

        try {
          const result = await scrapeReviews(browser, company.org_id, config, { full: isFull });

          await upsertCompany(db, {
            org_id: company.org_id,
            name: result.company.name,
            rating: result.company.rating,
            review_count: result.company.review_count,
            address: result.company.address,
            categories: result.company.categories,
            role: company.role,
          });

          const { added, updated } = await upsertReviews(db, company.org_id, result.reviews);

          await logSync(db, {
            org_id: company.org_id,
            sync_type: isFull ? 'full' : 'incremental',
            reviews_added: added,
            reviews_updated: updated,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            status: 'ok',
          });

          log('info', 'Sync complete', {
            org_id: company.org_id,
            added,
            updated,
            total_reviews: result.reviews.length,
          });
        } catch (err) {
          await logSync(db, {
            org_id: company.org_id,
            sync_type: isFull ? 'full' : 'incremental',
            reviews_added: 0,
            reviews_updated: 0,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            status: 'error',
            error_message: String(err),
          });
          log('error', 'Sync failed', { org_id: company.org_id, error: String(err) });
        }
      }

      await browser.close();

      // Run embed pipeline after sync if configured
      if (config.embedOnSync) {
        log('info', 'Running post-sync embed pipeline');
        try {
          await runEmbedPipeline(db);
        } catch (err) {
          log('error', 'Post-sync embed pipeline failed', { error: String(err) });
        }
      }

      await db.close();
      log('info', 'Sync cycle finished');
    };

    const runEmbed = async () => {
      log('info', 'Running scheduled embed pipeline');
      const db = await createDbClient(config);
      await initSchema(db);
      try {
        await runEmbedPipeline(db);
      } catch (err) {
        log('error', 'Scheduled embed pipeline failed', { error: String(err) });
      }
      await db.close();
    };

    // Run immediately on start
    await runSync();

    // Schedule future runs
    nodeCron.default.schedule(opts.cron, runSync);
    log('info', 'Sync scheduled', { cron: opts.cron });

    // Schedule embed pipeline
    const embedCronExpr = opts.embedCron ?? config.embedCron;
    nodeCron.default.schedule(embedCronExpr, runEmbed);
    log('info', 'Embed pipeline scheduled', { cron: embedCronExpr });
  });
