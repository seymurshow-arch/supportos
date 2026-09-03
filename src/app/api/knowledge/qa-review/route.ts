import { NextResponse } from "next/server";
import { livechatPost } from "@/livechat";
import {
  buildRelevantKnowledgeContext,
  loadCombinedKnowledge,
} from "@/lib/knowledge/loadKnowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_TIMEZONE = "Europe/Kiev";

type LiveChatUser = {
  id?: string;
  name?: string;
  email?: string;
  type?: string;
};

type LiveChatEvent = {
  type?: string;
  text?: string;
  author_id?: string;
  timestamp?: string;
};

type LiveChatArchive = {
  id?: string;
  users?: LiveChatUser[];
  events?: LiveChatEvent[];
  thread?: { events?: LiveChatEvent[] };
  threads?: Array<{ events?: LiveChatEvent[] }>;
};

type RequestBody = {
  mode?: "agent" | "chat";
  chatId?: string;
  agentName?: string;
  agentEmail?: string | null;
  from?: string;
  to?: string;
  maxChats?: number;
};

function safeText(value: unknown) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone removed]")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getOffsetForDate(date: string) {
  const midday = new Date(`${date}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    hour: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(midday);

  const tzPart = parts.find((part) => part.type === "timeZoneName")?.value || "";
  const match = tzPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);

  return match
    ? `${match[1]}${match[2].padStart(2, "0")}:${match[3] || "00"}`
    : "+03:00";
}

function toFrom(date: string) {
  return `${date}T00:00:00${getOffsetForDate(date)}`;
}

function toTo(date: string) {
  return `${date}T23:59:59${getOffsetForDate(date)}`;
}

function getEvents(chat: LiveChatArchive) {
  if (Array.isArray(chat.threads) && chat.threads.length) {
    return chat.threads.flatMap((thread) => thread.events || []);
  }

  if (Array.isArray(chat.thread?.events)) {
    return chat.thread?.events || [];
  }

  return chat.events || [];
}

function targetAgentIds(
  chat: LiveChatArchive,
  agentName: string,
  agentEmail: string
) {
  const expectedName = normalize(agentName);
  const expectedEmail = normalize(agentEmail);

  return new Set(
    (chat.users || [])
      .filter((user) => {
        if (user.type !== "agent") return false;

        const nameMatch =
          expectedName && normalize(user.name) === expectedName;

        const emailMatch =
          expectedEmail && normalize(user.email) === expectedEmail;

        return Boolean(nameMatch || emailMatch);
      })
      .map((user) => user.id)
      .filter((value): value is string => Boolean(value))
  );
}

function chatBelongsToAgent(
  chat: LiveChatArchive,
  agentName: string,
  agentEmail: string
) {
  const ids = targetAgentIds(chat, agentName, agentEmail);

  if (ids.size > 0) return true;

  const expectedName = normalize(agentName);
  const expectedEmail = normalize(agentEmail);

  return (chat.users || []).some((user) => {
    if (user.type !== "agent") return false;

    return Boolean(
      (expectedName && normalize(user.name).includes(expectedName)) ||
        (expectedEmail && normalize(user.email) === expectedEmail)
    );
  });
}

function compactChat(
  chat: LiveChatArchive,
  agentName: string,
  agentEmail: string,
  index: number
) {
  const usersById = new Map(
    (chat.users || [])
      .filter((user) => user.id)
      .map((user) => [user.id as string, user])
  );

  const targetIds = targetAgentIds(chat, agentName, agentEmail);

  const messages = getEvents(chat)
    .filter((event) => event.type === "message")
    .map((event) => {
      const author = event.author_id
        ? usersById.get(event.author_id)
        : undefined;

      const role =
        event.author_id && targetIds.has(event.author_id)
          ? "agent"
          : author?.type === "customer"
            ? "customer"
            : author?.type === "agent"
              ? "other_agent"
              : "unknown";

      return {
        role,
        text: safeText(event.text).slice(0, 1200),
        timestamp: event.timestamp || null,
      };
    })
    .filter((message) => message.text.length > 0)
    .slice(0, 60);

  const firstTimestamp =
    messages.find((message) => message.timestamp)?.timestamp || null;

  return {
    chatId: chat.id || `chat-${index + 1}`,
    date: firstTimestamp,
    messages,
  };
}

async function loadArchives(from: string, to: string, limit: number) {
  const response = await livechatPost<any>(
    "/v3.5/agent/action/list_archives",
    {
      filters: {
        from: toFrom(from),
        to: toTo(to),
      },
      limit,
      sort_order: "desc",
    }
  );

  const chats =
    response?.chats ||
    response?.archives ||
    response?.data ||
    response?.results ||
    [];

  return Array.isArray(chats) ? (chats as LiveChatArchive[]) : [];
}


async function loadChatById(chatId: string) {
  const attempts: Array<() => Promise<any>> = [
    () =>
      livechatPost<any>("/v3.5/agent/action/get_chat", {
        chat_id: chatId,
        thread_limit: 100,
      }),
    () =>
      livechatPost<any>("/v3.5/agent/action/get_chat", {
        chat_id: chatId,
      }),
  ];

  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const response = await attempt();
      const chat =
        response?.chat ||
        response?.data?.chat ||
        response?.data ||
        response;

      if (chat && typeof chat === "object") {
        return chat as LiveChatArchive;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`LiveChat chat ${chatId} was not found`);
}

function detectAgentForSingleChat(chat: LiveChatArchive) {
  const agents = (chat.users || []).filter(
    (user) => user.type === "agent"
  );

  if (!agents.length) {
    return {
      name: "Support Agent",
      email: "",
    };
  }

  const messageAuthors = new Set(
    getEvents(chat)
      .filter((event) => event.type === "message" && event.author_id)
      .map((event) => event.author_id as string)
  );

  const activeAgent =
    agents.find((agent) => agent.id && messageAuthors.has(agent.id)) ||
    agents[0];

  return {
    name: String(activeAgent?.name || "Support Agent"),
    email: String(activeAgent?.email || ""),
  };
}

function getQaSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reviews: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            chatId: { type: "string" },
            date: { type: "string" },
            score: { type: "integer", minimum: 0, maximum: 100 },
            result: { type: "string", enum: ["Passed", "Issue"] },
            issue: { type: "string" },
            rule: { type: "string" },
            finding: { type: "string" },
            recommendedAction: { type: "string" },
          },
          required: [
            "chatId",
            "date",
            "score",
            "result",
            "issue",
            "rule",
            "finding",
            "recommendedAction",
          ],
        },
      },
    },
    required: ["reviews"],
  };
}

function getOutputText(data: any) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const content = data?.output
    ?.flatMap((item: any) => item?.content || [])
    ?.find((item: any) => item?.type === "output_text");

  return typeof content?.text === "string" ? content.text : "";
}

async function analyzeWithOpenAI(input: {
  agentName: string;
  from: string;
  to: string;
  chats: ReturnType<typeof compactChat>[];
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model =
    process.env.OPENAI_QA_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5.6-luna";

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is missing. Add it to .env.local and Vercel Environment Variables."
    );
  }

  const combinedKnowledge = await loadCombinedKnowledge();

  const transcriptQuery = input.chats
    .flatMap((chat) =>
      chat.messages.map((message) => `${message.role}: ${message.text}`)
    )
    .join("\n");

  const relevantKnowledge = buildRelevantKnowledgeContext(
    combinedKnowledge.sources,
    transcriptQuery,
    {
      maxSources: 16,
      maxChars: 55_000,
    }
  );

  const knowledgeContext = relevantKnowledge.context;

  const knowledgeMode =
    `Notion + Static SportBet Terms ` +
    `(${combinedKnowledge.counts.notion} Notion, ` +
    `${combinedKnowledge.counts.terms} Terms loaded; ` +
    `${relevantKnowledge.selected.length} relevant sources sent to AI)`;

  const baseline = [
    "Score each chat from 0 to 100 based only on evidence in the transcript and supplied knowledge.",
    "Do not invent a violation. If no clear violation is visible, mark Passed.",
    "Passed should normally score 90-100.",
    "Issue means a concrete support-quality or procedure problem is visible.",
    "Evaluate factual correctness, misleading promises, escalation quality, clarity, tone, privacy, and whether the agent followed the available rule context.",
    "If no specific connected rule is available, use rule='Internal QA baseline' instead of fabricating a rule number.",
    "Never output customer email addresses, phone numbers, account IDs, or other personal data.",
    "Keep finding and recommendedAction concise and operational.",
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a senior casino support QA auditor. Review support conversations conservatively and consistently. You may only use the supplied transcript and supplied QA knowledge. Never invent policies, rule numbers, or violations. If sources conflict, follow this priority: Notion internal SOP/procedures first, Static SportBet Terms second. Source priority resolves actual conflicts only; it must not cause you to ignore a more relevant Terms rule.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              task:
                "Review each supplied LiveChat conversation for the selected support agent and return one QA result per chat.",
              agent: input.agentName,
              period: {
                from: input.from,
                to: input.to,
                timezone: REPORT_TIMEZONE,
              },
              knowledge: knowledgeContext || null,
              sourcePriority: [
                "Notion internal SOP/procedures",
                "Static SportBet Terms",
              ],
              baseline,
              chats: input.chats,
            },
            null,
            2
          ),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "support_qa_reviews",
          strict: true,
          schema: getQaSchema(),
        },
      },
    }),
    cache: "no-store",
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenAI API error ${response.status}: ${raw.slice(0, 400)}`
    );
  }

  const data = JSON.parse(raw);
  const outputText = getOutputText(data);

  if (!outputText) {
    throw new Error("OpenAI returned no structured QA output");
  }

  let parsed: any;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI returned invalid QA JSON");
  }

  return {
    reviews: Array.isArray(parsed?.reviews) ? parsed.reviews : [],
    model,
    knowledgeMode,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    const mode = body.mode === "chat" || String(body.chatId || "").trim()
      ? "chat"
      : "agent";

    if (mode === "chat") {
      const chatId = String(body.chatId || "").trim();

      if (!chatId) {
        return NextResponse.json(
          { ok: false, error: "LiveChat Chat ID is required" },
          { status: 400 }
        );
      }

      const chat = await loadChatById(chatId);
      const detectedAgent = detectAgentForSingleChat(chat);
      const compactChatData = compactChat(
        chat,
        detectedAgent.name,
        detectedAgent.email,
        0
      );

      if (!compactChatData.messages.length) {
        return NextResponse.json({
          ok: true,
          reviews: [],
          chatsLoaded: 1,
          chatsMatched: 0,
          model:
            process.env.OPENAI_QA_MODEL ||
            process.env.OPENAI_MODEL ||
            "gpt-5.6-luna",
          knowledgeMode: "Chat loaded, but no message events were available",
        });
      }

      const date =
        String(compactChatData.date || "").slice(0, 10) ||
        new Date().toISOString().slice(0, 10);

      const analysis = await analyzeWithOpenAI({
        agentName: detectedAgent.name,
        from: date,
        to: date,
        chats: [compactChatData],
      });

      const review = analysis.reviews[0];

      const reviews = review
        ? [{
            chatId: String(review.chatId || compactChatData.chatId || chatId),
            agent: detectedAgent.name,
            date:
              String(review.date || compactChatData.date || "")
                .replace("T", " ")
                .replace("Z", " UTC") || "-",
            score: Math.min(
              100,
              Math.max(0, Math.round(Number(review.score || 0)))
            ),
            result: review.result === "Issue" ? "Issue" : "Passed",
            issue: safeText(review.issue || "No violations found"),
            rule: safeText(review.rule || "Internal QA baseline"),
            finding: safeText(review.finding || ""),
            recommendedAction: safeText(
              review.recommendedAction || "No coaching action required."
            ),
          }]
        : [];

      return NextResponse.json({
        ok: true,
        reviews,
        chatsLoaded: 1,
        chatsMatched: reviews.length ? 1 : 0,
        model: analysis.model,
        knowledgeMode: analysis.knowledgeMode,
      });
    }

    const agentName = String(body.agentName || "").trim();
    const agentEmail = String(body.agentEmail || "").trim();
    const from = String(body.from || "").trim();
    const to = String(body.to || "").trim();

    if (!agentName) {
      return NextResponse.json(
        { ok: false, error: "Agent name is required" },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json(
        { ok: false, error: "Invalid from/to date format" },
        { status: 400 }
      );
    }

    if (from > to) {
      return NextResponse.json(
        { ok: false, error: "From date cannot be after To date" },
        { status: 400 }
      );
    }

    const maxChats = Math.min(
      Math.max(Number(body.maxChats || 30), 1),
      50
    );

    // Fetch a wider archive window, then filter to the selected agent.
    const archiveLimit = Math.min(Math.max(maxChats * 8, 100), 500);
    const archives = await loadArchives(from, to, archiveLimit);

    const matched = archives
      .filter((chat) =>
        chatBelongsToAgent(chat, agentName, agentEmail)
      )
      .slice(0, maxChats);

    const compact = matched
      .map((chat, index) =>
        compactChat(chat, agentName, agentEmail, index)
      )
      .filter((chat) => chat.messages.length > 0);

    if (compact.length === 0) {
      return NextResponse.json({
        ok: true,
        reviews: [],
        chatsLoaded: archives.length,
        chatsMatched: 0,
        model:
          process.env.OPENAI_QA_MODEL ||
          process.env.OPENAI_MODEL ||
          "gpt-5.6-luna",
        knowledgeMode:
          "Knowledge not loaded because there were no matching LiveChat chats",
      });
    }

    const analysis = await analyzeWithOpenAI({
      agentName,
      from,
      to,
      chats: compact,
    });

    const byId = new Map(
      compact.map((chat) => [
        String(chat.chatId),
        chat,
      ])
    );

    const reviews = analysis.reviews.map((review: any) => {
      const source = byId.get(String(review.chatId));

      return {
        chatId: String(review.chatId || ""),
        agent: agentName,
        date:
          String(review.date || source?.date || "")
            .replace("T", " ")
            .replace("Z", " UTC") || "-",
        score: Math.min(
          100,
          Math.max(0, Math.round(Number(review.score || 0)))
        ),
        result: review.result === "Issue" ? "Issue" : "Passed",
        issue: safeText(review.issue || "No violations found"),
        rule: safeText(review.rule || "Internal QA baseline"),
        finding: safeText(review.finding || ""),
        recommendedAction: safeText(
          review.recommendedAction || "No coaching action required."
        ),
      };
    });

    return NextResponse.json({
      ok: true,
      reviews,
      chatsLoaded: archives.length,
      chatsMatched: compact.length,
      model: analysis.model,
      knowledgeMode: analysis.knowledgeMode,
    });
  } catch (error) {
    console.error("[knowledge-qa] review failed", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown Knowledge QA error",
      },
      { status: 500 }
    );
  }
}
