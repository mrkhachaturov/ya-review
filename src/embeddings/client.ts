import { config } from '../config.js';

let _client: any = null;

async function getClient(): Promise<any> {
  if (!_client) {
    if (!config.openaiApiKey) {
      throw new Error('YAREV_OPENAI_API_KEY is required for embeddings. Set it in .env or environment.');
    }
    try {
      const { default: OpenAI } = await import('openai');
      _client = new OpenAI({ apiKey: config.openaiApiKey });
    } catch {
      throw new Error('openai package is required for embeddings. Install it: npm install openai');
    }
  }
  return _client;
}

export async function embedTexts(texts: string[], model?: string): Promise<number[][]> {
  const client = await getClient();
  const response = await client.embeddings.create({
    model: model ?? config.embeddingModel,
    input: texts,
  });
  // Sort by index to ensure order matches input
  return response.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: any) => d.embedding);
}

export async function embedBatched(
  texts: string[],
  batchSize?: number,
  model?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const size = batchSize ?? config.embeddingBatchSize;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += size) {
    const batch = texts.slice(i, i + size);
    const embeddings = await embedTexts(batch, model);
    results.push(...embeddings);
    onProgress?.(Math.min(i + size, texts.length), texts.length);
  }
  return results;
}
