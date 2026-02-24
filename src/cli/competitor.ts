import { Command } from 'commander';
export const competitorCommand = new Command('competitor')
  .description('Manage competitor relationships')
  .action(() => { console.log('Not implemented yet'); });
