import { NextResponse } from "next/server";
import { livechatPost } from "@/livechat";

type PerformanceRecord = {
  chats_count?: number;
  chats_rated_bad?: number;
  chats_rated_good?: number;
  first_response_time?: number;
};

type AgentKpiResult = {
  chats: number;
  csat: string;
  frtChats: number;
  frtEmails: number;
  art: number;
};

type HelpDeskAgent = {
  ID?: string;
  id?: string;
  accountID?: string;
  email?: string;
  name?: string;
  status?: string;
};

type HelpDeskResponseTimeRecord = {
  averageSecondsToAssignment?: number;
  averageSecondsToResponse?: number;
  count?: number;
};

const REPORT_TIMEZONE = "Europe/Kiev";

const HELPDESK_API_BASE_URL =
  process.env.HELPDESK_API_BASE_URL?.trim() || "https://api.helpdesk.com/v1";

const HELPDESK_AGENTS_ENDPOINT =
  process.env.HELPDESK_AGENTS_ENDPOINT?.trim() || "/agents";

const HELPDESK_RESPONSE_TIME_PER_AGENT_ENDPOINT =
  process.env.HELPDESK_RESPONSE_TIME_PER_AGENT_ENDPOINT?.trim() ||
  "/reports/responseTimePerAgent";

function normalize(value: unknown) {
  return String(value || "").replace(/^mailto:/i, "").trim().toLowerCase();
}

function parseAgents(value: string | null) {
  if (!value) return [];
  return value.split(",").map(normalize).filter(Boolean);
}

function dateTime(date: string, end = false) {
  return `${date}T${end ? "23:59:59" : "00:00:00"}+03:00`;
}

function archiveDateTime(date: string, end = false) {
  return `${date}T${end ? "23:59:59.999000" : "00:00:00.000000"}+03:00`;
}

function getCsat(record?: PerformanceRecord) {
  const good = Number(record?.chats_rated_good || 0);
  const bad = Number(record?.chats_rated_bad || 0);
  const total = good + bad;

  if (!total) return "0.0%";

  return `${((good / total) * 100).toFixed(1)}%`;
}

function getFrt(record?: PerformanceRecord) {
  return Math.round(Number(record?.first_response_time || 0));
}

function normalizePerformanceRecords(
  records: Record<string, PerformanceRecord> | undefined
) {
  const normalized: Record<string, PerformanceRecord> = {};

  Object.entries(records || {}).forEach(([agent, record]) => {
    normalized[normalize(agent)] = record;
  });

  return normalized;
}

async function getPerformance(from: string, to: string) {
  return livechatPost<any>(
    `/v3.5/reports/agents/performance?timezone=${encodeURIComponent(
      REPORT_TIMEZONE
    )}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: {
        from: dateTime(from),
        to: dateTime(to, true),
        agents: { exists: true },
        event_types: {
          values: [
            "file",
            "filled_form",
            "message",
            "rich_message",
            "custom",
            "system_message",
          ],
        },
      },
    }
  );
}

async function getPerformanceForCsat(from: string, to: string) {
  return livechatPost<any>(
    `/v3.5/reports/agents/performance?timezone=${encodeURIComponent(
      REPORT_TIMEZONE
    )}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: {
        from: dateTime(from),
        to: dateTime(to, true),
        agents: { exists: true },
        tags: { exclude_values: ["spam"] },
        event_types: {
          values: [
            "file",
            "filled_form",
            "message",
            "rich_message",
            "custom",
            "system_message",
          ],
        },
      },
    }
  );
}

async function getArt(from: string, to: string, agent: string) {
  const response = await livechatPost<any>(
    `/v3.6/reports/chats/response_time?timezone=${encodeURIComponent(
      REPORT_TIMEZONE
    )}`,
    {
      distribution: "day",
      timezone: REPORT_TIMEZONE,
      filters: {
        from: dateTime(from),
        to: dateTime(to, true),
        agent_response: { exists: true },
        agents: { values: [agent] },
      },
    }
  );

  const value = Number(response?.summary?.average_response_time || 0);
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function chatBelongsToAgent(chat: any, agent: string) {
  const ids = Array.isArray(chat?.thread?.user_ids)
    ? chat.thread.user_ids.map(normalize)
    : [];

  return ids.includes(normalize(agent));
}

function getHelpDeskAuth() {
  const token = process.env.HELPDESK_BASIC_TOKEN?.trim() || "";

  if (!token) return "";

  return `Basic ${token}`;
}

function buildHelpDeskUrl(endpoint: string, params?: URLSearchParams) {
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;

  const url = new URL(`${HELPDESK_API_BASE_URL}${normalizedEndpoint}`);

  if (params) {
    params.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
  }

  return url;
}

async function helpDeskGet<T>(
  endpoint: string,
  auth: string,
  params?: URLSearchParams
): Promise<T> {
  const url = buildHelpDeskUrl(endpoint, params);

  const response = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");

    throw new Error(
      `HelpDesk request failed: ${response.status} ${response.statusText}${
        responseText ? ` — ${responseText.slice(0, 500)}` : ""
      }`
    );
  }

  return (await response.json()) as T;
}

function extractHelpDeskAgents(data: unknown): HelpDeskAgent[] {
  if (Array.isArray(data)) return data as HelpDeskAgent[];

  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>;

    for (const key of ["agents", "items", "data", "results"]) {
      if (Array.isArray(object[key])) {
        return object[key] as HelpDeskAgent[];
      }
    }
  }

  return [];
}

function getHelpDeskAgentId(agent: HelpDeskAgent) {
  return String(agent.ID || agent.id || agent.accountID || "").trim();
}

async function getHelpDeskAgentIdsByEmail(auth: string) {
  const data = await helpDeskGet<unknown>(
    HELPDESK_AGENTS_ENDPOINT,
    auth
  );

  const agents = extractHelpDeskAgents(data);
  const result: Record<string, string> = {};

  agents.forEach((agent) => {
    const email = normalize(agent.email);
    const id = getHelpDeskAgentId(agent);

    if (email && id) {
      result[email] = id;
    }
  });

  return result;
}

function extractResponseTimePerAgent(
  data: unknown
): Record<string, HelpDeskResponseTimeRecord> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};

  const object = data as Record<string, unknown>;

  for (const key of ["agents", "records", "data", "results"]) {
    const nested = object[key];

    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, HelpDeskResponseTimeRecord>;
    }
  }

  return object as Record<string, HelpDeskResponseTimeRecord>;
}

async function getHelpDeskFrtByAgent(
  from: string,
  to: string,
  requestedAgents: string[]
) {
  const result: Record<string, number> = {};

  requestedAgents.forEach((agent) => {
    result[agent] = 0;
  });

  const auth = getHelpDeskAuth();

  if (!auth || requestedAgents.length === 0) {
    return result;
  }

  const agentIdsByEmail = await getHelpDeskAgentIdsByEmail(auth);
console.log(agentIdsByEmail);
  const requestedAgentIds = requestedAgents
    .map((email) => agentIdsByEmail[normalize(email)])
    .filter((id): id is string => Boolean(id));

  if (requestedAgentIds.length === 0) {
    console.warn(
      "[HelpDesk FRT] None of the requested emails matched HelpDesk agents.",
      { requestedAgents }
    );
    return result;
  }

  const params = new URLSearchParams();

  params.set("range.timezone", REPORT_TIMEZONE);
  params.set("range.step", "day");
  params.set("range.from", `${from}T00:00:00+0300`);
  params.set("range.to", `${to}T23:59:59+0300`);
  params.set("spam", "false");
console.log("Requested agents:", requestedAgents);
  requestedAgentIds.forEach((agentId) => {
    params.append("agentID[]", agentId);
  });

  const rawData = await helpDeskGet<unknown>(
    HELPDESK_RESPONSE_TIME_PER_AGENT_ENDPOINT,
    auth,
    params
  );

  const responseTimeByAgentId = extractResponseTimePerAgent(rawData);
console.log(
  "[HelpDesk FRT] Raw response:",
  JSON.stringify(rawData, null, 2)
);

console.log(
  "[HelpDesk FRT] Parsed agent IDs:",
  Object.keys(responseTimeByAgentId)
);
  requestedAgents.forEach((email) => {
    const agentId = agentIdsByEmail[normalize(email)];
    const record = agentId ? responseTimeByAgentId[agentId] : undefined;

    const assignmentSeconds = Number(
  record?.averageSecondsToAssignment || 0
);

const responseSeconds = Number(
  record?.averageSecondsToResponse || 0
);

const seconds = assignmentSeconds + responseSeconds;

    result[email] =
      Number.isFinite(seconds) && seconds > 0
        ? Number((seconds / 60).toFixed(2))
        : 0;
  });

  return result;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const agents = parseAgents(searchParams.get("agents"));

    if (!from || !to) {
      return NextResponse.json(
        { ok: false, error: "Missing from or to" },
        { status: 400 }
      );
    }

    const [performance, csatPerformance] = await Promise.all([
      getPerformance(from, to),
      getPerformanceForCsat(from, to),
    ]);

    const records = normalizePerformanceRecords(performance?.records);
    const csatRecords = normalizePerformanceRecords(csatPerformance?.records);

    const requestedAgents =
      agents.length > 0 ? agents : Object.keys(records).map(normalize);

    const [artEntries, frtEmails] = await Promise.all([
      Promise.all(
        requestedAgents.map(
          async (agent) => [agent, await getArt(from, to, agent)] as const
        )
      ),
      getHelpDeskFrtByAgent(from, to, requestedAgents),
    ]);

    const art = Object.fromEntries(artEntries);
    const result: Record<string, AgentKpiResult> = {};

    requestedAgents.forEach((agent) => {
      const record = records[agent];
      const csatRecord = csatRecords[agent];

      result[agent] = {
        chats: Number(record?.chats_count || 0),
        csat: getCsat(csatRecord),
        frtChats: getFrt(record),
        frtEmails: frtEmails[agent] || 0,
        art: art[agent] || 0,
      };
    });

    return NextResponse.json({
      ok: true,
      from,
      to,
      agents: result,
      rules: {
        chats: "includes spam",
        frtChats: "includes spam",
        frtEmails:
          "HelpDesk averageSecondsToResponse only; excludes assignment time; spam=false",
        art: "includes spam",
        csat: "excludes spam",
      },
    });
  } catch (error) {
    console.error("[agent-kpi] Failed to build KPI report", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}