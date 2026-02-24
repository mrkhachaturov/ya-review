# AI Scoring Algorithm

[Русская версия](scoring-algorithm.ru.md)

## Overview

The yarev scoring system analyzes reviews in three stages:

```
Reviews → [Embeddings] → [Classification] → [Scoring]
         (OpenAI)        (local)            (local)
```

Only the first stage (embeddings) calls an external API. Classification and scoring run entirely locally on your machine.

## Stage 1: Embeddings (`yarev embed`)

Each review text and topic label is sent to OpenAI's `text-embedding-3-small` model, which returns a vector of 1536 numbers — a "semantic fingerprint" of the text.

```
"Great repair, fast and professional" → [0.023, -0.041, 0.018, ...] (1536 numbers)
"Repair quality"                      → [0.031, -0.015, 0.042, ...]
```

Texts with similar meaning produce similar vectors. Vectors are stored locally in SQLite as Float32 blobs.

**Cost:** ~$0.02 per 1M tokens (~$0.01 for 1000 reviews).

## Stage 2: Classification (`yarev classify`)

For each review, we compute [cosine similarity](https://en.wikipedia.org/wiki/Cosine_similarity) between the review's vector and each subtopic's vector:

```
cosine("Great repair, fast", "Repair quality")     = 0.82 ✅ match
cosine("Great repair, fast", "Waiting area")        = 0.31 ✅ weak match
cosine("Great repair, fast", "Parts markup")         = 0.18 ❌ below threshold
```

**Parameters:**
- **Threshold:** 0.3 (minimum similarity to assign a topic)
- **Max topics per review:** 3 (a review can relate to multiple topics)

A single review can be assigned to multiple subtopics (up to 3). Reviews with no text are skipped.

## Stage 3: Scoring (`yarev score`)

No AI involved — pure math on star ratings and dates.

### Step 3a: Stars → Score (2-10 scale)

Stars are mapped linearly to a 2-10 scale:

| Stars | Score |
|-------|-------|
| 1 ★   | 2.0   |
| 2 ★★  | 4.0   |
| 3 ★★★ | 6.0   |
| 4 ★★★★ | 8.0  |
| 5 ★★★★★ | 10.0 |

**Formula:** `score = stars × 2`

### Step 3b: Recency Weighting

Recent reviews matter more. Each review gets a weight based on its age:

| Review age     | Weight |
|----------------|--------|
| < 6 months     | 2.0×   |
| 6–12 months    | 1.5×   |
| > 12 months    | 1.0×   |

### Step 3c: Weighted Average

The topic score is a weighted average:

```
topic_score = Σ(score_i × weight_i) / Σ(weight_i)
```

**Example — "Repair quality" topic with 4 reviews:**

| Review         | Stars | Score | Age      | Weight | Score × Weight |
|----------------|-------|-------|----------|--------|----------------|
| Review A       | 5     | 10.0  | 2 months | 2.0    | 20.0           |
| Review B       | 4     | 8.0   | 1 month  | 2.0    | 16.0           |
| Review C       | 3     | 6.0   | 8 months | 1.5    | 9.0            |
| Review D       | 5     | 10.0  | 2 years  | 1.0    | 10.0           |
| **Total**      |       |       |          | **6.5**| **55.0**       |

**Topic score = 55.0 / 6.5 = 8.5**

### Step 3d: Parent Topic Aggregation

Parent topics aggregate their subtopics by review count:

```
parent_score = Σ(subtopic_score × subtopic_review_count) / Σ(subtopic_review_count)
```

### Step 3e: Confidence Level

Based on the number of classified reviews per topic:

| Reviews | Confidence | Meaning |
|---------|-----------|---------|
| < 5     | low       | Not enough data, score may be unreliable |
| 5–19    | medium    | Reasonable estimate |
| 20+     | high      | Statistically reliable |

### Step 3f: Overall Company Score

Same weighted average across all parent topics:

```
overall = Σ(parent_score × parent_review_count) / Σ(parent_review_count)
```

## Comparison Mode (`yarev score --compare`)

When comparing two companies:
- Both are scored independently using the same algorithm
- Delta is calculated per topic: `Δ = score_A − score_B`
- Markers indicate significant differences:
  - ✅ when your score is ≥ 0.5 higher
  - ❌ when your score is ≥ 0.5 lower

## Source Code

| Component | File |
|-----------|------|
| Embedding client | `src/embeddings/client.ts` |
| Vector math | `src/embeddings/vectors.ts` |
| Classification | `src/embeddings/classify.ts` |
| Scoring | `src/embeddings/scoring.ts` |
| Score command | `src/cli/score.ts` |
