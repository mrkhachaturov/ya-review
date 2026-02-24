import type { DbClient } from './driver.js';
import type { YarevTopicConfig } from '../types/index.js';

export interface TopicRow {
  id: number;
  org_id: string;
  parent_id: number | null;
  name: string;
  embedding: Buffer | null;
  created_at: string;
}

export async function upsertTopics(db: DbClient, orgId: string, topics: YarevTopicConfig[]): Promise<void> {
  await clearTopicsForOrg(db, orgId);

  await db.transaction(async () => {
    for (const topic of topics) {
      const row = await db.get<{ id: number }>(
        'INSERT INTO topic_templates (org_id, parent_id, name) VALUES (?, NULL, ?) RETURNING id',
        [orgId, topic.name],
      );
      const parentId = row!.id;
      for (const sub of topic.subtopics) {
        await db.run(
          'INSERT INTO topic_templates (org_id, parent_id, name) VALUES (?, ?, ?)',
          [orgId, parentId, sub],
        );
      }
    }
  });
}

export async function getTopicsForOrg(db: DbClient, orgId: string): Promise<TopicRow[]> {
  return db.all<TopicRow>('SELECT * FROM topic_templates WHERE org_id = ? ORDER BY id', [orgId]);
}

export async function getParentTopics(db: DbClient, orgId: string): Promise<TopicRow[]> {
  return db.all<TopicRow>(
    'SELECT * FROM topic_templates WHERE org_id = ? AND parent_id IS NULL ORDER BY id',
    [orgId],
  );
}

export async function getSubtopics(db: DbClient, parentId: number): Promise<TopicRow[]> {
  return db.all<TopicRow>('SELECT * FROM topic_templates WHERE parent_id = ? ORDER BY id', [parentId]);
}

export async function clearTopicsForOrg(db: DbClient, orgId: string): Promise<void> {
  // Delete children first (FK constraint), then parents
  await db.run('DELETE FROM topic_templates WHERE org_id = ? AND parent_id IS NOT NULL', [orgId]);
  await db.run('DELETE FROM topic_templates WHERE org_id = ?', [orgId]);
}
