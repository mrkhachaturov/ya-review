import { Command } from 'commander';
export const daemonCommand = new Command('daemon')
  .description('Run scheduled sync in the background')
  .action(() => { console.log('Not implemented yet'); });
