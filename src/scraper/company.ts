import { SEL } from './selectors.js';
import type { CompanyInfo } from '../types/index.js';

export async function parseCompanyInfo(page: any): Promise<CompanyInfo> {
  const name = await getText(page, SEL.COMPANY_NAME);

  const ratingText = await getText(page, SEL.COMPANY_RATING);
  const rating = extractRating(ratingText);

  const reviewCountStr = await getAttr(page, SEL.COMPANY_REVIEW_COUNT, 'content');
  const review_count = reviewCountStr ? parseInt(reviewCountStr, 10) : null;

  const address = await getText(page, SEL.COMPANY_ADDRESS);

  const catEls = await page.querySelectorAll(SEL.COMPANY_CATEGORIES);
  const categories: string[] = [];
  for (const el of catEls) {
    const text = await el.textContent();
    if (text?.trim()) categories.push(text.trim());
  }

  return { name, rating, review_count, address, categories };
}

async function getText(page: any, selector: string): Promise<string | null> {
  const el = await page.querySelector(selector);
  if (!el) return null;
  const text = await el.textContent();
  return text?.trim() || null;
}

async function getAttr(page: any, selector: string, attr: string): Promise<string | null> {
  const el = await page.querySelector(selector);
  if (!el) return null;
  return await el.getAttribute(attr);
}

export function extractRating(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d+[.,]\d+|\d+)/);
  if (match) return parseFloat(match[1].replace(',', '.'));
  return null;
}
