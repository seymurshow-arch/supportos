import { NextResponse } from "next/server";
import { livechatPost } from "@/livechat";
import { getLiveChatProjects } from "@/services/livechatProjectsService";

type ProjectFilter = {
  name: string;
  groupIds: number[];
} | null;

type TagRow = {
  tag: string;
  label: string;
  total: number;
  vip: number;
  regular: number;
  previousTotal: number;
  changePercent: number | null;
  changeLabel: string;
  triggers: string[];
};

const REPORT_TIMEZONE = "Europe/Kiev";

const EXCLUDED_TAGS = new Set(
  [
    "chatbot",
    "chatbot-transfer",
    "vip player",
    "vip transfer",
    "test-chat",
    "empty chat",
    "just talk",
    "spam",
    "system",
    "bot",
    "chat-summary",
    "sentiment-positive",
    "sentiment-neutral",
    "sentiment-negative",
  ].map((tag) => tag.toLowerCase())
);

function getDateString(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISODate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function normalizeProject(value: string | null) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDateRange(fromParam: string | null, toParam: string | null) {
  const now = new Date();
  const fallbackTo = getDateString(now);
  const fallbackFrom = new Date(now);
  fallbackFrom.setDate(now.getDate() - 6);

  return {
    from: fromParam || getDateString(fallbackFrom),
    to: toParam || fallbackTo,
  };
}

function getPreviousRange(from: string, to: string, mode: string | null) {
  const fromDate = parseISODate(from);
  const toDate = parseISODate(to);

  if (mode === "monthly") {
    const previousMonthStart = new Date(
      fromDate.getFullYear(),
      fromDate.getMonth() - 1,
      1
    );

    const previousMonthEnd = new Date(
      fromDate.getFullYear(),
      fromDate.getMonth(),
      0
    );

    return {
      from: getDateString(previousMonthStart),
      to: getDateString(previousMonthEnd),
    };
  }

  const diffMs = toDate.getTime() - fromDate.getTime();
  const periodDays = Math.floor(diffMs / 86400000) + 1;

  const previousTo = new Date(fromDate);
  previousTo.setDate(previousTo.getDate() - 1);

  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - (periodDays - 1));

  return {
    from: getDateString(previousFrom),
    to: getDateString(previousTo),
  };
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

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";

  const tzPart = get("timeZoneName");
  const match = tzPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);

  const offset = match
    ? `${match[1]}${match[2].padStart(2, "0")}:${match[3] || "00"}`
    : "+02:00";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
    offset,
  };
}

function getOffsetForDate(date: string) {
  const testDate = new Date(`${date}T12:00:00.000Z`);
  return getPartsForInstant(testDate).offset;
}

function getTodayInReportTimezone() {
  return getPartsForInstant(new Date()).date;
}

function shouldUseNow(date: string) {
  return date >= getTodayInReportTimezone();
}

function toReportFrom(date: string) {
  return `${date}T00:00:00${getOffsetForDate(date)}`;
}

function toReportTo(date: string) {
  if (shouldUseNow(date)) {
    const now = getPartsForInstant(new Date());
    return `${now.date}T${now.time}${now.offset}`;
  }

  return `${date}T23:59:59${getOffsetForDate(date)}`;
}

function toArchiveFrom(date: string) {
  return `${date}T00:00:00.000000${getOffsetForDate(date)}`;
}

function toArchiveTo(date: string) {
  if (shouldUseNow(date)) {
    const now = getPartsForInstant(new Date());
    return `${now.date}T${now.time}.999000${now.offset}`;
  }

  return `${date}T23:59:59.999000${getOffsetForDate(date)}`;
}

function cleanLabel(value: string) {
  return value.replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

function normalizeTagLabel(tag: string) {
  const clean = tag.trim();

  const map: Record<string, string> = {
    "No-dep bonus req": "No-deposit bonus requests",
    "Q-withdrawal": "Withdrawal questions",
    "P-withdrawal": "Withdrawal issues",
    "Q-deposit": "Deposit questions",
    "P-deposit": "Deposit issues",
    "Q-bonus terms": "Bonus terms questions",
    "P-bonus terms": "Bonus terms issues",
    "Q-KYC": "KYC questions",
    "P-KYC": "KYC issues",
    "P-slots": "Slots issues",
    "Q-slots": "Slots questions",
    "P-Sport": "Sport issues",
    "Q-Sport": "Sport questions",
    "P-Sport bet": "Sport bet issues",
    "Q-Sport bet": "Sport bet questions",
    "Refund request": "Refund requests",
    "Acc reopening": "Account reopening",
    "Closing acc- PG": "Closing acc PG",
    "Closing acc- other": "Account closing - other",
    "Closing acc-other": "Account closing - other",
    "Closing acc- bonus": "Account closing - bonus",
    "Closing acc- losses": "Account closing - losses",
    "Closing acc- not interested": "Account closing - not interested",
    Cashback: "Cashback",
    Cooperation: "Cooperation",
  };

  if (map[clean]) return map[clean];

  if (clean.startsWith("Q-")) {
    return `${cleanLabel(clean.slice(2))} questions`;
  }

  if (clean.startsWith("P-")) {
    return `${cleanLabel(clean.slice(2))} issues`;
  }

  return cleanLabel(clean);
}

function getCurrentChatTags(chat: any): string[] {
  const tags = new Set<string>();

  const directTags = Array.isArray(chat?.tags) ? chat.tags : [];
  const threadTags = Array.isArray(chat?.thread?.tags)
    ? chat.thread.tags
    : [];

  [...directTags, ...threadTags].forEach((tag) => {
    if (typeof tag === "string" && tag.trim()) {
      tags.add(tag.trim());
    }
  });

  return Array.from(tags);
}

function getChatGroupIds(chat: any): number[] {
  const values = [
    chat?.group_id,
    chat?.thread?.group_id,
    ...(Array.isArray(chat?.group_ids) ? chat.group_ids : []),
    ...(Array.isArray(chat?.thread?.group_ids) ? chat.thread.group_ids : []),
    ...(Array.isArray(chat?.access?.group_ids) ? chat.access.group_ids : []),
    ...(Array.isArray(chat?.thread?.access?.group_ids)
      ? chat.thread.access.group_ids
      : []),
  ];

  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    )
  );
}

function chatBelongsToProject(chat: any, project: ProjectFilter) {
  if (!project) return true;

  const chatGroupIds = getChatGroupIds(chat);

  /*
   * The LiveChat archive request already receives the selected group filter.
   * When the returned record also contains group information, verify it again
   * locally to prevent records from another project entering Top Tags.
   */
  if (chatGroupIds.length === 0) return true;

  const allowedGroupIds = new Set(project.groupIds);
  return chatGroupIds.some((groupId) => allowedGroupIds.has(groupId));
}

function buildReportFilters(from: string, to: string, project: ProjectFilter) {
  return {
    from: toReportFrom(from),
    to: toReportTo(to),
    properties: {
      routing: {
        offline_message: {
          exists: false,
        },
      },
    },
    ...(project
      ? {
          groups: {
            values: project.groupIds,
          },
        }
      : {}),
  };
}

async function getTagsReport(from: string, to: string, project: ProjectFilter) {
  const data = await livechatPost<any>(
    `/v3.6/reports/chats/tags?timezone=${encodeURIComponent(REPORT_TIMEZONE)}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: buildReportFilters(from, to, project),
    }
  );

  const totals = new Map<string, number>();

  Object.values(data?.records || {}).forEach((record: any) => {
    Object.entries(record || {}).forEach(([tag, count]) => {
      if (!tag || tag === ":total:") return;
      if (EXCLUDED_TAGS.has(tag.toLowerCase())) return;

      totals.set(tag, (totals.get(tag) || 0) + Number(count || 0));
    });
  });

  return { totals };
}

async function getArchives(from: string, to: string, project: ProjectFilter) {
  const allChats: any[] = [];
  const seenPageIds = new Set<string>();
  let pageId: string | undefined;

  for (let page = 0; page < 300; page++) {
    const body: any = pageId
      ? { page_id: pageId }
      : {
          limit: 100,
          sort_order: "desc",
          filters: {
            from: toArchiveFrom(from),
            to: toArchiveTo(to),
            ...(project
              ? {
                  groups: {
                    values: project.groupIds,
                  },
                }
              : {}),
          },
        };

    const response = await livechatPost<any>(
      "/v3.5/agent/action/list_archives",
      body
    );

    const chats = Array.isArray(response?.chats) ? response.chats : [];
    allChats.push(...chats);

    const nextPageId = response?.next_page_id;

    if (!nextPageId) break;
    if (seenPageIds.has(nextPageId)) break;

    seenPageIds.add(nextPageId);
    pageId = nextPageId;

    if (chats.length === 0) break;
  }

  return allChats;
}

async function getTagBreakdown(
  from: string,
  to: string,
  project: ProjectFilter
) {
  const chats = await getArchives(from, to, project);

  const totalByTag = new Map<string, number>();
  const vipByTag = new Map<string, number>();
  const regularByTag = new Map<string, number>();

  let projectChatsLoaded = 0;
  let vipChatsLoaded = 0;
  let regularChatsLoaded = 0;

  chats.forEach((chat) => {
    if (!chatBelongsToProject(chat, project)) return;

    projectChatsLoaded += 1;

    const tags = getCurrentChatTags(chat);
    const isVip = tags.some(
      (tag) => tag.trim().toLowerCase() === "vip player"
    );

    if (isVip) {
      vipChatsLoaded += 1;
    } else {
      regularChatsLoaded += 1;
    }

    const reportTags = tags.filter(
      (tag) => tag && !EXCLUDED_TAGS.has(tag.toLowerCase())
    );

    /*
     * One chat contributes exactly +1 to Total for every report tag it has.
     * The same chat contributes either +1 to VIP or +1 to Regular for that
     * tag, never to both.
     */
    reportTags.forEach((tag) => {
      totalByTag.set(tag, (totalByTag.get(tag) || 0) + 1);

      if (isVip) {
        vipByTag.set(tag, (vipByTag.get(tag) || 0) + 1);
      } else {
        regularByTag.set(tag, (regularByTag.get(tag) || 0) + 1);
      }
    });
  });

  return {
    archivesLoaded: chats.length,
    projectChatsLoaded,
    vipChatsLoaded,
    regularChatsLoaded,
    totalByTag,
    vipByTag,
    regularByTag,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const modeParam = searchParams.get("mode");
    const isListMode = modeParam === "list";
    const isExportMode = modeParam === "export";
    const comparisonMode = isListMode || isExportMode ? null : modeParam;
    const projectParam = normalizeProject(searchParams.get("project"));

    const { from, to } = normalizeDateRange(
      searchParams.get("from"),
      searchParams.get("to")
    );

    const projects = await getLiveChatProjects();

    const project =
      projectParam.length > 0
        ? projects.find((item) => item.name.toLowerCase() === projectParam) || null
        : null;

    if (isExportMode) {
      const currentBreakdown = await getTagBreakdown(from, to, project);

      const rows: TagRow[] = Array.from(currentBreakdown.totalByTag.entries())
        .map(([tag, total]) => {
          const vip = currentBreakdown.vipByTag.get(tag) || 0;
          const regular = currentBreakdown.regularByTag.get(tag) || 0;

          return {
            tag,
            label: normalizeTagLabel(tag),
            total,
            vip,
            regular,
            previousTotal: 0,
            changePercent: null,
            changeLabel: "",
            triggers: [],
          };
        })
        .sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total;
          return a.label.localeCompare(b.label);
        });

      return NextResponse.json({
        ok: true,
        mode: "export",
        project: project?.name || null,
        period: { from, to },
        archivesLoaded: currentBreakdown.archivesLoaded,
        rows,
      });
    }

    if (isListMode) {
      const currentTags = await getTagsReport(from, to, project);

      const tags = Array.from(currentTags.totals.keys())
        .filter((tag) => tag && !EXCLUDED_TAGS.has(tag.toLowerCase()))
        .map((tag) => ({
          tag,
          label: normalizeTagLabel(tag),
          total: currentTags.totals.get(tag) || 0,
        }))
        .sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total;
          return a.label.localeCompare(b.label);
        });

      return NextResponse.json({
        ok: true,
        mode: "list",
        project: project?.name || null,
        period: { from, to },
        source: "LiveChat tags report",
        rules: {
          excludedTags: Array.from(EXCLUDED_TAGS),
        },
        tags,
      });
    }

    const previousRange = getPreviousRange(from, to, comparisonMode);

    const [currentBreakdown, previousBreakdown] = await Promise.all([
      getTagBreakdown(from, to, project),
      getTagBreakdown(previousRange.from, previousRange.to, project),
    ]);

    const rows: TagRow[] = Array.from(currentBreakdown.totalByTag.entries())
      .map(([tag, total]) => {
        const previousTotal = previousBreakdown.totalByTag.get(tag) || 0;

        let changePercent: number | null = null;
        let changeLabel = "New";

        if (previousTotal > 0) {
          changePercent = Math.round(
            ((total - previousTotal) / previousTotal) * 100
          );
          changeLabel = `${changePercent > 0 ? "+" : ""}${changePercent}%`;
        }

        const vip = currentBreakdown.vipByTag.get(tag) || 0;
        const regular = currentBreakdown.regularByTag.get(tag) || 0;

        return {
          tag,
          label: normalizeTagLabel(tag),
          total,
          vip,
          regular,
          previousTotal,
          changePercent,
          changeLabel,
          triggers: [],
        };
      })
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return a.label.localeCompare(b.label);
      });

    return NextResponse.json({
      ok: true,
      project: project?.name || null,
      period: { from, to },
      previousPeriod: previousRange,
      archivesLoaded: currentBreakdown.archivesLoaded,
      projectChatsLoaded: currentBreakdown.projectChatsLoaded,
      vipChatsLoaded: currentBreakdown.vipChatsLoaded,
      regularChatsLoaded: currentBreakdown.regularChatsLoaded,
      previousProjectChatsLoaded: previousBreakdown.projectChatsLoaded,
      source: "LiveChat archives — one-pass Top Tags calculation",
      rules: {
        total: "for each tag: +1 for every selected chat containing that tag",
        vip: "for each tag: +1 when the same chat also contains VIP player",
        regular:
          "for each tag: +1 when the same chat does not contain VIP player",
        invariant: "for every row: total = vip + regular",
        excludedTags: Array.from(EXCLUDED_TAGS),
      },
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}