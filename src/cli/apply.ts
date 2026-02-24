import { Command } from 'commander';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { openDb } from '../db/schema.js';
import { loadYarevConfig } from '../yaml-config.js';
import { upsertCompany } from '../db/companies.js';
import { upsertTopics } from '../db/topics.js';
import type { YarevConfig, YarevTopicConfig } from '../types/index.js';

export function applyConfig(db: Database.Database, yarevConfig: YarevConfig): void {
  const updateServiceType = db.prepare('UPDATE companies SET service_type = ? WHERE org_id = ?');
  const upsertRelation = db.prepare(`
    INSERT INTO company_relations (company_org_id, competitor_org_id, priority, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(company_org_id, competitor_org_id) DO UPDATE SET
      priority = excluded.priority,
      notes = excluded.notes
  `);

  db.transaction(() => {
    // 1. Upsert companies
    for (const company of yarevConfig.companies) {
      upsertCompany(db, {
        org_id: company.org_id,
        name: company.name,
        role: company.role,
      });
      updateServiceType.run(company.service_type, company.org_id);
    }

    // 2. Upsert competitor relations
    for (const company of yarevConfig.companies) {
      if (company.competitors) {
        for (const comp of company.competitors) {
          upsertRelation.run(company.org_id, comp.org_id, comp.priority, comp.notes ?? null);
        }
      }
    }

    // 3. Upsert topics
    for (const company of yarevConfig.companies) {
      if (Array.isArray(company.topics)) {
        upsertTopics(db, company.org_id, company.topics as YarevTopicConfig[]);
      }
    }
  })();
}

export const applyCommand = new Command('apply')
  .description('Apply YAML config to database (companies, topics, competitors)')
  .option('--config <path>', 'Path to config.yaml')
  .option('--dry-run', 'Show what would change without applying')
  .action((opts) => {
    const yarevConfig = loadYarevConfig(opts.config);
    const db = openDb(config.dbPath);

    if (opts.dryRun) {
      console.log(`Would apply ${yarevConfig.companies.length} companies:`);
      for (const c of yarevConfig.companies) {
        const topicCount = Array.isArray(c.topics) ? c.topics.length : 0;
        console.log(`  ${c.org_id} ${c.name} (${c.role}, ${topicCount} topics)`);
      }
      db.close();
      return;
    }

    applyConfig(db, yarevConfig);

    console.log(`Applied config: ${yarevConfig.companies.length} companies`);
    for (const c of yarevConfig.companies) {
      const topicCount = Array.isArray(c.topics)
        ? c.topics.reduce((sum, t) => sum + 1 + t.subtopics.length, 0)
        : 0;
      console.log(`  ${c.org_id} ${c.name} — ${topicCount} topics`);
    }
    db.close();
  });
