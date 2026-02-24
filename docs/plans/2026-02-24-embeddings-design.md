# Phase B: Embeddings & Semantic Analysis — Design

## Summary

Add semantic embeddings to ya-review for topic classification, semantic search,
and competitor analysis. Introduce a declarative YAML config as the single source
of truth for companies, competitors, and topic hierarchies.

## Architecture Overview

```
config.yaml  ──→  yarev apply  ──→  DB (companies, topics, competitors)
                                       │
reviews ──────→  yarev embed   ──→  review_embeddings + topic embeddings
                                       │
                 yarev classify ──→  review_topics (review ↔ topic matches)
                                       │
           yarev topics / search / similar / compare  ──→  output
```

**Storage backends:**
- Primary: SQLite + sqlite-vec (local, works offline)
- Optional: PostgreSQL + pgvector (external, for Power BI / analytics)

**Embedding model:** OpenAI `text-embedding-3-small` (1536 dimensions, good
multilingual/Russian support, ~$0.02/1M tokens).

## 1. Declarative YAML Config

**Path resolution:** `$YAREV_CONFIG` → `~/.yarev/config.yaml`

`yarev apply` reads this file and syncs the desired state to the DB — companies,
competitor relationships, and topic hierarchies. Like `kubectl apply`.

### Example config.yaml

```yaml
# ~/.yarev/config.yaml
companies:
  # ─── Auto service (your company) ───
  - org_id: "1000000001"
    name: Мой Автосервис
    role: mine
    service_type: auto_service
    competitors:
      - org_id: "2000000001"
        priority: 9
        notes: "Ближайший конкурент, тот же район, схожие цены"
      - org_id: "2000000002"
        priority: 5
        notes: "Тот же город, но премиум-сегмент"
    topics:
      - name: Цены и стоимость
        subtopics:
          - Стоимость работ (нормо-час)
          - Наценка на запчасти
          - Соотношение цена/качество
          - Отказ работать с материалами клиента
      - name: Качество работ
        subtopics:
          - Качество ремонта
          - Переделки и возвраты
          - Повреждение автомобиля при обслуживании
          - Незавершённые работы
      - name: Диагностика и рекомендации
        subtopics:
          - Честность диагностики
          - Навязывание лишних работ
          - Объяснение найденных проблем
      - name: Персонал и общение
        subtopics:
          - Вежливость и отношение
          - Консультирование и объяснение
          - Компетентность мастеров
      - name: Время и доступность
        subtopics:
          - Время ожидания по записи
          - Скорость выполнения работ
          - Запись и дозвон
          - Отказ в обслуживании
      - name: Гарантия и ответственность
        subtopics:
          - Гарантия на работы
          - Реакция на рекламацию
      - name: Комфорт и сервис
        subtopics:
          - Зона ожидания
          - Прозрачность процесса (видеонаблюдение)

  # ─── Auto service (competitor) ───
  - org_id: "2000000001"
    name: Конкурент Авто
    role: competitor
    service_type: auto_service
    topics: inherit  # inherits topic set from auto_service template above

  # ─── Car wash / detailing (your company) ───
  - org_id: "1000000002"
    name: Моя Автомойка
    role: mine
    service_type: car_wash
    topics:
      - name: Качество мойки
        subtopics:
          - Чистота результата
          - Разводы и недомытые места
          - Двухфазная мойка
          - Химчистка салона
      - name: Детейлинг и доп. услуги
        subtopics:
          - Полировка
          - Бронеплёнка
          - Покраска элементов
          - Чернение резины и воск
      - name: Цены
        subtopics:
          - Стоимость мойки
          - Стоимость доп. услуг
          - Сравнение с конкурентами
      - name: Время и доступность
        subtopics:
          - Время ожидания
          - Время выполнения мойки
          - Режим работы
          - Загрузка боксов
      - name: Персонал
        subtopics:
          - Вежливость
          - Обратная связь и решение проблем
      - name: Комфорт
        subtopics:
          - Зона ожидания
          - Видео процесса мойки

embeddings:
  model: text-embedding-3-small
  batch_size: 100
```

### Topic inheritance

When `topics: inherit`, the company inherits topics from the first company with
the same `service_type` that has explicit topics defined. This avoids duplicating
topic lists for competitors of the same type.

## 2. Database Schema

### New tables

```sql
-- Topic templates from YAML config
CREATE TABLE topic_templates (
  id INTEGER PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id INTEGER,              -- NULL = top-level category, else = subtopic
  name TEXT NOT NULL,
  embedding BLOB,                 -- float32[1536], set by `yarev embed`
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES companies(org_id),
  FOREIGN KEY (parent_id) REFERENCES topic_templates(id)
);
CREATE INDEX idx_topic_templates_org ON topic_templates(org_id);

-- Review embeddings
CREATE TABLE review_embeddings (
  review_id INTEGER PRIMARY KEY REFERENCES reviews(id),
  model TEXT NOT NULL,            -- 'text-embedding-3-small'
  text_embedding BLOB NOT NULL,   -- float32[1536]
  response_embedding BLOB,        -- nullable, only when business_response exists
  created_at TEXT DEFAULT (datetime('now'))
);

-- Review ↔ topic classification
CREATE TABLE review_topics (
  id INTEGER PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  topic_id INTEGER NOT NULL REFERENCES topic_templates(id),
  similarity REAL NOT NULL,       -- cosine similarity 0.0–1.0
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(review_id, topic_id)
);
CREATE INDEX idx_review_topics_review ON review_topics(review_id);
CREATE INDEX idx_review_topics_topic ON review_topics(topic_id);
```

### Existing table changes

```sql
-- Extend company_relations with competitor priority
ALTER TABLE company_relations ADD COLUMN priority INTEGER;        -- 1-10 (from YAML)
ALTER TABLE company_relations ADD COLUMN notes TEXT;

-- Add service_type to companies
ALTER TABLE companies ADD COLUMN service_type TEXT;
```

### sqlite-vec integration

When sqlite-vec is available, create virtual tables for vector search:

```sql
CREATE VIRTUAL TABLE vec_reviews USING vec0(
  review_id INTEGER PRIMARY KEY,
  text_embedding float[1536]
);

CREATE VIRTUAL TABLE vec_topics USING vec0(
  topic_id INTEGER PRIMARY KEY,
  embedding float[1536]
);
```

The BLOB columns remain as source-of-truth; vec tables are populated alongside
them for fast ANN queries.

### pgvector schema (external)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Mirror of SQLite tables with native vector types
CREATE TABLE review_embeddings (
  review_id INTEGER PRIMARY KEY,
  model TEXT NOT NULL,
  text_embedding vector(1536) NOT NULL,
  response_embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON review_embeddings USING hnsw (text_embedding vector_cosine_ops);

CREATE TABLE topic_templates (
  id SERIAL PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id INTEGER REFERENCES topic_templates(id),
  name TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## 3. CLI Commands

### New commands

```bash
# Apply YAML config to DB
yarev apply [--config <path>] [--dry-run]

# Generate embeddings for reviews + topic labels
yarev embed [--org <id>] [--force] [--batch]
# --batch  Uses OpenAI Batch API (50% cheaper, async, up to 24h).
#          Submits JSONL, polls for completion, imports results.
#          Best for: initial bulk embed, re-embed with --force, model change.
# Without --batch: synchronous API calls (instant, full price).
#          Best for: incremental updates after sync.

# Classify reviews into topics
yarev classify [--org <id>] [--threshold 0.3]

# Show topic analysis
yarev topics <org_id> [--limit 10]
# Output example:
#   Цены и стоимость          87 reviews  ★2.4  ↑12%
#     Наценка на запчасти      34 reviews  ★1.8
#     Отказ по своим расх.     15 reviews  ★1.5
#     Стоимость работ          28 reviews  ★2.6
#     Соотношение цена/кач.    10 reviews  ★3.1

# Find similar reviews
yarev similar --text "долго ждать" [--org <id>] [--limit 10]
yarev similar --review <id> [--cross-company]
```

### Enhanced existing commands

```bash
# Semantic search (auto-uses embeddings when available)
yarev search "плохое качество" [--org <id>] [--limit 10]

# Compare with competitor similarity scoring
yarev compare <org_1> <org_2> [--topic "Цены"]
```

### Pipeline shortcut

```bash
# Sync + embed + classify in one go
yarev sync --org <id> --embed --classify
```

## 4. Config (.env additions)

```env
YAREV_CONFIG=/path/to/config.yaml           # optional, default ~/.yarev/config.yaml
YAREV_OPENAI_API_KEY=sk-...                 # required for embeddings
YAREV_EMBEDDING_MODEL=text-embedding-3-small # default
YAREV_EMBEDDING_BATCH_SIZE=100              # reviews per API call
YAREV_BATCH_POLL_INTERVAL=30                # seconds between batch status checks
```

## 5. Embedding Modes

### Sync mode (default)

```
yarev embed --org <id>
```

Calls OpenAI `/v1/embeddings` synchronously in batches of 100. Fast, immediate
results. Best for incremental updates (few new reviews after sync).

### Batch mode (`--batch`)

```
yarev embed --org <id> --batch
```

Uses the [OpenAI Batch API](https://platform.openai.com/docs/guides/batch):

1. Collect un-embedded reviews + topic labels
2. Write JSONL file with embedding requests
3. Upload to OpenAI via `/v1/files`
4. Create batch via `/v1/batches`
5. Poll for completion (default every 30s, configurable via `YAREV_BATCH_POLL_INTERVAL`)
6. Download results, parse, store embeddings in DB
7. Clean up uploaded file

**50% cheaper** than sync mode. Completion typically within minutes, guaranteed
within 24h. Progress shown in terminal.

| | Sync | Batch |
|---|---|---|
| Cost | Full price | 50% off |
| Speed | Seconds | Minutes to hours |
| Use case | Incremental (few reviews) | Bulk (initial, re-embed, model change) |

## 6. Topic Classification Algorithm

1. Embed all topic labels (parent + subtopic names) via OpenAI API
2. For each review, compute cosine similarity against all subtopic embeddings
3. Assign top-N subtopics where similarity > threshold (default 0.3)
4. Parent topic is implied by subtopic assignment

Each review gets 1-3 subtopic labels. `yarev topics` aggregates by topic hierarchy.

## 7. AI Quality Score (per company, per topic)

Each company gets an AI-computed quality score, broken down by topic. The overall
score is a weighted average of topic scores.

### How it's computed

For each topic:

1. Collect all reviews classified into that topic
2. Base score = weighted average of stars (1-5 → 2-10 scale)
3. Recency weight: reviews from last 6 months count 2x, last year 1.5x, older 1x
4. Sentiment adjustment: embedding-based sentiment shifts score ±1 point.
   A 3★ review saying "в целом нормально" scores higher than one saying
   "разочарован полностью" — same stars, different sentiment.
5. Volume confidence: scores from <5 reviews are marked as "low confidence"

Overall company score = weighted average of topic scores, where weight = number
of reviews in that topic. Topics mentioned more often have more influence.

### Output

Both main topics and subtopics are scored and shown by default, since
embeddings already process all levels.

```
yarev score <org_id>

Astra Motors                           AI Score: 7.4 / 10
──────────────────────────────────────────────────────────
  Персонал и общение                   9.1 / 10  (156 reviews)
    Вежливость и отношение             9.3
    Консультирование и объяснение      8.9
    Компетентность мастеров            8.7
  Комфорт и сервис                     8.8 / 10  (67 reviews)
    Зона ожидания                      9.0
    Прозрачность процесса              8.2
  Качество работ                       7.9 / 10  (134 reviews)
    Качество ремонта                   8.3
    Переделки и возвраты               7.1
    Повреждение автомобиля             6.8
    Незавершённые работы                6.5
  Время и доступность                  6.5 / 10  (89 reviews)
    Скорость выполнения работ          7.0
    Время ожидания по записи           6.3
    Запись и дозвон                    6.1
    Отказ в обслуживании               5.4
  Диагностика и рекомендации           5.8 / 10  (72 reviews)
    Объяснение найденных проблем       6.5
    Честность диагностики              5.6
    Навязывание лишних работ            4.9
  Гарантия и ответственность           5.2 / 10  (31 reviews)  ⚠ low confidence
    Гарантия на работы                 5.4
    Реакция на рекламацию              4.8
  Цены и стоимость                     4.2 / 10  (187 reviews)
    Соотношение цена/качество          5.1
    Стоимость работ (нормо-час)        4.5
    Наценка на запчасти                3.1
    Отказ работать с мат. клиента      2.8
```

When new topics are added to YAML, `yarev apply` + `yarev classify` automatically
embeds new topic labels, reclassifies reviews, and computes scores for them.

### Comparing companies

```
yarev score --compare <mine> <competitor>
```

Shows side-by-side topic scores for two companies to see where you win and lose.

### Storage

```sql
-- Computed scores, refreshed by `yarev classify` or `yarev score --refresh`
CREATE TABLE company_scores (
  id INTEGER PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES companies(org_id),
  topic_id INTEGER REFERENCES topic_templates(id),  -- NULL = overall score
  score REAL NOT NULL,            -- 0.0–10.0
  review_count INTEGER NOT NULL,
  confidence TEXT NOT NULL,       -- 'high', 'medium', 'low'
  computed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(org_id, topic_id)
);
```

## 8. Implementation Phases

| Phase | Scope | Depends on |
|-------|-------|-----------|
| **1** | YAML config parser + `yarev apply` | — |
| **2** | Schema migrations (new tables, ALTER) | Phase 1 |
| **3** | OpenAI embedding client + `yarev embed` | Phase 2 |
| **4** | Topic classification + `yarev classify` + `yarev topics` | Phase 3 |
| **5** | Semantic `yarev search` + `yarev similar` | Phase 3 |
| **6** | AI quality scoring + `yarev score` | Phase 4 |
| **7** | sqlite-vec integration | Phase 3 |
| **8** | pgvector export | Phase 3 |

## 9. Open Questions (resolved)

| Question | Decision |
|----------|----------|
| sqlite-vec vs BLOB? | sqlite-vec primary, BLOB as fallback |
| One topic set or per-company? | Per-company, defined in YAML |
| Flat or hierarchical topics? | Hierarchical (parent/subtopic), stored with self-referencing parent_id |
| Where to store config? | `$YAREV_CONFIG` → `~/.yarev/config.yaml` |
| Competitor scoring? | Manual priority (YAML) for relevance + AI quality score per company per topic |
| Topic labels language? | Russian (matches review language) |
