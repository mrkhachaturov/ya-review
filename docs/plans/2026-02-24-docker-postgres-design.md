# Docker + PostgreSQL Design

## Goal

Package yarev as a self-contained Docker image that works with PostgreSQL + pgvector for BI analytics. Keep SQLite support for local development. Docker Compose provides a local PG instance for testing; production uses an external PG cluster.

## Decisions

| Component | Decision |
|-----------|----------|
| Docker | Multi-stage Dockerfile (node:22-slim + Chromium), single image |
| Compose | yarev + pgvector/pgvector:pg17, dev/testing only |
| DB driver | Async `DbClient` interface, `SqliteClient` + `PgClient` |
| Vector search | pgvector `vector(1536)`, HNSW index, `<=>` cosine operator |
| Runtime | Daemon mode: full sync on start, cron for reviews + embed batch |
| Config | New `daemon:` section in YAML, env var overrides |
| Schema | Separate PG schema file, migration table for versioning |
| Production | Image connects to external PG cluster via `YAREV_DB_URL` |

## Architecture

```
docker-compose.yml (dev/testing)
├── yarev (node:22-slim + Chromium)
│   ├── Daemon: full sync on start
│   ├── Cron: review sync (DAEMON_CRON)
│   └── Cron: embed batch (EMBED_CRON)
└── postgres (pgvector/pgvector:pg17)
    ├── Port: 5432
    ├── Volume: pgdata (persistent)
    └── Extension: vector

Production: yarev image only, YAREV_DB_URL → external PG cluster
```

## Dockerfile

Multi-stage build:

1. **Build stage** (`node:22-slim`): install all deps, compile TypeScript
2. **Runtime stage** (`node:22-slim`): install Chromium via apt, copy `dist/` and production deps, set `BROWSER_BACKEND=playwright` with system Chromium

Target image size: ~1.2-1.5GB (Chromium is the bulk).

## Dual-Driver DbClient

### Async Interface

All DB methods become async (return `Promise<T>`). Every call site adds `await`.

```typescript
interface DbClient {
  getCompanies(): Promise<Company[]>
  upsertReview(review: Review): Promise<void>
  getReviewEmbeddings(orgId: string): Promise<Embedding[]>
  semanticSearch(embedding: Float32Array, limit: number): Promise<SearchResult[]>
  close(): Promise<void>
  // ... all other methods
}
```

### SqliteClient

Wraps existing sync better-sqlite3 calls in `Promise.resolve()`. No behavior change, just async signature.

### PgClient

- Uses `pg` Pool for connection management
- All queries use `$1, $2` parameterized format
- Embedding columns: `vector(1536)` via pgvector
- Semantic search: `ORDER BY embedding <=> $1 LIMIT $2`

### Factory

```typescript
async function createDbClient(cfg): Promise<DbClient> {
  if (cfg.dbUrl) return PgClient.connect(cfg.dbUrl)
  return new SqliteClient(cfg.dbPath)
}
```

Routing via `YAREV_DB_URL` env var: if set, use PG; otherwise, use SQLite.

## pgvector Integration

### Schema Translation

| SQLite | PostgreSQL |
|--------|-----------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `REAL` | `DOUBLE PRECISION` |
| `BLOB` (Float32 embeddings) | `vector(1536)` |
| `BLOB` (JSON) | `JSONB` |
| `datetime('now')` | `NOW()` |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT ... DO UPDATE` |

### Indexes

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX idx_review_embeddings_text
  ON review_embeddings USING hnsw (text_embedding vector_cosine_ops);

CREATE INDEX idx_topic_templates_embedding
  ON topic_templates USING hnsw (embedding vector_cosine_ops);
```

### Semantic Search

Current: loads all embeddings into JS memory, computes cosine similarity in application.

New (PG): single SQL query with pgvector operator.

```sql
SELECT r.*, 1 - (re.text_embedding <=> $1) AS similarity
FROM reviews r
JOIN review_embeddings re ON r.id = re.review_id
WHERE r.org_id = $2
ORDER BY re.text_embedding <=> $1
LIMIT $3;
```

## Migration Strategy

- `migrations` table: `version INTEGER, applied_at TIMESTAMP`
- Each driver has dialect-specific schema SQL
- On connect: check current version, apply missing migrations
- No down-migrations
- PG schema in `src/db/pg-schema.ts`

## Daemon Scheduling

### Startup Sequence

1. Connect to DB (PG or SQLite based on `YAREV_DB_URL`)
2. Run migrations (create tables, extensions if PG)
3. Apply YAML config (`yarev apply`) -- idempotent
4. Full sync (`yarev sync`) if `full_sync_on_start: true`
5. Start cron schedulers

### Cron Jobs

- **Review sync**: `DAEMON_CRON` (default: `0 8 * * *` -- daily 8AM)
- **Embed batch**: `EMBED_CRON` (default: `0 2 * * *` -- daily 2AM)
  - Runs: embed -> classify -> score (sequential pipeline)

### YAML Config

```yaml
daemon:
  sync_cron: "0 8 * * *"
  embed_cron: "0 2 * * *"
  embed_on_sync: false
  full_sync_on_start: true
```

### Env Var Overrides

`DAEMON_CRON`, `EMBED_CRON`, `EMBED_ON_SYNC` -- for compose/production without editing YAML.

## Docker Compose

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: yarev
      POSTGRES_USER: yarev
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U yarev"]
      interval: 5s
      retries: 5

  yarev:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      YAREV_DB_URL: postgresql://yarev:${PG_PASSWORD}@postgres:5432/yarev
      YAREV_OPENAI_API_KEY: ${YAREV_OPENAI_API_KEY}
    volumes:
      - ./config.yaml:/app/config.yaml:ro
    restart: unless-stopped

volumes:
  pgdata:
```

## Files to Create/Modify

### New Files
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `src/db/pg-schema.ts` -- PostgreSQL schema
- `src/db/migrations.ts` -- Migration runner
- `docker-entrypoint.sh` -- Container startup script

### Modified Files
- `src/db/driver.ts` -- Async factory, PG routing
- `src/db/postgres.ts` -- Full PgClient implementation (currently stub)
- `src/db/sqlite.ts` -- Async wrapper around existing sync calls
- `src/db/schema.ts` -- Extract SQLite-specific schema
- `src/db/reviews.ts` -- Add `await` to all DB calls
- `src/db/companies.ts` -- Add `await`
- `src/db/topics.ts` -- Add `await`
- `src/db/embeddings.ts` -- Add `await`, pgvector format for PG
- `src/db/stats.ts` -- pgvector semantic search for PG path
- `src/cli/*.ts` -- All command handlers become async
- `src/config.ts` -- Add daemon/embed cron config
- `src/yaml-config.ts` -- Parse daemon section
- `src/cli/daemon.ts` -- Add embed cron job
- `package.json` -- Move `pg` from optional to regular deps
