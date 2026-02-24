# Phase B: Embeddings — Brainstorm for AI Session

## What We Have

- SQLite DB with 656 real reviews (423 Astra Motors + 233 Fit Service)
- Each review has: text, stars, date, business_response, org_id
- CLI commands: stats, digest, search (keyword LIKE), trends, unanswered, compare
- Keyword search works but misses semantic similarity ("дорого" won't find "завышенные цены")

## What Embeddings Enable

### 1. Semantic Search (highest value, build first)

Instead of `yarev search "дорого"` matching only exact substring, embed the query
and find nearest neighbors. "expensive service" finds:
- "дорого"
- "завышенные цены"
- "ценник неоправданный"
- "дешевле к официалам"

**Command:** enhance existing `yarev search` — use embeddings when available, fall back to LIKE.

### 2. Topic Clustering (what customers care about)

Cluster all reviews by embedding similarity to extract themes automatically:
- Price / value for money
- Wait time / speed of service
- Staff attitude / communication
- Quality of work
- Cleanliness / comfort of waiting area
- Parts availability / parts markup

**Command:** `yarev topics <org_id>` — show top N themes with review counts and avg stars per theme.

This is the "what customers most like / most dislike" feature you mentioned.

**Approach:** Predefine ~10 topic labels, embed them, then classify each review by
nearest topic. Simpler and more reliable than unsupervised clustering.

### 3. Competitor Response Comparison

Embed review+response pairs. Find cases where both companies got similar complaints
but responded differently. Which response strategy is more effective (did the reviewer
update their rating, did similar complaints stop)?

**Command:** `yarev compare-responses --org <mine> --competitor <theirs> --topic "цены"`

### 4. Similar Review Detection

Find reviews across companies about the same issue:
- "Your customer said X, competitor's customer said nearly the same thing"
- Useful for identifying industry-wide vs company-specific problems

**Command:** `yarev similar <review_id>` or `yarev similar --text "долго ждать"`

### 5. Review Quality / Spam Detection

Outlier reviews (very different embedding from cluster) might be spam, fake, or
irrelevant. Flag for human review.

## Architecture Decisions

### Storage: sqlite-vec vs pgvector

Since you're moving to PostgreSQL in Docker:
- **pgvector** — native PostgreSQL extension, mature, supports IVFFlat and HNSW indexes
- Store embeddings in a `review_embeddings` table alongside review_id
- For SQLite dev: use **sqlite-vec** (same concept, lighter)
- Or: store embeddings as BLOB in SQLite, do brute-force search (fast enough for <10K reviews)

### Embedding Model

OpenAI `text-embedding-3-small`:
- 1536 dimensions
- ~$0.02 per 1M tokens (~$0.002 for all 656 reviews)
- Good multilingual support (important for Russian text)

### What to Embed

| What | Why | When |
|------|-----|------|
| Review text | Core — enables search and clustering | On sync or `yarev embed` |
| Business response | Compare response strategies | On sync or `yarev embed` |
| Review + response combined | Measures response relevance | Optional, derived |

### Schema

```sql
CREATE TABLE review_embeddings (
  review_id INTEGER PRIMARY KEY REFERENCES reviews(id),
  model TEXT NOT NULL,              -- 'text-embedding-3-small'
  text_embedding BLOB NOT NULL,     -- float32 array as binary
  response_embedding BLOB,          -- nullable (only if has response)
  created_at TEXT DEFAULT (datetime('now'))
);
```

For pgvector:
```sql
CREATE TABLE review_embeddings (
  review_id INTEGER PRIMARY KEY REFERENCES reviews(id),
  model TEXT NOT NULL,
  text_embedding vector(1536) NOT NULL,
  response_embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON review_embeddings USING hnsw (text_embedding vector_cosine_ops);
```

### New Commands

```bash
# Generate embeddings for all reviews (or specific org)
yarev embed [--org <id>] [--force]

# Semantic search (auto-uses embeddings if available)
yarev search "poor quality work" --semantic

# Topic analysis
yarev topics <org_id> [--limit 10]
# Output: [{ topic: "Цены", count: 45, avg_stars: 2.8, sample: "..." }, ...]

# Find similar reviews across companies
yarev similar --text "долго ждать" [--org <id>]
```

### Config

```env
YAREV_OPENAI_API_KEY=sk-...
YAREV_EMBEDDING_MODEL=text-embedding-3-small  # default
YAREV_EMBEDDING_BATCH_SIZE=100                 # reviews per API call
```

## Implementation Priority

1. **`review_embeddings` table + `yarev embed` command** — foundation
2. **Semantic `yarev search`** — immediate value, enhances existing command
3. **`yarev topics`** — the "what customers like/dislike" insight
4. **`yarev similar`** — cross-company comparison
5. **Response analysis** — later, needs more thought on metrics

## Predefined Topics (for classification approach)

Embed these labels, classify each review by cosine similarity:

```typescript
const TOPICS = [
  'Цены и стоимость услуг',
  'Время ожидания и скорость обслуживания',
  'Качество выполненных работ',
  'Отношение персонала и общение',
  'Чистота и комфорт зоны ожидания',
  'Запчасти и наценка на детали',
  'Диагностика и честность рекомендаций',
  'Запись и доступность сервиса',
  'Гарантия на работы',
  'Мойка автомобиля',
];
```

Each review gets 1-2 topic labels. Then `yarev topics` aggregates by topic.

## Open Questions for Next Session

- sqlite-vec for dev or skip straight to pgvector?
- Embed on every sync automatically or manual `yarev embed` only?
- Cache embeddings locally when using pgvector? (offline access)
- Topic labels: predefined list vs. LLM-generated from actual reviews?
