import { config as dotenvLoad } from 'dotenv';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserBackend } from './types/index.js';

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return homedir() + p.slice(1);
  }
  return p;
}

const envFile = process.env.YAREV_ENV_FILE ?? join(process.cwd(), '.env');
if (existsSync(envFile)) {
  dotenvLoad({ path: envFile, quiet: true });
}

const DEFAULT_DB_PATH = join(homedir(), '.yarev', 'reviews.db');

export const config = {
  dbUrl:                process.env.YAREV_DB_URL,
  dbPath:               expandTilde(process.env.YAREV_DB_PATH ?? DEFAULT_DB_PATH),
  browserBackend:       (process.env.BROWSER_BACKEND ?? 'patchright') as BrowserBackend,
  browserWsUrl:         process.env.BROWSER_WS_URL,
  browserHeadless:      process.env.BROWSER_HEADLESS !== 'false',
  browserLocale:        process.env.BROWSER_LOCALE ?? 'ru-RU',
  pageTimeout:          Number(process.env.PAGE_TIMEOUT ?? 30000),
  interceptTimeout:     Number(process.env.INTERCEPT_TIMEOUT ?? 15000),
  requestDelay:         Number(process.env.REQUEST_DELAY ?? 2.0),
  maxPages:             Number(process.env.MAX_PAGES ?? 20),
  scraperRetries:       Number(process.env.SCRAPER_RETRIES ?? 3),
  scraperRetryDelay:    Number(process.env.SCRAPER_RETRY_DELAY ?? 2.0),
  incrementalWindowSize: Number(process.env.INCREMENTAL_WINDOW_SIZE ?? 50),
  daemonCron:           process.env.DAEMON_CRON ?? '0 8 * * *',
  embedCron:        process.env.EMBED_CRON ?? '0 2 * * *',
  embedOnSync:      process.env.EMBED_ON_SYNC === 'true',
  fullSyncOnStart:  process.env.FULL_SYNC_ON_START !== 'false',
  yarevConfig:          process.env.YAREV_CONFIG ?? join(homedir(), '.yarev', 'config.yaml'),
  openaiApiKey:         process.env.YAREV_OPENAI_API_KEY,
  embeddingModel:       process.env.YAREV_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  embeddingBatchSize:   Number(process.env.YAREV_EMBEDDING_BATCH_SIZE ?? 100),
  batchPollInterval:    Number(process.env.YAREV_BATCH_POLL_INTERVAL ?? 30),
} as const;

export type Config = typeof config;
