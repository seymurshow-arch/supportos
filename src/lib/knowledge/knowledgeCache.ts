import type { KnowledgeSource } from "./loadKnowledge";

const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type KnowledgeCache = {
  notion: KnowledgeSource[];
  updatedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __sportbetKnowledgeCache: KnowledgeCache | undefined;
}

export function getCachedNotionKnowledge() {
  const cache = globalThis.__sportbetKnowledgeCache;

  if (!cache) return null;

  if (Date.now() - cache.updatedAt >= CACHE_TTL_MS) {
    return null;
  }

  return cache;
}

export function setCachedNotionKnowledge(notion: KnowledgeSource[]) {
  const cache: KnowledgeCache = {
    notion,
    updatedAt: Date.now(),
  };

  globalThis.__sportbetKnowledgeCache = cache;

  return cache;
}

export function clearKnowledgeCache() {
  globalThis.__sportbetKnowledgeCache = undefined;
}

export function getKnowledgeCacheStatus() {
  const cache = globalThis.__sportbetKnowledgeCache;

  if (!cache) {
    return {
      cached: false,
      updatedAt: null,
      nextRefreshAt: null,
      notionSources: 0,
    };
  }

  return {
    cached: true,
    updatedAt: new Date(cache.updatedAt).toISOString(),
    nextRefreshAt: new Date(cache.updatedAt + CACHE_TTL_MS).toISOString(),
    notionSources: cache.notion.filter((item) => item.text.trim()).length,
  };
}

export const KNOWLEDGE_CACHE_TTL_MS = CACHE_TTL_MS;
