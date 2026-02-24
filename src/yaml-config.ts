import { parse } from 'yaml';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { YarevConfig, YarevCompanyConfig, YarevTopicConfig } from './types/index.js';

const DEFAULT_CONFIG_PATH = join(homedir(), '.yarev', 'config.yaml');

export function getConfigPath(): string {
  return process.env.YAREV_CONFIG ?? DEFAULT_CONFIG_PATH;
}

export function loadYarevConfig(path?: string): YarevConfig {
  const configPath = path ?? getConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, 'utf-8');
  return parseYarevConfig(raw);
}

export function parseYarevConfig(raw: string): YarevConfig {
  const doc = parse(raw);

  if (!doc?.companies || !Array.isArray(doc.companies)) {
    throw new Error('Config must have a "companies" array');
  }

  const validRoles = new Set(['mine', 'competitor', 'tracked']);
  const companies: YarevCompanyConfig[] = doc.companies.map((c: any) => {
    if (!validRoles.has(c.role)) {
      throw new Error(`Invalid role "${c.role}" for company "${c.org_id}". Must be: mine, competitor, tracked`);
    }
    return {
      org_id: String(c.org_id),
      name: c.name,
      role: c.role,
      service_type: c.service_type ?? 'auto_service',
      competitors: c.competitors ?? [],
      topics: c.topics ?? [],
    } as YarevCompanyConfig;
  });

  // Resolve "inherit" topics
  for (const company of companies) {
    if (company.topics === 'inherit') {
      const donor = companies.find(
        c => c.service_type === company.service_type && Array.isArray(c.topics) && c.topics.length > 0,
      );
      if (donor) {
        company.topics = (donor.topics as YarevTopicConfig[]).map(t => ({ ...t, subtopics: [...t.subtopics] }));
      } else {
        company.topics = [];
      }
    }
  }

  const embeddings = {
    model: doc.embeddings?.model ?? 'text-embedding-3-small',
    batch_size: doc.embeddings?.batch_size ?? 100,
  };

  return { companies, embeddings };
}
