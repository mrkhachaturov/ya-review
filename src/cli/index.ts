import { Command } from 'commander';
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

import { initCommand } from './init.js';
import { trackCommand } from './track.js';
import { untrackCommand } from './untrack.js';
import { companiesCommand } from './companies.js';
import { statusCommand } from './status.js';
import { syncCommand } from './sync.js';
import { reviewsCommand } from './reviews.js';
import { competitorCommand } from './competitor.js';
import { compareCommand } from './compare.js';
import { queryCommand } from './query.js';
import { daemonCommand } from './daemon.js';
import { statsCommand } from './stats.js';
import { digestCommand } from './digest.js';
import { searchCommand } from './search.js';
import { trendsCommand } from './trends.js';
import { unansweredCommand } from './unanswered.js';
import { applyCommand } from './apply.js';
import { embedCommand } from './embed.js';

export const program = new Command();
program
  .name('yarev')
  .description('Yandex Maps review tracker — scrape, store, compare')
  .version(version);

program.addCommand(initCommand);
program.addCommand(trackCommand);
program.addCommand(untrackCommand);
program.addCommand(companiesCommand);
program.addCommand(statusCommand);
program.addCommand(syncCommand);
program.addCommand(reviewsCommand);
program.addCommand(competitorCommand);
program.addCommand(compareCommand);
program.addCommand(queryCommand);
program.addCommand(daemonCommand);
program.addCommand(statsCommand);
program.addCommand(digestCommand);
program.addCommand(searchCommand);
program.addCommand(trendsCommand);
program.addCommand(unansweredCommand);
program.addCommand(applyCommand);
program.addCommand(embedCommand);
