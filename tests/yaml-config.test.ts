import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYarevConfig } from '../src/yaml-config.js';

const VALID_YAML = `
companies:
  - org_id: "111"
    name: Test Service
    role: mine
    service_type: auto_service
    competitors:
      - org_id: "222"
        priority: 9
        notes: "Direct competitor"
    topics:
      - name: Цены
        subtopics:
          - Стоимость работ
          - Наценка на запчасти
      - name: Качество
        subtopics:
          - Качество ремонта
  - org_id: "222"
    name: Competitor
    role: competitor
    service_type: auto_service
    topics: inherit
embeddings:
  model: text-embedding-3-small
  batch_size: 100
`;

describe('parseYarevConfig', () => {
  it('parses valid YAML config', () => {
    const config = parseYarevConfig(VALID_YAML);
    assert.equal(config.companies.length, 2);
    assert.equal(config.companies[0].org_id, '111');
    assert.equal(config.companies[0].service_type, 'auto_service');
    assert.deepEqual(config.companies[0].competitors, [
      { org_id: '222', priority: 9, notes: 'Direct competitor' },
    ]);
  });

  it('parses topic hierarchy', () => {
    const config = parseYarevConfig(VALID_YAML);
    const topics = config.companies[0].topics;
    assert.ok(Array.isArray(topics));
    assert.equal((topics as any)[0].name, 'Цены');
    assert.deepEqual((topics as any)[0].subtopics, ['Стоимость работ', 'Наценка на запчасти']);
  });

  it('resolves inherit topics from same service_type', () => {
    const config = parseYarevConfig(VALID_YAML);
    const competitor = config.companies[1];
    // After parsing, inherit should be resolved to the same topics as the first auto_service
    assert.ok(Array.isArray(competitor.topics));
    assert.equal((competitor.topics as any).length, 2);
    assert.equal((competitor.topics as any)[0].name, 'Цены');
  });

  it('parses embeddings config', () => {
    const config = parseYarevConfig(VALID_YAML);
    assert.equal(config.embeddings.model, 'text-embedding-3-small');
    assert.equal(config.embeddings.batch_size, 100);
  });

  it('throws on missing companies', () => {
    assert.throws(() => parseYarevConfig('embeddings:\n  model: x'), /companies/);
  });

  it('throws on invalid role', () => {
    const bad = `
companies:
  - org_id: "1"
    name: X
    role: invalid
    service_type: auto
    topics: []
embeddings:
  model: x
  batch_size: 1
`;
    assert.throws(() => parseYarevConfig(bad), /role/);
  });
});
