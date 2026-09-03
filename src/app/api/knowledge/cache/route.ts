import { NextResponse } from "next/server";
import {
  clearKnowledgeCache,
  getKnowledgeCacheStatus,
  KNOWLEDGE_CACHE_TTL_MS,
  setCachedNotionKnowledge,
} from "@/lib/knowledge/knowledgeCache";
import { loadNotionKnowledge } from "@/lib/knowledge/loadKnowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    ...getKnowledgeCacheStatus(),
  });
}

export async function POST() {
  try {
    clearKnowledgeCache();

    const notion = await loadNotionKnowledge();
    const cache = setCachedNotionKnowledge(notion);

    return NextResponse.json({
      ok: true,
      refreshed: true,
      notionSources: notion.filter((item) => item.text.trim()).length,
      updatedAt: new Date(cache.updatedAt).toISOString(),
      nextRefreshAt: new Date(
        cache.updatedAt + KNOWLEDGE_CACHE_TTL_MS
      ).toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Knowledge refresh failed",
      },
      { status: 500 }
    );
  }
}
