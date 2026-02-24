import { Command } from 'commander';
import type { DbClient } from '../db/driver.js';
import { config } from '../config.js';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { loadYarevConfig } from '../yaml-config.js';
import { upsertCompany } from '../db/companies.js';
import { upsertTopics } from '../db/topics.js';
import type { YarevConfig, YarevTopicConfig } from '../types/index.js';

export async function applyConfig(db: DbClient, yarevConfig: YarevConfig): Promise<void> {
  await db.transaction(async () => {
    // 1. Upsert companies
    for (const company of yarevConfig.companies) {
      await upsertCompany(db, {
        org_id: company.org_id,
        name: company.name,
        role: company.role,
      });
      await db.run('UPDATE companies SET service_type = ? WHERE org_id = ?', [company.service_type, company.org_id]);
    }

    // 2. Upsert competitor relations
    for (const company of yarevConfig.companies) {
      if (company.competitors) {
        for (const comp of company.competitors) {
          await db.run(`
            INSERT INTO company_relations (company_org_id, competitor_org_id, priority, notes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(company_org_id, competitor_org_id) DO UPDATE SET
              priority = excluded.priority,
              notes = excluded.notes
          `, [company.org_id, comp.org_id, comp.priority, comp.notes ?? null]);
        }
      }
    }

    // 3. Upsert topics
    for (const company of yarevConfig.companies) {
      if (Array.isArray(company.topics)) {
        await upsertTopics(db, company.org_id, company.topics as YarevTopicConfig[]);
      }
    }
  });
}

export const applyCommand = new Command('apply')
  .description('Apply YAML config to database (companies, topics, competitors)')
  .option('--config <path>', 'Path to config.yaml')
  .option('--dry-run', 'Show what would change without applying')
  .action(async (opts) => {
    const yarevConfig = loadYarevConfig(opts.config);
    const db = await createDbClient(config);
    await initSchema(db);

    if (opts.dryRun) {
      console.log(`Would apply ${yarevConfig.companies.length} companies:`);
      for (const c of yarevConfig.companies) {
        const topicCount = Array.isArray(c.topics) ? c.topics.length : 0;
        console.log(`  ${c.org_id} ${c.name} (${c.role}, ${topicCount} topics)`);
      }
      await db.close();
      return;
    }

    await applyConfig(db, yarevConfig);

    console.log(`Applied config: ${yarevConfig.companies.length} companies`);
    for (const c of yarevConfig.companies) {
      const topicCount = Array.isArray(c.topics)
        ? c.topics.reduce((sum, t) => sum + 1 + t.subtopics.length, 0)
        : 0;
      console.log(`  ${c.org_id} ${c.name} — ${topicCount} topics`);
    }
    await db.close();
  });
