# CLAUDE.md

## Project
ya-review (`yarev`) — CLI for scraping/storing/querying Yandex Maps reviews with AI topic analysis.
TypeScript ESM, Node >= 22, SQLite (better-sqlite3), Commander.js CLI, OpenAI embeddings.

## Commands
- `npm run dev -- <args>` — run CLI via tsx
- `npm test` — run all tests (Node.js native test runner)
- `npm run build` — compile to dist/
- `npx tsc --noEmit` — type-check without emitting
- `npx tsx --test tests/**/*.test.ts` — run tests directly

## Code Patterns
- ESM: use `createRequire(import.meta.url)` instead of bare `require()`
- DB: raw SQL with better-sqlite3, no ORM. Schema in `src/db/schema.ts`
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
- `src/yaml-config.ts` — YAML config parser with `inherit` topic resolution
- `src/embeddings/client.ts` — OpenAI embedding client (lazy-init, requires `YAREV_OPENAI_API_KEY`)
- `src/embeddings/vectors.ts` — cosine similarity, Float32↔Buffer conversion
- `src/embeddings/classify.ts` — review→topic matching by embedding similarity
- `src/embeddings/scoring.ts` — AI quality scoring algorithm
- `src/db/topics.ts` — topic templates CRUD (parent/subtopic hierarchy)
- `src/db/embeddings.ts` — review/topic embedding storage
- `config.example.yaml` / `config.example.ru.yaml` — config examples (EN/RU)

## Gotchas
- `npm install` runs `prepare` → `tsc`. Use `--ignore-scripts` if source is incomplete
- Patchright/Playwright/pg/openai are optional deps — lazy-loaded, may not be installed
- DB operations are synchronous (better-sqlite3). PgClient is a stub
- `openai` package requires `YAREV_OPENAI_API_KEY` — throws on first use if missing
- Topics use `inherit` keyword to copy topics from the first company with same `service_type`

## Reference Projects
- `/Users/mrkhachaturov/Developer/ya-metrics/hae-vault` — CLI structure, config, DB patterns
- `/Users/mrkhachaturov/Developer/ya-metrics/ya-reviews-mcp` — scraper logic, CSS selectors
