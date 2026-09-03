import { NextResponse } from "next/server";
import {
  buildRelevantKnowledgeContext,
  loadCombinedKnowledge,
} from "@/lib/knowledge/loadKnowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const question =
      url.searchParams.get("q")?.trim() ||
      "From which VIP rank is Risk-Free Bet available?";

    const knowledge = await loadCombinedKnowledge();

    const relevant = buildRelevantKnowledgeContext(
      knowledge.sources,
      question,
      {
        maxSources: 10,
        maxChars: 36_000,
      }
    );

    const allNotionMatches = knowledge.sources
      .filter((source) => source.sourceType === "notion")
      .filter((source) => {
        const text = normalize(`${source.title}\n${source.text}`);

        return (
          text.includes("risk-free") ||
          text.includes("risk free") ||
          text.includes("regular bonus") ||
          text.includes("availability by vip rank")
        );
      })
      .map((source) => ({
        id: source.id,
        title: source.title,
        textLength: source.text.length,
        preview: source.text.slice(0, 5000),
      }));

    return NextResponse.json({
      ok: true,
      question,
      cache: knowledge.cache,
      counts: knowledge.counts,
      notionError: knowledge.errors.notion,
      allNotionMatches,
      retrieval: relevant.retrievalDebug,
      selectedContextPreview: relevant.selected.map((source) => ({
        id: source.id,
        title: source.title,
        sourceType: source.sourceType,
        text: source.text.slice(0, 5000),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Knowledge debug failed",
      },
      { status: 500 }
    );
  }
}
