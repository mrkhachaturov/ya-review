# CLAUDE.md

## Project
ya-review (`yarev`) — CLI for scraping/storing/querying Yandex Maps reviews.
TypeScript ESM, Node >= 22, SQLite (better-sqlite3), Commander.js CLI.

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
- CLI: Commander.js, one file per command in `src/cli/`
- Output: JSON by default when piped (non-TTY), table for terminal
- Tests: Node.js native test runner (`node:test`), assert/strict
- Tests live in `tests/` mirroring `src/` structure

## Gotchas
- `npm install` runs `prepare` → `tsc`. Use `--ignore-scripts` if source is incomplete
- Patchright/Playwright/pg are optional deps — lazy-loaded, may not be installed
- DB operations are synchronous (better-sqlite3). PgClient is a stub

## Reference Projects
- `/Users/mrkhachaturov/Developer/ya-metrics/hae-vault` — CLI structure, config, DB patterns
- `/Users/mrkhachaturov/Developer/ya-metrics/ya-reviews-mcp` — scraper logic, CSS selectors
