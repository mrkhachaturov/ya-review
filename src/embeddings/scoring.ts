const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
const TWELVE_MONTHS_MS = 12 * 30 * 24 * 60 * 60 * 1000;

export function starsToScore(stars: number): number {
  // Map 1-5 stars to 2-10 scale
  return stars * 2;
}

export function recencyWeight(dateStr: string): number {
  const now = Date.now();
  const reviewDate = new Date(dateStr).getTime();
  const age = now - reviewDate;

  if (age <= SIX_MONTHS_MS) return 2.0;
  if (age <= TWELVE_MONTHS_MS) return 1.5;
  return 1.0;
}

export function confidenceLevel(reviewCount: number): 'high' | 'medium' | 'low' {
  if (reviewCount >= 20) return 'high';
  if (reviewCount >= 5) return 'medium';
  return 'low';
}

export interface ScoreResult {
  score: number;
  review_count: number;
  confidence: 'high' | 'medium' | 'low';
}

export function computeTopicScore(reviews: { stars: number; date: string }[]): ScoreResult {
  if (reviews.length === 0) {
    return { score: 0, review_count: 0, confidence: 'low' };
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const r of reviews) {
    const base = starsToScore(r.stars);
    const weight = recencyWeight(r.date);
    weightedSum += base * weight;
    totalWeight += weight;
  }

  const score = Math.round((weightedSum / totalWeight) * 10) / 10;

  return {
    score,
    review_count: reviews.length,
    confidence: confidenceLevel(reviews.length),
  };
}
