import { Command } from 'commander';
import { createDbClient } from '../db/driver.js';
import { initSchema } from '../db/schema.js';
import { config } from '../config.js';

export const queryCommand = new Command('query')
  .description('Run raw SQL against the reviews database (returns JSON)')
  .argument('<sql>', 'SQL query to run')
  .option('--pretty', 'Pretty-print JSON', false)
  .action(async (sql: string, opts) => {
    const db = await createDbClient(config);
    await initSchema(db);
    try {
      const rows = await db.all(sql);
      console.log(opts.pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows));
    } catch (err) {
      console.error(JSON.stringify({ error: String(err) }));
      process.exit(1);
    }
    await db.close();
  });
