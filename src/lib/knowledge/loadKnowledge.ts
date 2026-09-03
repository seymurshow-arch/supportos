import { SPORTBET_TERMS_SOURCES } from "./sportbetTerms";
import {
  getCachedNotionKnowledge,
  setCachedNotionKnowledge,
} from "./knowledgeCache";

const NOTION_API_VERSION = "2022-06-28";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_NOTION_DEPTH = 64;

export type KnowledgeSource = {
  id: string;
  sourceType: "notion" | "terms";
  priority: 1 | 2;
  title: string;
  url: string | null;
  text: string;
};

type NotionRichText = {
  plain_text?: string;
};

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: any;
};

function normalizeSpace(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’'`´]/g, "")
    .replace(/[^\p{L}\p{N}\s./+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Multilingual support-domain query expansion.
 *
 * The Terms document is mostly English while staff can ask in Ukrainian
 * or Russian. These mappings add English retrieval concepts WITHOUT
 * changing the user's actual question or the final AI answer.
 */
const QUERY_EXPANSIONS: Array<{
  triggers: string[];
  add: string[];
}> = [
  {
    triggers: [
      "перерван", "перерв", "прерван", "прерванн", "зупинен", "остановлен",
      "не заверш", "не догран", "не дограл", "abandon", "interrupt", "suspend"
    ],
    add: ["interrupted", "abandoned", "suspended", "not completed", "not finished", "void", "unsettled bets"],
  },
  {
    triggers: ["перенес", "відклад", "отлож", "postpon", "delay"],
    add: ["postponed", "delayed", "36 hours", "void"],
  },
  {
    triggers: ["футбол", "football", "soccer"],
    add: ["soccer", "football", "regular time", "match"],
  },
  {
    triggers: ["волейбол", "volleyball"],
    add: ["volleyball", "set", "match winner", "set winner"],
  },
  {
    triggers: ["баскетбол", "basketball"],
    add: ["basketball", "overtime", "regular time"],
  },
  {
    triggers: ["теніс", "теннис", "tennis"],
    add: ["tennis", "set", "match winner"],
  },
  {
    triggers: ["тотал", "більше", "менше", "больше", "меньше", "over", "under"],
    add: ["total", "over", "under", "points total", "team total"],
  },
  {
    triggers: ["переможець", "победитель", "winner", "вигра", "выигра"],
    add: ["winner", "match winner", "1x2"],
  },
  {
    triggers: ["перш", "перв", "тайм", "half"],
    add: ["first half", "1st half", "half"],
  },
  {
    triggers: ["друг", "втор", "тайм"],
    add: ["second half", "2nd half", "half"],
  },
  {
    triggers: ["гол", "заб", "score", "goalscorer"],
    add: ["goal", "goals", "player to score", "goalscorer"],
  },
  {
    triggers: ["коеф", "коэфф", "odds"],
    add: ["odds", "1.40", "sports bets"],
  },
  {
    triggers: ["бонус", "bonus"],
    add: ["bonus", "wagering", "bonus terms", "deposit bonus"],
  },
  {
    triggers: ["відіграш", "отыгрыш", "wager", "роловер", "rollover"],
    add: ["wagering", "wagering requirement", "rollover", "12 times", "35 times"],
  },
  {
    triggers: ["депозит", "deposit"],
    add: ["deposit", "minimum deposit", "20 usdt", "1x"],
  },
  {
    triggers: ["вивід", "вывод", "withdraw"],
    add: ["withdrawal", "withdraw", "payout"],
  },
  {
    triggers: ["закр", "закры", "close account", "closure"],
    add: ["account closure", "self exclusion", "responsible gambling", "closure request"],
  },
  {
    triggers: ["самовиключ", "самоисключ", "self exclusion", "self-exclusion"],
    add: ["self-exclusion", "cooling-off", "responsible gambling"],
  },
  {
    triggers: ["vip", "віп", "вип"],
    add: [
      "vip",
      "vip club",
      "vip transfer",
      "vip manager",
      "vip rank",
      "availability by vip rank",
      "bronze",
      "silver",
      "gold",
      "platinum",
      "diamond",
    ],
  },
  {
    triggers: [
      "risk-free",
      "risk free",
      "riskfree",
      "безризик",
      "без риска",
      "ризик-фрі",
      "риск-фри",
      "regular bonus",
    ],
    add: [
      "risk-free bets",
      "risk-free bet",
      "regular bonus",
      "availability by vip rank",
      "vip rank",
      "max bonus amount",
      "period",
      "gold",
      "platinum",
      "diamond",
      "72 hours",
      "48 hours",
      "24 hours",
      "not available",
    ],
  },
  {
    triggers: ["ранг", "rank", "рівень", "уровень"],
    add: [
      "vip rank",
      "availability by vip rank",
      "bronze",
      "silver",
      "gold",
      "platinum",
      "diamond",
      "threshold",
    ],
  },
  {
    triggers: ["2fa", "двофактор", "двухфактор"],
    add: ["2fa", "two-factor authentication", "authentication"],
  },
  {
    triggers: ["ставк", "бет", "bet"],
    add: ["bet", "bets", "bet settlement", "settled"],
  },
  {
    triggers: ["скас", "отмен", "cancel"],
    add: ["cancel", "cancelled", "void", "refund"],
  },
  {
    triggers: ["ескал", "эскал", "escalat"],
    add: ["escalation", "support escalation", "telegram"],
  },
];

function expandQuery(queryText: string) {
  const normalized = normalizeForSearch(queryText);
  const additions = new Set<string>();

  for (const rule of QUERY_EXPANSIONS) {
    if (
      rule.triggers.some((trigger) =>
        normalized.includes(normalizeForSearch(trigger))
      )
    ) {
      rule.add.forEach((value) => additions.add(value));
    }
  }

  return [queryText, ...additions].join(" ");
}

function notionEnv() {
  const token = process.env.NOTION_API_TOKEN?.trim();
  const rootPageId = process.env.NOTION_SUPPORT_ROOT_PAGE_ID?.trim();

  if (!token) throw new Error("NOTION_API_TOKEN is missing");
  if (!rootPageId) {
    throw new Error("NOTION_SUPPORT_ROOT_PAGE_ID is missing");
  }

  return { token, rootPageId };
}

async function notionFetch(
  path: string,
  options?: { method?: "GET" | "POST"; body?: unknown }
) {
  const { token } = notionEnv();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      method: options?.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body:
        options?.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Notion API error ${response.status}: ${text.slice(0, 500)}`
      );
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function richTextToPlainText(items: NotionRichText[] | undefined) {
  if (!Array.isArray(items)) return "";

  return items
    .map((item) => item?.plain_text || "")
    .join("")
    .trim();
}

function extractNotionBlockText(block: NotionBlock) {
  const data = block?.[block.type];

  if (!data) return "";

  // Normal text blocks.
  if (Array.isArray(data.rich_text)) {
    const text = richTextToPlainText(data.rich_text);

    if (!text) return "";

    // Preserve Notion structure in the flattened source.
    // This is especially important for collapsed toggle sections because
    // retrieval can then expand around the matching section heading.
    if (
      block.type === "toggle" ||
      block.type === "heading_1" ||
      block.type === "heading_2" ||
      block.type === "heading_3"
    ) {
      return `[[SECTION]] ${text}`;
    }

    return text;
  }

  // Notion simple tables store actual cell text in table_row.cells.
  if (block.type === "table_row" && Array.isArray(data.cells)) {
    return data.cells
      .map((cell: NotionRichText[]) => richTextToPlainText(cell))
      .map((cell: string) => cell.trim())
      .join(" | ")
      .trim();
  }

  if (block.type === "child_page" || block.type === "child_database") {
    return String(data.title || "").trim();
  }

  return "";
}

function notionPropertyToText(property: any) {
  if (!property || typeof property !== "object") return "";

  switch (property.type) {
    case "title":
      return richTextToPlainText(property.title);
    case "rich_text":
      return richTextToPlainText(property.rich_text);
    case "number":
      return property.number == null ? "" : String(property.number);
    case "select":
      return String(property.select?.name || "");
    case "multi_select":
      return Array.isArray(property.multi_select)
        ? property.multi_select.map((item: any) => item?.name || "").filter(Boolean).join(", ")
        : "";
    case "status":
      return String(property.status?.name || "");
    case "checkbox":
      return property.checkbox ? "Yes" : "No";
    case "date": {
      const start = property.date?.start || "";
      const end = property.date?.end || "";
      return end ? `${start} – ${end}` : start;
    }
    case "url":
      return String(property.url || "");
    case "email":
      return String(property.email || "");
    case "phone_number":
      return String(property.phone_number || "");
    case "people":
      return Array.isArray(property.people)
        ? property.people.map((item: any) => item?.name || item?.id || "").filter(Boolean).join(", ")
        : "";
    case "relation":
      return Array.isArray(property.relation)
        ? property.relation.map((item: any) => item?.id || "").filter(Boolean).join(", ")
        : "";
    case "formula": {
      const formula = property.formula;
      if (!formula || typeof formula !== "object") return "";
      const value = formula[formula.type];
      return value == null ? "" : String(value);
    }
    case "rollup": {
      const rollup = property.rollup;
      if (!rollup || typeof rollup !== "object") return "";
      if (rollup.type === "number") return rollup.number == null ? "" : String(rollup.number);
      if (rollup.type === "date") return String(rollup.date?.start || "");
      if (rollup.type === "array" && Array.isArray(rollup.array)) {
        return rollup.array.map((item: any) => notionPropertyToText(item)).filter(Boolean).join(", ");
      }
      return "";
    }
    default:
      return "";
  }
}

function notionPagePropertiesToText(page: any) {
  const properties = page?.properties || {};

  return Object.entries(properties)
    .map(([name, property]) => {
      const value = notionPropertyToText(property);
      return value ? `${name}: ${value}` : "";
    })
    .filter(Boolean)
    .join(" | ");
}

async function getAllDatabaseRows(databaseId: string) {
  const results: any[] = [];
  let cursor: string | undefined;

  do {
    const data = await notionFetch(`/databases/${databaseId}/query`, {
      method: "POST",
      body: {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      },
    });

    if (Array.isArray(data?.results)) {
      results.push(...data.results);
    }

    cursor =
      data?.has_more && data?.next_cursor
        ? String(data.next_cursor)
        : undefined;
  } while (cursor);

  return results;
}

async function readNotionDatabase(
  databaseId: string,
  title: string,
  visitedPages: Set<string>,
  pages: KnowledgeSource[],
  depth: number
) {
  if (depth > MAX_NOTION_DEPTH) return;

  const rows = await getAllDatabaseRows(databaseId);
  const rowTexts: string[] = [];

  for (const row of rows) {
    const propertiesText = notionPagePropertiesToText(row);
    const bodyParts = await readNotionNestedBlocks(
      row.id,
      visitedPages,
      pages,
      depth + 1
    );

    const rowText = normalizeSpace(
      [propertiesText, ...bodyParts].filter(Boolean).join("\n")
    );

    if (rowText) rowTexts.push(rowText);
  }

  if (rowTexts.length) {
    pages.push({
      id: `notion:database:${databaseId}`,
      sourceType: "notion",
      priority: 1,
      title: title || `Notion database ${databaseId}`,
      url: `https://www.notion.so/${databaseId.replace(/-/g, "")}`,
      text: normalizeSpace(rowTexts.join("\n\n")),
    });
  }
}

async function getNotionPageTitle(pageId: string) {
  const page = await notionFetch(`/pages/${pageId}`);
  const properties = page?.properties || {};

  for (const property of Object.values(properties) as any[]) {
    if (property?.type === "title") {
      const title = richTextToPlainText(property.title);

      if (title) return title;
    }
  }

  return pageId;
}

async function getAllBlockChildren(blockId: string) {
  const results: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      page_size: "100",
    });

    if (cursor) {
      params.set("start_cursor", cursor);
    }

    const data = await notionFetch(
      `/blocks/${blockId}/children?${params.toString()}`
    );

    if (Array.isArray(data?.results)) {
      results.push(...data.results);
    }

    cursor =
      data?.has_more && data?.next_cursor
        ? String(data.next_cursor)
        : undefined;
  } while (cursor);

  return results;
}

async function readNotionNestedBlocks(
  blockId: string,
  visitedPages: Set<string>,
  pages: KnowledgeSource[],
  depth: number
): Promise<string[]> {
  if (depth > MAX_NOTION_DEPTH) return [];

  const textParts: string[] = [];
  const blocks = await getAllBlockChildren(blockId);

  for (const block of blocks) {
    const text = extractNotionBlockText(block);

    if (text && block.type !== "child_page") {
      textParts.push(text);
    }

    if (block.type === "child_page") {
      await readNotionPageRecursive(
        block.id,
        visitedPages,
        pages,
        depth + 1
      );

      continue;
    }

    if (block.type === "child_database") {
      await readNotionDatabase(
        block.id,
        String(block.child_database?.title || "Notion database"),
        visitedPages,
        pages,
        depth + 1
      );

      continue;
    }

    if (block.has_children) {
      const nested = await readNotionNestedBlocks(
        block.id,
        visitedPages,
        pages,
        depth + 1
      );

      textParts.push(...nested);
    }
  }

  return textParts;
}

async function readNotionPageRecursive(
  pageId: string,
  visitedPages: Set<string>,
  pages: KnowledgeSource[],
  depth: number
) {
  if (depth > MAX_NOTION_DEPTH || visitedPages.has(pageId)) {
    return;
  }

  visitedPages.add(pageId);

  const title = await getNotionPageTitle(pageId);

  const textParts = await readNotionNestedBlocks(
    pageId,
    visitedPages,
    pages,
    depth
  );

  pages.push({
    id: `notion:${pageId}`,
    sourceType: "notion",
    priority: 1,
    title,
    url: `https://www.notion.so/${pageId.replace(/-/g, "")}`,
    text: normalizeSpace(textParts.join("\n")),
  });
}

export async function loadNotionKnowledge() {
  const { rootPageId } = notionEnv();
  const pages: KnowledgeSource[] = [];

  await readNotionPageRecursive(
    rootPageId,
    new Set<string>(),
    pages,
    0
  );

  return pages;
}

export function loadTermsKnowledge(): KnowledgeSource[] {
  return SPORTBET_TERMS_SOURCES.map((source) => ({
    ...source,
    text: normalizeSpace(source.text),
  }));
}

export async function loadCombinedKnowledge() {
  const startedAt = Date.now();

  let notion: KnowledgeSource[] = [];
  let notionError: string | null = null;
  let notionFromCache = false;

  try {
    const cached = getCachedNotionKnowledge();

    if (cached) {
      notion = cached.notion;
      notionFromCache = true;
    } else {
      notion = await loadNotionKnowledge();
      setCachedNotionKnowledge(notion);
    }
  } catch (error) {
    notionError =
      error instanceof Error
        ? error.message
        : String(error);
  }

  const terms = loadTermsKnowledge();

  const sources = [...notion, ...terms].filter(
    (source) => source.text.trim().length > 0
  );

  return {
    sources,
    counts: {
      total: sources.length,
      notion: notion.filter((item) => item.text.trim().length > 0).length,
      terms: terms.filter((item) => item.text.trim().length > 0).length,
    },
    cache: {
      notionFromCache,
    },
    errors: {
      notion: notionError,
    },
    elapsedMs: Date.now() - startedAt,
  };
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      normalizeForSearch(value)
        .split(/\s+/)
        .filter((word) => word.length >= 3)
    )
  ).slice(0, 220);
}

function scoreSource(
  source: KnowledgeSource,
  queryTerms: string[],
  expandedQuery: string
) {
  const title = normalizeForSearch(source.title);
  const text = normalizeForSearch(source.text);
  const query = normalizeForSearch(expandedQuery);

  let score = 0;

  for (const term of queryTerms) {
    if (title.includes(term)) {
      score += 16;
    }

    if (text.includes(term)) {
      const occurrences = text.split(term).length - 1;
      score += Math.min(occurrences, 10) * 2;
    }
  }

  // Strong phrase boosts for section names and important compound concepts.
  const importantPhrases = [
    "risk-free bets",
    "risk-free bet",
    "regular bonus",
    "availability by vip rank",
    "vip rank",
    "match winner",
    "first half",
    "wagering requirement",
  ];

  for (const phrase of importantPhrases) {
    if (query.includes(phrase) && text.includes(phrase)) {
      score += 35;
    }

    if (query.includes(phrase) && title.includes(phrase)) {
      score += 55;
    }
  }

  return score;
}

function extractRelevantSnippet(
  source: KnowledgeSource,
  queryTerms: string[],
  maxChars: number
) {
  if (source.text.length <= maxChars) {
    return source.text;
  }

  const paragraphs = source.text
    .split(/\n{2,}|\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  const scored = paragraphs
    .map((paragraph, index) => {
      const normalized = normalizeForSearch(paragraph);
      let score = 0;

      for (const term of queryTerms) {
        if (normalized.includes(term)) {
          score += paragraph.startsWith("[[SECTION]]") ? 12 : 4;
        }
      }

      // Exact high-value section matches get a strong retrieval boost.
      if (
        normalized.includes("risk-free bets") ||
        normalized.includes("risk-free bet") ||
        normalized.includes("availability by vip rank") ||
        normalized.includes("regular bonus")
      ) {
        score += 20;
      }

      return {
        paragraph,
        index,
        score,
        isSection: paragraph.startsWith("[[SECTION]]"),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return source.text.slice(0, maxChars);
  }

  const pickedIndexes = new Set<number>();

  for (const item of scored.slice(0, 10)) {
    if (item.isSection) {
      // A Notion toggle/heading can contain an entire rules section.
      // Include a larger forward window so nested bullets + tables survive.
      const from = Math.max(0, item.index - 2);
      let to = Math.min(paragraphs.length - 1, item.index + 24);

      // Stop at the next sibling section after we have enough context.
      for (let i = item.index + 1; i <= to; i += 1) {
        if (
          i > item.index + 4 &&
          paragraphs[i]?.startsWith("[[SECTION]]")
        ) {
          to = i - 1;
          break;
        }
      }

      for (let i = from; i <= to; i += 1) {
        pickedIndexes.add(i);
      }
    } else {
      // For ordinary matching text/table rows, include a useful context window.
      const from = Math.max(0, item.index - 5);
      const to = Math.min(paragraphs.length - 1, item.index + 8);

      for (let i = from; i <= to; i += 1) {
        pickedIndexes.add(i);
      }
    }
  }

  const ordered = [...pickedIndexes].sort((a, b) => a - b);

  let result = "";

  for (const index of ordered) {
    const next = paragraphs[index];
    if (!next) continue;

    const cleaned = next.replace(/^\[\[SECTION\]\]\s*/, "");
    const candidate = result ? `${result}\n\n${cleaned}` : cleaned;

    if (candidate.length > maxChars) {
      break;
    }

    result = candidate;
  }

  return result || source.text.slice(0, maxChars);
}

export function buildRelevantKnowledgeContext(
  sources: KnowledgeSource[],
  queryText: string,
  options?: {
    maxSources?: number;
    maxChars?: number;
  }
) {
  const maxSources = options?.maxSources ?? 10;
  const maxChars = options?.maxChars ?? 36_000;

  const expandedQuery = expandQuery(queryText);
  const queryTerms = tokenize(expandedQuery);

  const ranked = sources
    .map((source) => ({
      source,
      score: scoreSource(source, queryTerms, expandedQuery),
    }))
    .sort((a, b) => b.score - a.score);

  /*
   * Balanced safety:
   * ensure both knowledge families can be represented when available.
   * This prevents a pure lexical accident from dropping all Terms or all Notion.
   */
  const selectedRanked: typeof ranked = [];
  const usedIds = new Set<string>();

  function add(item: (typeof ranked)[number] | undefined) {
    if (!item || usedIds.has(item.source.id)) return;

    selectedRanked.push(item);
    usedIds.add(item.source.id);
  }

  const bestTerms = ranked
    .filter((item) => item.source.sourceType === "terms")
    .slice(0, 2);

  const bestNotion = ranked
    .filter((item) => item.source.sourceType === "notion")
    .slice(0, 2);

  /*
   * Only force a source family if its best result has some lexical relevance.
   * This avoids dragging unrelated content into completely one-sided questions.
   */
  if (bestTerms[0]?.score > 0) {
    bestTerms.forEach(add);
  }

  if (bestNotion[0]?.score > 0) {
    bestNotion.forEach(add);
  }

  for (const item of ranked) {
    if (selectedRanked.length >= maxSources) break;
    add(item);
  }

  const selected: KnowledgeSource[] = [];
  let chars = 0;

  for (const item of selectedRanked) {
    if (selected.length >= maxSources) break;

    const remaining = maxChars - chars;
    if (remaining <= 0) break;

    const perSourceBudget = Math.min(
      5_000,
      Math.max(1_800, remaining)
    );

    const snippet = extractRelevantSnippet(
      item.source,
      queryTerms,
      perSourceBudget
    );

    selected.push({
      ...item.source,
      text: snippet,
    });

    chars += snippet.length;
  }

  const context = selected
    .map(
      (source, index) =>
        [
          `SOURCE ${index + 1}`,
          `TYPE: ${source.sourceType}`,
          `PRIORITY: ${source.priority}`,
          `TITLE: ${source.title}`,
          `URL: ${source.url || "-"}`,
          "CONTENT:",
          source.text,
        ].join("\n")
    )
    .join("\n\n---\n\n");

  return {
    context,
    selected,
    retrievalDebug: {
      expandedQuery,
      queryTerms,
      selected: selected.map((source) => {
        const rankedItem = selectedRanked.find(
          (item) => item.source.id === source.id
        );

        return {
          id: source.id,
          title: source.title,
          sourceType: source.sourceType,
          score: rankedItem?.score || 0,
          preview: source.text.slice(0, 1800),
        };
      }),
    },
  };
}
