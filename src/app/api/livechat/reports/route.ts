import { NextResponse } from "next/server";
import { livechatPost } from "@/livechat";
import { getLiveChatProjects } from "@/services/livechatProjectsService";

const REPORT_TIMEZONE = "Europe/Kiev";
const EXCLUDED_CSAT_TAGS = ["spam"];

type ProjectFilter = {
  name: string;
  groupIds: number[];
} | null;

function getNumber(...values: unknown[]) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  return 0;
}

function normalizeProject(value: string | null) {
  return String(value || "").trim().toLowerCase();
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

function getNowForReport() {
  const now = getPartsForInstant(new Date());
  return `${now.date}T${now.time}${now.offset}`;
}

function shouldUseNow(date: string) {
  return date >= getTodayInReportTimezone();
}

function toReportFrom(date: string) {
  return `${date}T00:00:00${getOffsetForDate(date)}`;
}

function toReportTo(date: string) {
  if (shouldUseNow(date)) return getNowForReport();
  return `${date}T23:59:59${getOffsetForDate(date)}`;
}

function buildBaseFilters(from: string, to: string, project: ProjectFilter) {
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

function buildCsatFilters(from: string, to: string, project: ProjectFilter) {
  return {
    ...buildBaseFilters(from, to, project),
    tags: {
      exclude_values: EXCLUDED_CSAT_TAGS,
    },
  };
}

async function getTotalChats(from: string, to: string, project: ProjectFilter) {
  const data = await livechatPost<any>(
    `/v3.6/reports/chats/total_chats?timezone=${encodeURIComponent(
      REPORT_TIMEZONE
    )}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: buildBaseFilters(from, to, project),
    }
  );

  return getNumber(data?.total, data?.summary?.total_chats);
}

async function getMissedChats(from: string, to: string, project: ProjectFilter) {
  const data = await livechatPost<any>(
    `/v3.6/reports/chats/total_chats?timezone=${encodeURIComponent(
      REPORT_TIMEZONE
    )}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: {
        from: toReportFrom(from),
        to: toReportTo(to),
        properties: {
          routing: {
            unreplied: {
              values: [true],
            },
          },
        },
        agents: {
          exists: true,
        },
        event_types: {
          values: ["message"],
        },
        ...(project
          ? {
              groups: {
                values: project.groupIds,
              },
            }
          : {}),
      },
    }
  );

  return getNumber(data?.total);
}

async function getResponseTime(
  from: string,
  to: string,
  project: ProjectFilter
) {
  const data = await livechatPost<any>(
    `/v3.6/reports/chats/first_response_time?timezone=${encodeURIComponent(
      REPORT_TIMEZONE
    )}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: {
        from: toReportFrom(from),
        to: toReportTo(to),
        ...(project
          ? {
              groups: {
                values: project.groupIds,
              },
            }
          : {}),
      },
    }
  );

  return getNumber(
    data?.summary?.first_response_time,
    data?.summary?.average_first_response_time
  );
}

async function getChatDuration(
  from: string,
  to: string,
  project: ProjectFilter
) {
  const data = await livechatPost<any>(
    `/v3.6/reports/chats/duration?timezone=${encodeURIComponent(
      REPORT_TIMEZONE
    )}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: buildBaseFilters(from, to, project),
    }
  );

  const records = data?.records || {};

  let totalDurationSec = 0;
  let totalCount = 0;

  Object.values(records).forEach((record: any) => {
    const count = getNumber(record?.count);
    const sumDuration = getNumber(record?.sum_duration);
    const avgDuration = getNumber(record?.duration);

    if (count <= 0) return;

    totalCount += count;

    if (sumDuration > 0) {
      totalDurationSec += sumDuration;
    } else if (avgDuration > 0) {
      totalDurationSec += avgDuration * count;
    }
  });

  return {
    avgChatDurationSec:
      totalCount > 0 ? Math.round(totalDurationSec / totalCount) : 0,
    totalDurationSec,
    totalCount,
  };
}

async function getChatSatisfaction(
  from: string,
  to: string,
  project: ProjectFilter
) {
  const data = await livechatPost<any>(
    `/v3.6/reports/chats/ratings?timezone=${encodeURIComponent(
      REPORT_TIMEZONE
    )}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: buildCsatFilters(from, to, project),
    }
  );

  const good = getNumber(data?.summary?.good, data?.summary?.chats_rated_good);
  const bad = getNumber(data?.summary?.bad, data?.summary?.chats_rated_bad);

  const total = good + bad;

  return {
    good,
    bad,
    csatPercent: total > 0 ? Number(((good / total) * 100).toFixed(1)) : 0,
  };
}

async function getProjectStats(from: string, to: string, project: ProjectFilter) {
  if (!project) return null;

  const [chats, missed, duration, rating, responseTime] = await Promise.all([
    getTotalChats(from, to, project),
    getMissedChats(from, to, project),
    getChatDuration(from, to, project),
    getChatSatisfaction(from, to, project),
    getResponseTime(from, to, project),
  ]);

  return {
    name: project.name,
    project: project.name,
    groupIds: project.groupIds,
    chats,
    missed,
    positive: rating.good,
    negative: rating.bad,
    csat: rating.csatPercent,
    frt: responseTime,
    avgChatDurationSec: duration.avgChatDurationSec,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const projectParam = normalizeProject(searchParams.get("project"));

    if (!from || !to) {
      return NextResponse.json(
        { ok: false, error: "Missing from or to" },
        { status: 400 }
      );
    }

    const allProjects = await getLiveChatProjects();

    const projectFilter =
      projectParam.length > 0
        ? allProjects.find(
            (project) => project.name.toLowerCase() === projectParam
          ) || null
        : null;

    const [
      totalChats,
      missedChats,
      durationResult,
      ratingResult,
      responseTime,
    ] = await Promise.all([
      getTotalChats(from, to, projectFilter),
      getMissedChats(from, to, projectFilter),
      getChatDuration(from, to, projectFilter),
      getChatSatisfaction(from, to, projectFilter),
      getResponseTime(from, to, projectFilter),
    ]);

    const projects = projectFilter
      ? [await getProjectStats(from, to, projectFilter)]
      : await Promise.all(
          allProjects.map((project) => getProjectStats(from, to, project))
        );

    return NextResponse.json({
      ok: true,
      period: {
        from,
        to,
      },
      project: projectFilter?.name || null,
      summary: {
        totalChats,
        totalChatsFromDuration: totalChats,
        totalChatsFromArchives: totalChats,
        missedChats,
        avgFrt: responseTime,
        avgFrtSec: responseTime,
        avgChatDurationSec: durationResult.avgChatDurationSec,
        totalChatTimeSec: totalChats * durationResult.avgChatDurationSec,
        csatPercent: ratingResult.csatPercent,
        positive: ratingResult.good,
        negative: ratingResult.bad,
      },
      projects: projects.filter(Boolean),
      topTags: [],
      agents: {},
      debug: {
        source: "LiveChat Reports API",
        projectsSource: "LiveChat groups autodetect",
        projectsLoaded: allProjects.length,
        csatExcludedTags: EXCLUDED_CSAT_TAGS,
        requestFrom: toReportFrom(from),
        requestTo: toReportTo(to),
        timezone: REPORT_TIMEZONE,
      },
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