# CLAUDE.md

## Project
ya-review (`yarev`) — CLI for scraping/storing/querying Yandex Maps reviews with AI topic analysis.
TypeScript ESM, Node >= 22, SQLite/PostgreSQL dual-driver, Commander.js CLI, OpenAI embeddings, Docker.

## Commands
- `npm run dev -- <args>` — run CLI via tsx
- `npm test` — run all tests (Node.js native test runner)
- `npm run build` — compile to dist/
- `npx tsc --noEmit` — type-check without emitting
- `npx tsx --test tests/**/*.test.ts` — run tests directly

## Architecture
```
src/
  cli/            — one file per command (Commander.js)
  db/             — async DbClient (SQLite + PG), schema, CRUD, migrations
  embeddings/     — OpenAI client, vectors, classify, scoring
  scraper/        — Patchright/Playwright browser automation
  types/          — shared TypeScript interfaces
  config.ts       — env vars loader
  yaml-config.ts  — YAML config parser
tests/            — mirrors src/ structure
docs/             — scoring algorithm docs (EN/RU)
```

## Code Patterns
- ESM: use `createRequire(import.meta.url)` instead of bare `require()`
- DB: async `DbClient` interface, raw SQL with positional `?` params, no ORM
- DB drivers: `SqliteClient` (better-sqlite3 wrapped in Promises), `PgClient` (pg Pool + pgvector)
- DB init: `await createDbClient(config)` + `await initSchema(db)` in every CLI command
- Config: dotenv with `YAREV_` prefix, all in `src/config.ts`
- YAML config: `~/.yarev/config.yaml` — companies, topics, competitors. Parser in `src/yaml-config.ts`
- CLI: Commander.js, one file per command in `src/cli/`
- Output: JSON by default when piped (non-TTY), table for terminal
- Embeddings: OpenAI `text-embedding-3-small`, stored as Float32 BLOBs in `review_embeddings`
- Topic classification: cosine similarity between review and topic label embeddings
- Scoring: stars→2-10 scale, recency-weighted, per-topic confidence levels
- Tests: Node.js native test runner (`node:test`), assert/strict
- Tests live in `tests/` mirroring `src/` structure

## Key Files
- `src/db/schema.ts` — SQLite schema, migrations, table creation
- `src/db/reviews.ts` — review upsert, query, dedup logic
- `src/db/companies.ts` — company CRUD
- `src/db/topics.ts` — topic templates CRUD (parent/subtopic hierarchy)
- `src/db/embeddings.ts` — review/topic embedding storage
- `src/db/stats.ts` — stats, trends, text/semantic search
- `src/yaml-config.ts` — YAML config parser with `inherit` topic resolution
- `src/embeddings/client.ts` — OpenAI embedding client (lazy-init, requires `YAREV_OPENAI_API_KEY`)
- `src/embeddings/vectors.ts` — cosine similarity, Float32↔Buffer conversion
- `src/embeddings/classify.ts` — review→topic matching by embedding similarity
- `src/embeddings/scoring.ts` — AI quality scoring algorithm
- `src/cli/helpers.ts` — shared CLI utilities (JSON/table output, truncate)
- `config.example.yaml` / `config.example.ru.yaml` — config examples (EN/RU)
- `src/db/driver.ts` — async DbClient interface, createDbClient() factory
- `src/db/sqlite.ts` — SqliteClient (async wrapper over better-sqlite3)
- `src/db/postgres.ts` — PgClient (pg Pool, ?→$N conversion, transaction routing)
- `src/db/pg-schema.ts` — PostgreSQL schema with pgvector extensions
- `src/db/sql-helpers.ts` — dialect-aware helpers (timestamps, embedding format)
- `tests/helpers.ts` — createTestDb() for in-memory async test DB
- `Dockerfile` — multi-stage build with Chromium
- `docker-compose.yml` — pgvector + yarev services

## Environment
Required in `.env` for AI features:
- `YAREV_OPENAI_API_KEY=sk-...`

Optional:
- `YAREV_DB_PATH` — SQLite path (default: `~/.yarev/reviews.db`)
- `YAREV_DB_URL` — PostgreSQL connection string (enables PG mode, e.g. `postgresql://yarev:pass@localhost:5432/yarev`)
- `YAREV_CONFIG` — YAML config path (default: `~/.yarev/config.yaml`)
- `YAREV_EMBEDDING_MODEL` — embedding model (default: `text-embedding-3-small`)
- `EMBED_CRON` — embed pipeline schedule (default: `0 2 * * *`)
- `EMBED_ON_SYNC` — run embed after sync (default: `false`)

## AI Pipeline (in order)
```
yarev apply → yarev embed → yarev classify → yarev topics / yarev score
```

## Gotchas
- `npm install` runs `prepare` → `tsc`. Use `--ignore-scripts` if source is incomplete
- Patchright/Playwright/openai are optional deps — lazy-loaded. `pg` is now a regular dependency
- DB operations are async via DbClient. SqliteClient wraps sync better-sqlite3 in Promises
- better-sqlite3 `transaction()` doesn't support async callbacks — SqliteClient uses manual BEGIN/COMMIT with SAVEPOINTs for nesting
- In worktrees: `npm install --ignore-scripts` skips native builds; run `npm rebuild better-sqlite3` after
- All DB module functions use positional `?` params (not named `@param`). PgClient converts `?` to `$N` automatically
- `openai` package requires `YAREV_OPENAI_API_KEY` — throws on first use if missing
- Topics use `inherit` keyword to copy topics from the first company with same `service_type`

## Docker
- `docker compose up -d postgres` — start pgvector locally
- `docker compose up` — start full stack (PG + yarev daemon)
- `docker build -t yarev .` — build image (multi-stage, includes Chromium)
- pgvector image: `pgvector/pgvector:pg17`

## Reference Projects
- `/Users/mrkhachaturov/Developer/ya-metrics/hae-vault` — CLI structure, config, DB patterns
- `/Users/mrkhachaturov/Developer/ya-metrics/ya-reviews-mcp` — scraper logic, CSS selectors
