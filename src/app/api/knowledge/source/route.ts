import { NextResponse } from "next/server";
import { loadCombinedKnowledge } from "@/lib/knowledge/loadKnowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeFullText = searchParams.get("full") === "1";

    const result = await loadCombinedKnowledge();

    return NextResponse.json({
      ok: true,
      counts: result.counts,
      elapsedMs: result.elapsedMs,
      priority: [
        "1. Notion internal rules",
        "2. Official SportBet rules/privacy pages",
        "3. SportBet blog articles",
      ],
      sources: result.sources.map((source) => ({
        id: source.id,
        sourceType: source.sourceType,
        priority: source.priority,
        title: source.title,
        url: source.url,
        textLength: source.text.length,
        preview: source.text.slice(0, 600),
        ...(includeFullText ? { text: source.text } : {}),
      })),
      errors: result.errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown combined knowledge error",
      },
      { status: 500 }
    );
  }
}
