import type { SearchResponse } from "@/lib/types";
import { clearCachedQueries, getCachedQuery, putCachedQuery, readState, writeState } from "@/lib/storage";

type SearchCacheValue = {
  response: SearchResponse;
  compliance: {
    legalBasis: string;
    purpose: string;
  };
};

const memoryCache = new Map<string, { value: SearchCacheValue; expiresAt: number; version: number }>();
const scope = "query_cache";
const versionKey = "version";

function nowMs(): number {
  return Date.now();
}

export async function getCacheVersion(): Promise<number> {
  const persisted = await readState<number>(scope, versionKey);
  if (!persisted) return 1;
  return Number(persisted.value) || 1;
}

export async function bumpCacheVersion(): Promise<number> {
  const current = await getCacheVersion();
  const next = current + 1;
  await writeState(scope, versionKey, next);
  memoryCache.clear();
  await clearCachedQueries();
  return next;
}

export async function getSearchCache(key: string): Promise<SearchCacheValue | undefined> {
  const version = await getCacheVersion();
  const local = memoryCache.get(key);
  if (local && local.expiresAt > nowMs() && local.version === version) {
    return local.value;
  }
  const persisted = await getCachedQuery(key);
  if (!persisted) return undefined;
  const expiresAt = new Date(persisted.expiresAt).getTime();
  if (expiresAt <= nowMs() || persisted.cacheVersion !== version) {
    return undefined;
  }
  const payload = persisted.payload as SearchCacheValue;
  memoryCache.set(key, { value: payload, expiresAt, version });
  return payload;
}

export async function setSearchCache(key: string, value: SearchCacheValue, ttlMs: number): Promise<void> {
  const version = await getCacheVersion();
  const expiresAt = nowMs() + ttlMs;
  memoryCache.set(key, { value, expiresAt, version });
  await putCachedQuery({
    key,
    payload: value,
    expiresAt: new Date(expiresAt).toISOString(),
    cacheVersion: version,
    updatedAt: new Date().toISOString(),
  });
}

