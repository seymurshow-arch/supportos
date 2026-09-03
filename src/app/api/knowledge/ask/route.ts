import { NextResponse } from "next/server";
import {
  loadCombinedKnowledge,
  type KnowledgeSource,
} from "@/lib/knowledge/loadKnowledge";
import {
  collectBroadEvidence,
  type KnowledgeSearchPlan,
} from "@/lib/knowledge/broadEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AskBody = {
  question?: string;
};

function getOutputText(data: any) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const content = data?.output
    ?.flatMap((item: any) => item?.content || [])
    ?.find((item: any) => item?.type === "output_text");

  return typeof content?.text === "string" ? content.text : "";
}

function getAnswerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      found: { type: "boolean" },
      usedSourceIds: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["answer", "found", "usedSourceIds"],
  };
}

function getPlannerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      canonicalQuestion: { type: "string" },
      searchPhrases: {
        type: "array",
        minItems: 4,
        maxItems: 16,
        items: { type: "string" },
      },
      answerSignals: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: { type: "string" },
      },
      topicHints: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: { type: "string" },
      },
    },
    required: [
      "canonicalQuestion",
      "searchPhrases",
      "answerSignals",
      "topicHints",
    ],
  };
}

async function callStructuredOpenAI(input: {
  apiKey: string;
  model: string;
  system: string;
  user: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: [
        {
          role: "system",
          content: input.system,
        },
        {
          role: "user",
          content: JSON.stringify(input.user, null, 2),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    }),
    cache: "no-store",
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenAI API error ${response.status}: ${raw.slice(0, 700)}`
    );
  }

  const data = JSON.parse(raw);
  const outputText = getOutputText(data);

  if (!outputText) {
    throw new Error("OpenAI returned no structured output");
  }

  try {
    return JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI returned invalid structured JSON");
  }
}

async function makeSearchPlan(input: {
  apiKey: string;
  model: string;
  question: string;
  sources: KnowledgeSource[];
}): Promise<KnowledgeSearchPlan> {
  const sourceTitles = input.sources.map((source) => ({
    id: source.id,
    type: source.sourceType,
    title: source.title,
  }));

  const parsed = await callStructuredOpenAI({
    apiKey: input.apiKey,
    model: input.model,
    schemaName: "knowledge_search_plan",
    schema: getPlannerSchema(),
    system: [
      "You are a search-query planner for the internal SportBet knowledge base.",
      "DO NOT answer the user's question.",
      "Your only job is to create a broad multilingual search plan that helps another system find every potentially relevant fact.",
      "",
      "The user may write in Ukrainian, Russian, English, mixed language, slang, abbreviations, misspellings or phonetic spellings.",
      "Normalize the intent into clear English, but preserve important product names.",
      "",
      "Generate:",
      "- a canonical English version of the question;",
      "- multiple search phrases, including synonyms and likely wording used in documentation;",
      "- answer signals: phrases that are likely to appear close to the actual answer (for example 'minimum credit', 'minimum amount', 'not issued below', 'VIP rank');",
      "- topic hints such as Weekly Bonus, VIP Club, Sportsbook, withdrawal, deposit wagering, etc.",
      "",
      "Search broadly. Do not assume the answer will use the same exact words as the user's question.",
      "Distinguish similarly named products where possible, e.g. Welcome Risk-Free Bet vs VIP Regular/Risk-Free Bet.",
    ].join("\n"),
    user: {
      question: input.question,
      availableSourceTitles: sourceTitles,
    },
  });

  return {
    canonicalQuestion: String(parsed.canonicalQuestion || input.question),
    searchPhrases: Array.isArray(parsed.searchPhrases)
      ? parsed.searchPhrases.map(String)
      : [],
    answerSignals: Array.isArray(parsed.answerSignals)
      ? parsed.answerSignals.map(String)
      : [],
    topicHints: Array.isArray(parsed.topicHints)
      ? parsed.topicHints.map(String)
      : [],
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AskBody;
    const question = String(body.question || "").trim();

    if (!question) {
      return NextResponse.json(
        { ok: false, error: "Question is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "OPENAI_API_KEY is missing. Add it to .env.local and restart the app.",
        },
        { status: 500 }
      );
    }

    const model =
      process.env.OPENAI_QA_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      "gpt-5.6-luna";

    const knowledge = await loadCombinedKnowledge();

    if (!knowledge.sources.length) {
      return NextResponse.json(
        { ok: false, error: "No knowledge sources are available" },
        { status: 500 }
      );
    }

    /*
     * STAGE 1 — AI search planning
     *
     * This fixes the old problem where:
     *   "яка мінімальна сума бонусу віклі"
     * had to lexically match:
     *   "Weekly Bonus / Minimum credit"
     *
     * The planner understands the user's wording first.
     */
    const searchPlan = await makeSearchPlan({
      apiKey,
      model,
      question,
      sources: knowledge.sources,
    });

    /*
     * STAGE 2 — broad evidence collection
     *
     * Every loaded Notion + Terms source is scanned.
     * We collect multiple relevant windows, not one "best snippet".
     */
    const broad = collectBroadEvidence(
      knowledge.sources,
      question,
      searchPlan,
      {
        maxChunks: 28,
        maxChars: 78_000,
        maxChunkChars: 7_000,
      }
    );

    const evidenceSourceMap = new Map(
      broad.evidence.map((item) => [
        item.source.id,
        item.source,
      ])
    );

    const availableSources = Array.from(
      new Map(
        broad.evidence.map((item) => [
          item.source.id,
          {
            id: item.source.id,
            sourceType: item.source.sourceType,
            priority: item.source.priority,
            title: item.source.title,
            url: item.source.url,
          },
        ])
      ).values()
    );

    console.log("[knowledge][broad-search]", {
      question,
      searchPlan,
      debug: broad.debug,
    });

    /*
     * STAGE 3 — answer synthesis
     *
     * The model now receives the combined evidence gathered from all
     * potentially relevant sources and must synthesize only after reviewing it.
     */
    const parsed = await callStructuredOpenAI({
      apiKey,
      model,
      schemaName: "knowledge_answer",
      schema: getAnswerSchema(),
      system: [
        "You are the internal SportBet Knowledge Assistant.",
        "",
        "You MUST answer only from the supplied evidence.",
        "Do not use outside knowledge to invent product rules, procedures, limits, amounts, timelines, exceptions, or policies.",
        "",
        "HOW TO WORK:",
        "1. Read ALL supplied evidence chunks before deciding the answer.",
        "2. Combine supporting facts that may be split across different Notion pages or Terms sections.",
        "3. Do not conclude 'not found' merely because one source omits a detail.",
        "4. found=false is allowed ONLY when none of the supplied evidence explicitly or reasonably supports the requested fact.",
        "5. If one source gives a general description and another gives the missing exact amount/rank/time, use both and answer with the exact supported value.",
        "",
        "SOURCE PRIORITY FOR REAL CONFLICTS:",
        "1. Notion internal SOP/procedures.",
        "2. Static SportBet Terms.",
        "",
        "Priority is ONLY for resolving genuine contradictions. A higher-priority source that simply omits a detail does not override a lower-priority source that explicitly provides it.",
        "",
        "IMPORTANT PRODUCT DISTINCTIONS:",
        "- Do not confuse similarly named bonuses.",
        "- A Welcome Risk-Free Bet and a VIP Regular/Risk-Free Bet may be different products with different rules.",
        "- Use context such as VIP rank, welcome offer, amount, frequency, cooldown and activation flow to identify the correct product.",
        "",
        "For sportsbook settlement, prefer the specific sport/market rule when present.",
        "For internal support actions/escalations, prefer Notion SOP.",
        "",
        "Return only SOURCE_ID values that actually support the final answer.",
        "Answer in the same language as the user's question unless explicitly requested otherwise.",
        "Be concise but include the exact amount/rank/time/condition when the evidence contains it.",
      ].join("\n"),
      user: {
        originalQuestion: question,
        searchPlan,
        evidenceCollectionSummary: {
          totalKnowledgeSourcesScanned:
            broad.debug.scannedSources,
          candidateSectionsFound:
            broad.debug.candidateSections,
          evidenceChunksReviewed:
            broad.debug.evidenceChunks,
        },
        availableSources,
        evidence: broad.context,
      },
    });

    const usedIds = Array.isArray(parsed.usedSourceIds)
      ? parsed.usedSourceIds.map(String)
      : [];

    const sources = Array.from(new Set(usedIds as string[]))
  .map((id) => evidenceSourceMap.get(id))
      .filter(Boolean)
      .map((source) => ({
        id: source!.id,
        sourceType: source!.sourceType,
        priority: source!.priority,
        title: source!.title,
        url: source!.url,
      }));

    return NextResponse.json({
      ok: true,
      question,
      answer: String(parsed.answer || "").trim(),
      found: Boolean(parsed.found),
      sources,
      meta: {
        model,
        retrievalMode: "AI plan → scan all sources → collect evidence → synthesize",
        totalKnowledgeSources: knowledge.counts.total,
        notionSources: knowledge.counts.notion,
        termsSources: knowledge.counts.terms,
        scannedSources: broad.debug.scannedSources,
        candidateSections: broad.debug.candidateSections,
        evidenceChunksSentToAI: broad.debug.evidenceChunks,
        evidenceCharsSentToAI:
          broad.debug.totalEvidenceChars,
        knowledgeLoadMs: knowledge.elapsedMs,
        notionError: knowledge.errors.notion,
        notionFromCache:
          knowledge.cache?.notionFromCache ?? false,
        searchPlan,
        retrievalDebug: broad.debug,
      },
    });
  } catch (error) {
    console.error("[knowledge-assistant] ask failed", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown Knowledge Assistant error",
      },
      { status: 500 }
    );
  }
}
