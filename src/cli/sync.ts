import { Command } from 'commander';
export const syncCommand = new Command('sync')
  .description('Sync reviews for tracked organizations')
  .action(() => { console.log('Not implemented yet'); });
