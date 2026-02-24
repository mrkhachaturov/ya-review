import type { DbClient } from './driver.js';

export async function initPgSchema(db: DbClient): Promise<void> {
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      org_id TEXT UNIQUE NOT NULL,
      name TEXT,
      rating DOUBLE PRECISION,
      review_count INTEGER,
      address TEXT,
      categories JSONB,
      role TEXT NOT NULL DEFAULT 'tracked',
      service_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS company_relations (
      id SERIAL PRIMARY KEY,
      company_org_id TEXT NOT NULL REFERENCES companies(org_id),
      competitor_org_id TEXT NOT NULL REFERENCES companies(org_id),
      priority INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_org_id, competitor_org_id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      review_key TEXT UNIQUE NOT NULL,
      author_name TEXT,
      author_icon_url TEXT,
      author_profile_url TEXT,
      date TEXT,
      text TEXT,
      stars DOUBLE PRECISION,
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      review_url TEXT,
      business_response TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_org_id ON reviews(org_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(date);
    CREATE INDEX IF NOT EXISTS idx_reviews_stars ON reviews(stars);

    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      sync_type TEXT NOT NULL,
      reviews_added INTEGER NOT NULL DEFAULT 0,
      reviews_updated INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS topic_templates (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      parent_id INTEGER REFERENCES topic_templates(id),
      name TEXT NOT NULL,
      embedding vector(1536),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_topic_templates_org ON topic_templates(org_id);

    CREATE TABLE IF NOT EXISTS review_embeddings (
      review_id INTEGER PRIMARY KEY REFERENCES reviews(id),
      model TEXT NOT NULL,
      text_embedding vector(1536) NOT NULL,
      response_embedding vector(1536),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_topics (
      id SERIAL PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      topic_id INTEGER NOT NULL REFERENCES topic_templates(id),
      similarity DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(review_id, topic_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_topics_review ON review_topics(review_id);
    CREATE INDEX IF NOT EXISTS idx_review_topics_topic ON review_topics(topic_id);

    CREATE TABLE IF NOT EXISTS company_scores (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES companies(org_id),
      topic_id INTEGER REFERENCES topic_templates(id),
      score DOUBLE PRECISION NOT NULL,
      review_count INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, topic_id)
    );
  `);

  // HNSW indexes are created separately because CREATE INDEX IF NOT EXISTS
  // with USING hnsw can't be in a multi-statement exec on some pg versions
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_review_embeddings_cosine
      ON review_embeddings USING hnsw (text_embedding vector_cosine_ops)
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_topic_embeddings_cosine
      ON topic_templates USING hnsw (embedding vector_cosine_ops)
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
