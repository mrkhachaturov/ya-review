import { Command } from 'commander';
export const compareCommand = new Command('compare')
  .description('Compare your company against its competitors')
  .action(() => { console.log('Not implemented yet'); });
