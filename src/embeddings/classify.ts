import { cosineSimilarity } from './vectors.js';

export interface TopicMatch {
  topicId: number;
  name: string;
  similarity: number;
}

export interface TopicCandidate {
  id: number;
  name: string;
  embedding: number[];
}

export function classifyReview(
  reviewVec: number[],
  topics: TopicCandidate[],
  threshold = 0.3,
  maxTopics = 3,
): TopicMatch[] {
  return topics
    .map(t => ({
      topicId: t.id,
      name: t.name,
      similarity: cosineSimilarity(reviewVec, t.embedding),
    }))
    .filter(m => m.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxTopics);
}
