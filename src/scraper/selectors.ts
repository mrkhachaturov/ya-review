// CSS selectors for Yandex Maps DOM parsing
// Ported from ya-reviews-mcp reviews/scraper.py

export const SEL = {
  // Review elements
  REVIEW: '.business-reviews-card-view__review',
  AUTHOR_NAME: "[itemprop='name']",
  DATE: "meta[itemprop='datePublished']",
  RATING: "meta[itemprop='ratingValue']",
  RATING_STARS: '.business-rating-badge-view__stars._spacing_normal > span',
  TEXT: '.business-review-view__body',
  TEXT_SPOILER: '.spoiler-view__text-container',
  AVATAR: '.user-icon-view__icon',
  PROFILE_LINK: '.business-review-view__link',
  BIZ_COMMENT_EXPAND: '.business-review-view__comment-expand',
  BIZ_COMMENT_TEXT: '.business-review-comment-content__bubble',
  REACTIONS_CONTAINER: '.business-reactions-view__container',
  REACTIONS_COUNTER: '.business-reactions-view__counter',

  // Company info
  COMPANY_NAME: 'h1.orgpage-header-view__header',
  COMPANY_RATING: '.business-summary-rating-badge-view__rating',
  COMPANY_REVIEW_COUNT: "meta[itemprop='reviewCount']",
  COMPANY_ADDRESS: "[class*='business-contacts-view__address-link']",
  COMPANY_CATEGORIES: '.business-categories-view__category',

  // Page verification
  PAGE_EXISTS: "[class*='orgpage-header'], [class*='business-card']",
} as const;

export const REVIEWS_URL_TEMPLATE = 'https://yandex.ru/maps/org/{org_id}/reviews/';
export const REVIEW_URL_TEMPLATE =
  'https://yandex.ru/maps/org/{org_id}/reviews?reviews%5BpublicId%5D={public_id}&utm_source=review';

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];
