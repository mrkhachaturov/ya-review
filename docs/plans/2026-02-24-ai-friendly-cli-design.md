# AI-Friendly CLI Commands — Design

## Context

The CLI currently provides raw data access (`reviews`, `query`, `compare`) but lacks
purpose-built commands that let an AI assistant quickly assess a business's review
landscape and act on it. This design adds five commands that serve both AI and human
users for reputation management and competitive intelligence.

Phase A (this design) focuses on structured data access. Phase B (future) will add
vector embeddings and semantic search on top of the same data.

## New Commands

### 1. `yarev stats <org_id>`

One-call overview of a business. The first thing an AI should run.

**Output:**
```json
{
  "org_id": "1248139252",
  "name": "Astra Motors",
  "rating": 4.8,
  "total_reviews": 423,
  "star_distribution": { "5": 312, "4": 58, "3": 22, "2": 18, "1": 13 },
  "avg_stars": 4.28,
  "response_rate": 0.87,
  "reviews_with_text": 389,
  "period": { "first": "2021-03-15", "last": "2026-02-05" }
}
```

**Options:** `--json`, `--since <date>`

**Implementation:** Single SQL query with GROUP BY + COUNT + AVG on `reviews` table,
joined with `companies` for metadata. All computed server-side, no post-processing.

### 2. `yarev digest <org_id>`

Compact review listing optimized for LLM context windows. Strips URLs, avatars, IDs —
keeps only what matters for analysis.

**Output:**
```json
[
  { "date": "2026-02-05", "stars": 2, "text": "Неоправданно дорого...", "has_response": true },
  { "date": "2026-01-23", "stars": 5, "text": "Пользуемся регулярно...", "has_response": true }
]
```

**Options:** `--since <date>`, `--stars <range>`, `--limit <n>`, `--no-truncate`

**Implementation:** Thin wrapper around existing `queryReviews()`, projecting only
the needed fields. Text truncated to 200 chars by default.

### 3. `yarev search <text> [--org <id>]`

Full-text search across review bodies. Uses SQLite LIKE for now; can be upgraded to
FTS5 or vector search in Phase B.

```bash
yarev search "цена" --org 1248139252
yarev search "долго ждать"            # across all orgs
```

**Output:** Same shape as `digest` — compact, AI-friendly.

**Options:** `--org <id>`, `--stars <range>`, `--limit <n>`, `--json`

**Implementation:** `WHERE text LIKE '%' || ? || '%'` with parameterized input.
Returns matching reviews with org_id included for cross-company searches.

### 4. `yarev trends <org_id>`

Time-series aggregation — review volume and average rating over time.

**Output:**
```json
[
  { "month": "2026-02", "count": 12, "avg_stars": 4.1 },
  { "month": "2026-01", "count": 28, "avg_stars": 4.5 }
]
```

**Options:** `--period <week|month|quarter>` (default: month), `--since <date>`, `--limit <n>`

**Implementation:** `GROUP BY strftime(format, date)` with format determined by
`--period`. Pure SQL, no application-level aggregation.

### 5. `yarev unanswered <org_id>`

Reviews missing a business response — prioritized for reputation management.

```bash
yarev unanswered 1248139252 --stars 1-3   # urgent: negative + no reply
```

**Output:** Same shape as `digest`.

**Options:** `--stars <range>`, `--since <date>`, `--limit <n>`, `--json`

**Implementation:** `WHERE business_response IS NULL` filter on existing query path.

## Architecture

- Each command: one file in `src/cli/`, one query function in `src/db/`
- All commands follow existing output pattern: table for TTY, JSON when piped
- No new dependencies — pure SQL on existing schema
- No schema changes needed for Phase A

## Phase B (Future — Not In Scope)

- `review_embeddings` table with vector column
- `yarev embed [--org <id>]` command to generate embeddings
- Enhanced `search` with semantic fallback
- `yarev topics <org_id>` — cluster reviews by theme
- Requires: embedding model (Claude/OpenAI API or local model), sqlite-vec or pgvector
