import type { Config } from '../config.js';
import type { Review, ScrapeResult } from '../types/index.js';
import type { BrowserInstance } from './browser.js';
import { SEL, REVIEWS_URL_TEMPLATE, REVIEW_URL_TEMPLATE } from './selectors.js';
import { parseCompanyInfo } from './company.js';

export async function scrapeReviews(
  browserInstance: BrowserInstance,
  orgId: string,
  cfg: Config,
  opts: { full?: boolean } = {},
): Promise<ScrapeResult> {
  const context = await browserInstance.newContext();

  try {
    const page = await context.newPage();

    // Hide webdriver flag if backend doesn't handle it natively
    if (!browserInstance.handlesWebdriver) {
      await page.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      `);
    }

    const url = REVIEWS_URL_TEMPLATE.replace('{org_id}', orgId);

    // Navigate with retry
    await navigateWithRetry(page, url, cfg);

    // Verify page exists
    await checkPageExists(page, orgId);

    // Wait for reviews
    await waitForReviews(page, cfg);

    // Parse company info
    const company = await parseCompanyInfo(page);
    const totalCount = company.review_count ?? 0;

    // Parse initial reviews
    let allReviews = await parseReviewsFromDom(page, orgId);

    // If full sync, scroll to load more
    if (opts.full) {
      const maxPages = cfg.maxPages;
      let prevCount = allReviews.length;

      for (let scroll = 2; scroll <= maxPages; scroll++) {
        await scrollToLoadMore(page, cfg);
        allReviews = await parseReviewsFromDom(page, orgId);
        if (allReviews.length <= prevCount) break;
        prevCount = allReviews.length;
      }
    }

    return {
      company,
      reviews: allReviews,
      total_count: totalCount || allReviews.length,
    };
  } finally {
    await context.close();
  }
}

async function navigateWithRetry(page: any, url: string, cfg: Config): Promise<void> {
  for (let attempt = 1; attempt <= cfg.scraperRetries; attempt++) {
    try {
      await page.goto(url, { timeout: cfg.pageTimeout, waitUntil: 'domcontentloaded' });
      return;
    } catch (err) {
      if (attempt < cfg.scraperRetries) {
        await sleep(cfg.scraperRetryDelay * attempt * 1000);
      } else {
        throw new Error(`Failed to load ${url} after ${attempt} attempts: ${err}`);
      }
    }
  }
}

async function checkPageExists(page: any, orgId: string): Promise<void> {
  try {
    await page.waitForSelector(SEL.PAGE_EXISTS, { timeout: 10000 });
  } catch {
    const title = await page.title();
    if (title.includes('404') || title.toLowerCase().includes('не найден')) {
      throw new Error(`Business with org_id=${orgId} not found`);
    }
  }
}

async function waitForReviews(page: any, cfg: Config): Promise<void> {
  try {
    await page.waitForSelector(SEL.REVIEW, { timeout: cfg.interceptTimeout });
  } catch {
    // Reviews may not be present — not fatal
  }
}

async function expandBusinessResponses(page: any): Promise<void> {
  await page.evaluate(`
    (() => {
      const btns = document.querySelectorAll('.business-review-view__comment-expand');
      btns.forEach(btn => {
        if (btn.textContent.includes('Посмотреть')) btn.click();
      });
    })()
  `);
  await sleep(2000);
}

async function parseReviewsFromDom(page: any, orgId: string): Promise<Review[]> {
  await expandBusinessResponses(page);
  const reviewEls = await page.querySelectorAll(SEL.REVIEW);
  const reviews: Review[] = [];

  for (const el of reviewEls) {
    // Author name
    const nameEl = await el.querySelector(SEL.AUTHOR_NAME);
    const nameText = nameEl ? await nameEl.textContent() : null;
    const author_name = nameText?.trim() || null;

    // Avatar URL from style attribute
    const avatarEl = await el.querySelector(SEL.AVATAR);
    const author_icon_url = await extractAvatarUrl(avatarEl);

    // Author profile URL + review URL
    const profileEl = await el.querySelector(SEL.PROFILE_LINK);
    const author_profile_url = profileEl ? await profileEl.getAttribute('href') : null;
    const review_url = buildReviewUrl(orgId, author_profile_url);

    // Date
    const dateEl = await el.querySelector(SEL.DATE);
    const date = dateEl ? await dateEl.getAttribute('content') : null;

    // Stars — try meta tag first, then count star spans
    const ratingEl = await el.querySelector(SEL.RATING);
    let stars = 0;
    if (ratingEl) {
      const ratingStr = await ratingEl.getAttribute('content');
      stars = ratingStr ? parseFloat(ratingStr.replace(',', '.')) || 0 : 0;
    } else {
      stars = await countStars(el);
    }

    // Text — prefer spoiler container, fall back to body
    let textContainer = await el.querySelector(SEL.TEXT_SPOILER);
    if (!textContainer) textContainer = await el.querySelector(SEL.TEXT);
    const rawText = textContainer ? await textContainer.textContent() : null;
    const text = rawText?.trim() || null;

    // Likes and dislikes
    const { likes, dislikes } = await extractReactions(el);

    // Business response
    const business_response = await extractBusinessResponse(el);

    reviews.push({
      author_name, author_icon_url, author_profile_url,
      date, text, stars, likes, dislikes, review_url, business_response,
    });
  }

  return reviews;
}

async function scrollToLoadMore(page: any, cfg: Config): Promise<void> {
  await page.evaluate(`
    (() => {
      const reviews = document.querySelectorAll('.business-reviews-card-view__review');
      if (reviews.length > 0) {
        reviews[reviews.length - 1].scrollIntoView();
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
    })()
  `);
  await sleep(cfg.requestDelay * 1000);
}

async function extractAvatarUrl(avatarEl: any): Promise<string | null> {
  if (!avatarEl) return null;
  const style = await avatarEl.getAttribute('style');
  if (!style) return null;
  const match = style.match(/url\(["']?(.*?)["']?\)/);
  return match ? match[1] : null;
}

async function countStars(reviewEl: any): Promise<number> {
  const starEls = await reviewEl.querySelectorAll('.business-rating-badge-view__stars span');
  let rating = 0;
  for (const star of starEls) {
    const cls = (await star.getAttribute('class')) ?? '';
    if (cls.includes('_empty')) continue;
    else if (cls.includes('_half')) rating += 0.5;
    else rating += 1.0;
  }
  return rating;
}

async function extractReactions(reviewEl: any): Promise<{ likes: number; dislikes: number }> {
  const containers = await reviewEl.querySelectorAll(SEL.REACTIONS_CONTAINER);
  let likes = 0;
  let dislikes = 0;
  for (const container of containers) {
    const label = (await container.getAttribute('aria-label')) ?? '';
    const counterEl = await container.querySelector(SEL.REACTIONS_COUNTER);
    const countText = counterEl ? await counterEl.textContent() : '0';
    const count = parseInt(countText, 10) || 0;
    if (label.includes('Лайк')) likes = count;
    else if (label.includes('Дизлайк')) dislikes = count;
  }
  return { likes, dislikes };
}

async function extractBusinessResponse(reviewEl: any): Promise<string | null> {
  const bubble = await reviewEl.querySelector(SEL.BIZ_COMMENT_TEXT);
  if (!bubble) return null;
  const text = await bubble.textContent();
  return text?.trim() || null;
}

function buildReviewUrl(orgId: string, profileUrl: string | null): string | null {
  if (!profileUrl) return null;
  const publicId = profileUrl.replace(/\/$/, '').split('/').pop();
  if (!publicId) return null;
  return REVIEW_URL_TEMPLATE
    .replace('{org_id}', orgId)
    .replace('{public_id}', publicId);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
