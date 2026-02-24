import type { DbClient } from './driver.js';

/** Generate a NOW() timestamp as ISO string (dialect-agnostic) */
export function jsNow(): string {
  return new Date().toISOString();
}

/** Convert a float32 vector to the storage format for the given dialect */
export function embeddingToSql(db: DbClient, vec: number[]): Buffer | string {
  if (db.dialect === 'postgres') {
    return `[${vec.join(',')}]`;
  }
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

/** Convert stored embedding back to a float32 array */
export function sqlToEmbedding(db: DbClient, raw: Buffer | string): number[] {
  if (db.dialect === 'postgres') {
    const str = typeof raw === 'string' ? raw : raw.toString();
    return JSON.parse(str);
  }
  const buf = raw as Buffer;
  const arr: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    arr.push(buf.readFloatLE(i));
  }
  return arr;
}
