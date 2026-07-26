import { NextResponse } from "next/server";

const LIVECHAT_REGION = process.env.LIVECHAT_REGION || "us-south1";
const REPORT_TIMEZONE = "Europe/Kiev";

function toReportFrom(date: string) {
  return `${date}T00:00:00+03:00`;
}

function toReportTo(date: string) {
  return `${date}T23:59:59+03:00`;
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getLiveChatUiToken() {
  const value = process.env.LIVECHAT_UI_TOKEN?.trim() || "";

  return value.replace(/^Bearer\s+/i, "").trim();
}

async function livechatActivityPost(
  body: Record<string, unknown>,
  livechatUiToken: string
) {
  const response = await fetch(
    "https://api.livechatinc.com/v3.7/reports/agents/activity",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${livechatUiToken}`,
        "Content-Type": "application/json",
        Origin: "https://my.livechatinc.com",
        Referer: "https://my.livechatinc.com/",
        "x-region": LIVECHAT_REGION,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`LiveChat activity error ${response.status}: ${text}`);
  }

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("LiveChat activity returned invalid JSON");
  }
}

export async function POST(request: Request) {
  try {
    const livechatUiToken = getLiveChatUiToken();

    if (!livechatUiToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing LIVECHAT_UI_TOKEN in .env.local",
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const dates: string[] = Array.isArray(body?.dates)
      ? body.dates
          .map((date: unknown) => String(date || "").trim())
          .filter(Boolean)
      : [];

    if (!dates.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing dates",
        },
        { status: 400 }
      );
    }

    const invalidDates = dates.filter((date) => !isValidDate(date));

    if (invalidDates.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid date format: ${invalidDates.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const uniqueDates = [...new Set(dates)].sort();
    const results = [];

    for (const date of uniqueDates) {
      const response = await livechatActivityPost(
        {
          distribution: "day",
          timezone: REPORT_TIMEZONE,
          filters: {
            from: toReportFrom(date),
            to: toReportTo(date),
          },
        },
        livechatUiToken
      );

      results.push({
        date,
        activity: response?.agent_activity || {},
      });
    }

    return NextResponse.json({
      ok: true,
      dates: uniqueDates,
      results,
      debugSample: results[0] || null,
    });
  } catch (error) {
    console.error("[api/livechat/breaks]", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}