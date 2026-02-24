import { Command } from 'commander';
export const reviewsCommand = new Command('reviews')
  .description('Query reviews for an organization')
  .action(() => { console.log('Not implemented yet'); });
