import { Command } from 'commander';
import { openDb } from '../db/schema.js';
import { config } from '../config.js';

export const queryCommand = new Command('query')
  .description('Run raw SQL against the reviews database (returns JSON)')
  .argument('<sql>', 'SQL query to run')
  .option('--pretty', 'Pretty-print JSON', false)
  .action((sql: string, opts) => {
    const db = openDb(config.dbPath);
    try {
      const rows = db.prepare(sql).all();
      console.log(opts.pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows));
    } catch (err) {
      console.error(JSON.stringify({ error: String(err) }));
      process.exit(1);
    }
    db.close();
  });
