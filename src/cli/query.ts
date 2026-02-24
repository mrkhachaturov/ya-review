import { Command } from 'commander';
export const queryCommand = new Command('query')
  .description('Run raw SQL against the reviews database')
  .action(() => { console.log('Not implemented yet'); });
