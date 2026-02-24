import type Database from 'better-sqlite3';
import type { YarevTopicConfig } from '../types/index.js';

export interface TopicRow {
  id: number;
  org_id: string;
  parent_id: number | null;
  name: string;
  embedding: Buffer | null;
  created_at: string;
}

export function upsertTopics(db: Database.Database, orgId: string, topics: YarevTopicConfig[]): void {
  clearTopicsForOrg(db, orgId);

  const insertParent = db.prepare(`
    INSERT INTO topic_templates (org_id, parent_id, name) VALUES (?, NULL, ?)
  `);
  const insertChild = db.prepare(`
    INSERT INTO topic_templates (org_id, parent_id, name) VALUES (?, ?, ?)
  `);

  const run = db.transaction(() => {
    for (const topic of topics) {
      const result = insertParent.run(orgId, topic.name);
      const parentId = result.lastInsertRowid as number;
      for (const sub of topic.subtopics) {
        insertChild.run(orgId, parentId, sub);
      }
    }
  });

  run();
}

export function getTopicsForOrg(db: Database.Database, orgId: string): TopicRow[] {
  return db.prepare('SELECT * FROM topic_templates WHERE org_id = ? ORDER BY id').all(orgId) as TopicRow[];
}

export function getParentTopics(db: Database.Database, orgId: string): TopicRow[] {
  return db.prepare(
    'SELECT * FROM topic_templates WHERE org_id = ? AND parent_id IS NULL ORDER BY id',
  ).all(orgId) as TopicRow[];
}

export function getSubtopics(db: Database.Database, parentId: number): TopicRow[] {
  return db.prepare('SELECT * FROM topic_templates WHERE parent_id = ? ORDER BY id').all(parentId) as TopicRow[];
}

export function clearTopicsForOrg(db: Database.Database, orgId: string): void {
  // Delete children first (FK constraint), then parents
  db.prepare('DELETE FROM topic_templates WHERE org_id = ? AND parent_id IS NOT NULL').run(orgId);
  db.prepare('DELETE FROM topic_templates WHERE org_id = ?').run(orgId);
}
