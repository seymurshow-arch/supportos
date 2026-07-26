import { NextResponse } from "next/server";
import { livechatPost } from "@/livechat";
import {
  getLiveChatProjects,
  resolveLiveChatProjects,
} from "@/services/livechatProjectsService";

const REPORT_TIMEZONE = "Europe/Kiev";
const ARCHIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ARCHIVE_PAGES = 100;
const CLASSIFICATION_BATCH_SIZE = 30;
const MAX_MESSAGES_PER_CHAT = 30;
const MAX_MESSAGE_LENGTH = 700;

type ProjectOption = { name: string; groupIds: number[] };
type ArchiveEvent = {
  type?: string;
  text?: string;
  author_id?: string;
  timestamp?: string;
};
type ArchiveThread = { tags?: string[]; events?: ArchiveEvent[] };
type ArchiveUser = { id?: string; name?: string; email?: string; type?: string };
type ArchiveChat = {
  id?: string;
  users?: ArchiveUser[];
  tags?: string[];
  events?: ArchiveEvent[];
  thread?: ArchiveThread;
  threads?: ArchiveThread[];
};
type CompactMessage = { role: "customer" | "agent" | "system"; text: string };
type CompactChat = { id: string; tags: string[]; messages: CompactMessage[] };
type Period = "current" | "previous";
type IssueOccurrence = {
  period: Period;
  chatId: string;
  label: string;
  evidence: string;
  relatedTags: string[];
};
type CanonicalIssue = {
  title: string;
  description: string;
  aliases: string[];
};
type ProblemStatus = "important" | "growing" | "decreasing" | "new" | "disappeared";
type AiProblemResult = {
  title: string;
  description: string;
  status: ProblemStatus;
  currentCount: number;
  previousCount: number;
  percentChange: number | null;
  chatIds: string[];
  relatedTags: string[];
};
type AiResult = { summary: string; problems: AiProblemResult[]; notes: string[] };

const archiveCache = new Map<string, { expiresAt: number; chats: ArchiveChat[] }>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function getDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function normalizeDateParam(value: string | null, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}
function getDefaultRange() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 6);
  return { from: getDateString(from), to: getDateString(now) };
}
function getPreviousSameRange(from: string, to: string) {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
  const previousTo = new Date(fromDate);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - days + 1);
  return { from: getDateString(previousFrom), to: getDateString(previousTo) };
}
function getPartsForInstant(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const match = get("timeZoneName").match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offset = match ? `${match[1]}${match[2].padStart(2, "0")}:${match[3] || "00"}` : "+02:00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}`, offset };
}
function getOffsetForDate(date: string) {
  return getPartsForInstant(new Date(`${date}T12:00:00.000Z`)).offset;
}
function getTodayInReportTimezone() {
  return getPartsForInstant(new Date()).date;
}
function toArchiveFrom(date: string) {
  return `${date}T00:00:00.000000${getOffsetForDate(date)}`;
}
function toArchiveTo(date: string) {
  if (date >= getTodayInReportTimezone()) {
    const now = getPartsForInstant(new Date());
    return `${now.date}T${now.time}.999000${now.offset}`;
  }
  return `${date}T23:59:59.999000${getOffsetForDate(date)}`;
}
function splitList(value: string | null) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
function normalizeLower(value: string) {
  return value.trim().toLowerCase();
}
function removeSensitiveText(value: unknown) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/\b\d{5,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}
function collectTagsDeep(value: unknown, tags: Set<string>, depth = 0) {
  if (!value || depth > 5) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTagsDeep(item, tags, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.tags)) {
    obj.tags.forEach((tag) => {
      if (typeof tag === "string" && tag.trim()) tags.add(tag.trim());
    });
  }
  Object.values(obj).forEach((nested) => collectTagsDeep(nested, tags, depth + 1));
}
function getAllChatTags(chat: ArchiveChat) {
  const tags = new Set<string>();
  collectTagsDeep(chat, tags);
  return Array.from(tags);
}
function getAllEvents(chat: ArchiveChat) {
  const events: ArchiveEvent[] = [];
  if (Array.isArray(chat.events)) events.push(...chat.events);
  if (Array.isArray(chat.thread?.events)) events.push(...chat.thread.events);
  if (Array.isArray(chat.threads)) chat.threads.forEach((thread) => thread.events && events.push(...thread.events));
  return events.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
}
function compactChat(chat: ArchiveChat): CompactChat | null {
  if (!chat.id) return null;
  const roleById = new Map<string, CompactMessage["role"]>();
  for (const user of chat.users || []) {
    if (!user.id) continue;
    roleById.set(user.id, user.type === "customer" ? "customer" : user.type === "agent" ? "agent" : "system");
  }
  const messages = getAllEvents(chat)
    .filter((event) => event.type === "message")
    .map((event) => ({
      role: event.author_id ? roleById.get(event.author_id) || "system" : "system",
      text: removeSensitiveText(event.text),
    }))
    .filter((message) => message.text.length >= 4)
    .slice(0, MAX_MESSAGES_PER_CHAT);
  if (!messages.some((message) => message.role === "customer")) return null;
  return { id: chat.id, tags: getAllChatTags(chat).slice(0, 20), messages };
}
function chatMatchesSelectedTags(chat: ArchiveChat, selectedTags: string[]) {
  if (!selectedTags.length) return true;
  const chatTags = getAllChatTags(chat).map(normalizeLower);
  return selectedTags.map(normalizeLower).some((tag) => chatTags.includes(tag));
}
function compactChats(chats: ArchiveChat[], selectedTags: string[]) {
  const deduped = new Map<string, CompactChat>();
  for (const chat of chats) {
    if (!chatMatchesSelectedTags(chat, selectedTags)) continue;
    const compact = compactChat(chat);
    if (compact) deduped.set(compact.id, compact);
  }
  return Array.from(deduped.values());
}
function getProjectFilter(projectParam: string | null, projects: ProjectOption[]) {
  const selectedNames = splitList(projectParam);
  if (!selectedNames.length || selectedNames.some((name) => normalizeLower(name) === "all")) return null;
  const selectedLower = selectedNames.map(normalizeLower);
  const matched = projects.filter((project) => selectedLower.includes(normalizeLower(project.name)));
  if (!matched.length) return null;
  return { names: matched.map((project) => project.name), groupIds: Array.from(new Set(matched.flatMap((project) => project.groupIds))) };
}
function cacheKey(from: string, to: string, groupIds: number[] | null) {
  return JSON.stringify({ from, to, groupIds: groupIds?.slice().sort((a, b) => a - b) || [] });
}
async function getArchives(from: string, to: string, groupIds: number[] | null) {
  const key = cacheKey(from, to, groupIds);
  const cached = archiveCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { chats: cached.chats, fromCache: true };

  const allChats: ArchiveChat[] = [];
  const seenPageIds = new Set<string>();
  let pageId: string | undefined;
  for (let page = 0; page < MAX_ARCHIVE_PAGES; page++) {
    if (page > 0) await sleep(250);
    const body: Record<string, unknown> = pageId
      ? { page_id: pageId }
      : {
          limit: 100,
          sort_order: "desc",
          filters: {
            from: toArchiveFrom(from),
            to: toArchiveTo(to),
            ...(groupIds?.length ? { groups: { values: groupIds } } : {}),
          },
        };
    const response = await livechatPost<any>("/v3.5/agent/action/list_archives", body);
    const chats = Array.isArray(response?.chats) ? response.chats : [];
    allChats.push(...chats);
    const nextPageId = response?.next_page_id;
    if (!nextPageId || !chats.length || seenPageIds.has(nextPageId)) break;
    seenPageIds.add(nextPageId);
    pageId = nextPageId;
  }
  archiveCache.set(key, { chats: allChats, expiresAt: Date.now() + ARCHIVE_CACHE_TTL_MS });
  return { chats: allChats, fromCache: false };
}
function readOutputText(data: any) {
  if (typeof data?.output_text === "string") return data.output_text;
  const item = data?.output?.flatMap((outputItem: any) => outputItem?.content || [])?.find((contentItem: any) => contentItem?.type === "output_text");
  return typeof item?.text === "string" ? item.text : "";
}
async function callOpenAI<T>(schemaName: string, schema: Record<string, unknown>, system: string, payload: unknown): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing. AI analysis cannot run.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
    }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`OpenAI request failed. Status ${response.status}. ${responseText.slice(0, 300)}`);
  const data = JSON.parse(responseText);
  const outputText = readOutputText(data);
  if (!outputText) throw new Error("OpenAI returned empty output.");
  return JSON.parse(outputText) as T;
}

const classificationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          chatId: { type: "string" },
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                evidence: { type: "string" },
                relatedTags: { type: "array", items: { type: "string" } },
              },
              required: ["label", "evidence", "relatedTags"],
            },
          },
        },
        required: ["chatId", "issues"],
      },
    },
  },
  required: ["chats"],
};

type BatchClassification = { chats: Array<{ chatId: string; issues: Array<{ label: string; evidence: string; relatedTags: string[] }> }> };

async function classifyPeriod(chats: CompactChat[], period: Period, selectedTags: string[]) {
  const occurrences: IssueOccurrence[] = [];
  for (let offset = 0; offset < chats.length; offset += CLASSIFICATION_BATCH_SIZE) {
    const batch = chats.slice(offset, offset + CLASSIFICATION_BATCH_SIZE);
    const result = await callOpenAI<BatchClassification>(
      "support_chat_classification",
      classificationSchema,
      [
        "You are a senior casino support operations analyst.",
        "Read each complete conversation, including both customer and agent messages, to determine the actual cause.",
        "Return only genuine operational problems: failures, incorrect processing, unexpected delays, broken flows, defects, or material product/process malfunctions.",
        "Do not classify greetings, thanks, generic requests, ordinary questions, routine no-deposit bonus requests, or popular intents without a real malfunction.",
        "Use concise semantic issue labels. Merge equivalent wording within the batch. Do not use keyword matching.",
        "A chat may have multiple independent issues only when no tag filter is selected. When tags are selected, report only issues relevant to those tags.",
        "Never invent evidence and never expose personal data.",
      ].join(" "),
      { period, selectedTags: selectedTags.length ? selectedTags : ["All tags"], chats: batch },
    );
    const validIds = new Set(batch.map((chat) => chat.id));
    for (const classified of result.chats) {
      if (!validIds.has(classified.chatId)) continue;
      for (const issue of classified.issues) {
        const label = issue.label.trim();
        if (!label) continue;
        occurrences.push({
          period,
          chatId: classified.chatId,
          label,
          evidence: issue.evidence.trim(),
          relatedTags: issue.relatedTags.map((tag) => tag.trim()).filter(Boolean),
        });
      }
    }
  }
  return occurrences;
}

const consolidationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
        },
        required: ["title", "description", "aliases"],
      },
    },
  },
  required: ["issues"],
};

type ConsolidationResult = { issues: CanonicalIssue[] };

async function consolidateOccurrences(occurrences: IssueOccurrence[]) {
  const grouped = new Map<string, { label: string; examples: string[]; count: number }>();
  for (const occurrence of occurrences) {
    const key = normalizeLower(occurrence.label);
    const current = grouped.get(key) || { label: occurrence.label, examples: [], count: 0 };
    current.count += 1;
    if (occurrence.evidence && current.examples.length < 3) current.examples.push(occurrence.evidence);
    grouped.set(key, current);
  }
  const candidates = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
  if (!candidates.length) return [];
  const result = await callOpenAI<ConsolidationResult>(
    "support_issue_consolidation",
    consolidationSchema,
    [
      "You consolidate semantically equivalent casino support operational problems.",
      "Merge labels that describe the same underlying failure even when wording differs.",
      "Keep genuinely distinct causes separate. Do not merge broad categories such as bonus, deposit, or withdrawal when the actual failures differ.",
      "Every input label must appear exactly once in one aliases array.",
      "Descriptions must be short management-friendly explanations of what players experience. Do not include counts, percentages, recommendations, or invented facts.",
    ].join(" "),
    { candidates },
  );
  return result.issues;
}

function calculateStatus(currentCount: number, previousCount: number): ProblemStatus {
  if (currentCount > 0 && previousCount === 0) return "new";
  if (currentCount === 0 && previousCount > 0) return "disappeared";
  if (previousCount === 0) return "important";
  const change = ((currentCount - previousCount) / previousCount) * 100;
  if (change >= 20 && currentCount - previousCount >= 2) return "growing";
  if (change <= -20 && previousCount - currentCount >= 2) return "decreasing";
  return "important";
}
function percentChange(currentCount: number, previousCount: number) {
  if (previousCount === 0) return null;
  return Math.round(((currentCount - previousCount) / previousCount) * 1000) / 10;
}
function buildAnalysis(occurrences: IssueOccurrence[], canonicalIssues: CanonicalIssue[]): AiResult {
  const problems: AiProblemResult[] = [];
  for (const canonical of canonicalIssues) {
    const aliases = new Set(canonical.aliases.map(normalizeLower));
    const matching = occurrences.filter((occurrence) => aliases.has(normalizeLower(occurrence.label)));
    const currentIds = Array.from(new Set(matching.filter((item) => item.period === "current").map((item) => item.chatId)));
    const previousIds = Array.from(new Set(matching.filter((item) => item.period === "previous").map((item) => item.chatId)));
    const currentCount = currentIds.length;
    const previousCount = previousIds.length;
    if (!currentCount && !previousCount) continue;
    const relatedTags = Array.from(new Set(matching.flatMap((item) => item.relatedTags))).slice(0, 8);
    const status = calculateStatus(currentCount, previousCount);
    problems.push({
      title: canonical.title,
      description: canonical.description,
      status,
      currentCount,
      previousCount,
      percentChange: percentChange(currentCount, previousCount),
      chatIds: (status === "disappeared" ? previousIds : currentIds).slice(0, 3),
      relatedTags,
    });
  }
  problems.sort((a, b) => {
    const priority: Record<ProblemStatus, number> = { new: 5, growing: 4, important: 3, decreasing: 2, disappeared: 1 };
    return priority[b.status] - priority[a.status] || b.currentCount - a.currentCount;
  });
  const statusCounts = problems.reduce<Record<ProblemStatus, number>>(
    (acc, problem) => ({ ...acc, [problem.status]: acc[problem.status] + 1 }),
    { important: 0, growing: 0, decreasing: 0, new: 0, disappeared: 0 },
  );
  const summary = problems.length
    ? `Detected ${problems.length} meaningful operational issue${problems.length === 1 ? "" : "s"}: ${statusCounts.new} new, ${statusCounts.growing} growing, ${statusCounts.important} persistent, ${statusCounts.decreasing} decreasing, and ${statusCounts.disappeared} no longer observed.`
    : "No meaningful recurring, growing, new, or disappearing operational problems were detected for the selected filters.";
  return { summary, problems, notes: [] };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const defaults = getDefaultRange();
    const from = normalizeDateParam(searchParams.get("from"), defaults.from);
    const to = normalizeDateParam(searchParams.get("to"), defaults.to);
    if (from > to) throw new Error("The start date cannot be later than the end date.");
    const selectedTags = splitList(searchParams.get("tags"));
    const requestedProjectNames = splitList(searchParams.get("project"));
    const previousRange = getPreviousSameRange(from, to);

    const projects = requestedProjectNames.length
      ? await resolveLiveChatProjects(requestedProjectNames)
      : await getLiveChatProjects();
    const projectFilter = getProjectFilter(searchParams.get("project"), projects);
    if (requestedProjectNames.length && !projectFilter) {
      throw new Error("None of the selected projects currently matches a LiveChat group.");
    }

    const currentArchiveResult = await getArchives(from, to, projectFilter?.groupIds || null);
    await sleep(300);
    const previousArchiveResult = await getArchives(previousRange.from, previousRange.to, projectFilter?.groupIds || null);
    const currentChats = compactChats(currentArchiveResult.chats, selectedTags);
    const previousChats = compactChats(previousArchiveResult.chats, selectedTags);
    if (currentChats.length < 2 && previousChats.length < 2) {
      throw new Error("Not enough chats to analyze. Try a wider date range or fewer filters.");
    }

    const currentOccurrences = await classifyPeriod(currentChats, "current", selectedTags);
    const previousOccurrences = await classifyPeriod(previousChats, "previous", selectedTags);
    const occurrences = [...currentOccurrences, ...previousOccurrences];
    const canonicalIssues = await consolidateOccurrences(occurrences);
    const analysis = buildAnalysis(occurrences, canonicalIssues);

    return NextResponse.json({
      ok: true,
      period: { from, to },
      previousPeriod: previousRange,
      filters: { projects: projectFilter?.names || [], tags: selectedTags },
      stats: {
        currentArchivesLoaded: currentArchiveResult.chats.length,
        previousArchivesLoaded: previousArchiveResult.chats.length,
        currentChatsAnalyzed: currentChats.length,
        previousChatsAnalyzed: previousChats.length,
      },
      analysis,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown AI analysis error" },
      { status: 500 },
    );
  }
}
