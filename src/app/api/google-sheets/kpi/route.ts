import { createSign } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SPREADSHEET_ID = "1q5SZL7f7TSeLkIgJBgbxTvxtmFUm0y5DT08-SMkQTeY";
const DEFAULT_SHEET_NAME = "Month total";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type RequestBody = {
  month?: string;
  agents?: string[];
};

type SheetAgentKpi = {
  quality: number | null;
  escalation: number | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeHeader(value: unknown) {
  return normalizeText(value)
    .replace(/[–—]/g, "-")
    .replace(/\s*\/\s*/g, " / ");
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(clientEmail: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));

  const payload = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const unsignedToken = `${header}.${payload}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  const signature = base64Url(signer.sign(privateKey));
  const assertion = `${unsignedToken}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  const json = await response.json();

  if (!response.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || "Google authentication failed"
    );
  }

  return String(json.access_token);
}

function getColumnIndex(headers: unknown[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);

  return headers.findIndex((header) =>
    normalizedAliases.includes(normalizeHeader(header))
  );
}

function parseMonthYear(
  value: unknown
): { year: number | null; month: number } | null {
  const text = normalizeText(value).replace(/\.$/, "");

  if (!text) return null;

  const monthAliases: Record<string, number> = {
    "січ": 1,
    "січень": 1,
    "лют": 2,
    "лютий": 2,
    "бер": 3,
    "березень": 3,
    "квіт": 4,
    "квітень": 4,
    "трав": 5,
    "травень": 5,
    "черв": 6,
    "червень": 6,
    "лип": 7,
    "липень": 7,
    "серп": 8,
    "серпень": 8,
    "вер": 9,
    "вересень": 9,
    "жовт": 10,
    "жовтень": 10,
    "лист": 11,
    "листопад": 11,
    "груд": 12,
    "грудень": 12,
  };

  if (monthAliases[text]) {
    return { year: null, month: monthAliases[text] };
  }

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);

  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]) };
  }

  const dayFirst = text.match(/^\d{1,2}[-/.](\d{1,2})[-/.](\d{4})$/);

  if (dayFirst) {
    return { year: Number(dayFirst[2]), month: Number(dayFirst[1]) };
  }

  const monthYear = text.match(/^(\d{1,2})[-/.](\d{4})$/);

  if (monthYear) {
    return { year: Number(monthYear[2]), month: Number(monthYear[1]) };
  }

  const parsed = new Date(text);

  if (!Number.isNaN(parsed.getTime())) {
    return {
      year: parsed.getFullYear(),
      month: parsed.getMonth() + 1,
    };
  }

  return null;
}

function parseNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim();

  if (!raw) return null;

  const normalized = raw
    .replace(/\s/g, "")
    .replace(/%/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.+-]/g, "");

  if (!normalized) return null;

  const number = Number(normalized);

  return Number.isFinite(number) ? number : null;
}

/**
 * Converts the Escalation / Follow up labels from the KPI sheet
 * into a numeric minute value that the KPI & Salary page already
 * knows how to score.
 *
 * Final scoring:
 * <=10  -> 10 pts
 * 11-15 -> 8 pts
 * 16-30 -> 5 pts
 * 31-45 -> 2 pts
 * 46-60 -> 0 pts
 * 61-120 -> -2 pts
 * >120 -> -5 pts
 */
function parseEscalationMinutes(value: unknown): number | null {
  const raw = normalizeText(value)
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return null;

  // Common labels used in the Google Sheet.
  if (/^<\s*10\s*(?:m|min|mins|minute|minutes)?$/i.test(raw)) return 10;

  if (/^(?:10|11)\s*-\s*15\s*(?:m|min|mins|minute|minutes)?$/i.test(raw)) {
    return 15;
  }

  if (/^(?:15|16)\s*-\s*30\s*(?:m|min|mins|minute|minutes)?$/i.test(raw)) {
    return 30;
  }

  if (/^31\s*-\s*45\s*(?:m|min|mins|minute|minutes)?$/i.test(raw)) {
    return 45;
  }

  if (/^(?:46\s*-\s*60|>\s*46)\s*(?:m|min|mins|minute|minutes)?$/i.test(raw)) {
    return 60;
  }

  if (
    /^>\s*1\s*(?:h|hr|hrs|hour|hours)$/i.test(raw) ||
    /^1\s*-\s*2\s*(?:h|hr|hrs|hour|hours)$/i.test(raw)
  ) {
    return 120;
  }

  if (/^>\s*2\s*(?:h|hr|hrs|hour|hours)$/i.test(raw)) {
    return 121;
  }

  // Generic "< N min" support.
  const lessThanMinutes = raw.match(
    /^<\s*(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minute|minutes)?$/i
  );

  if (lessThanMinutes) {
    return Number(lessThanMinutes[1].replace(",", "."));
  }

  // Generic "A-B min" support. We use the upper bound because the
  // existing score function is threshold-based.
  const minuteRange = raw.match(
    /^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minute|minutes)?$/i
  );

  if (minuteRange) {
    return Number(minuteRange[2].replace(",", "."));
  }

  // Generic hours support.
  const hours = raw.match(
    /^(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours)$/i
  );

  if (hours) {
    return Number(hours[1].replace(",", ".")) * 60;
  }

  const greaterHours = raw.match(
    /^>\s*(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours)$/i
  );

  if (greaterHours) {
    const minutes = Number(greaterHours[1].replace(",", ".")) * 60;
    return minutes > 120 ? minutes : minutes + 1;
  }

  // Plain numeric values remain supported.
  return parseNumber(value);
}

async function readSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
) {
  const range = `'${sheetName.replace(/'/g, "''")}'!A:Z`;

  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}`
  );

  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error?.message || "Failed to read Google Sheet");
  }

  return Array.isArray(json.values) ? (json.values as unknown[][]) : [];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    const monthKey = String(body.month ?? "");

    const agents = Array.isArray(body.agents)
      ? body.agents.map((agent) => String(agent)).filter(Boolean)
      : [];

    const match = monthKey.match(/^(\d{4})-(\d{2})$/);

    if (!match) {
      return NextResponse.json(
        { ok: false, error: "Invalid month format" },
        { status: 400 }
      );
    }

    const requestedYear = Number(match[1]);
    const requestedMonth = Number(match[2]);

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();

    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n"
    );

    const spreadsheetId =
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
      DEFAULT_SPREADSHEET_ID;

    const sheetName =
      process.env.GOOGLE_SHEETS_SHEET_NAME?.trim() || DEFAULT_SHEET_NAME;

    if (!clientEmail || !privateKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Google Sheets credentials are not configured",
        },
        { status: 500 }
      );
    }

    const accessToken = await getAccessToken(clientEmail, privateKey);

    const values = await readSheetValues(
      accessToken,
      spreadsheetId,
      sheetName
    );

    if (values.length === 0) {
      return NextResponse.json({ ok: true, agents: {} });
    }

    const headers = values[0];

    const nameIndex = getColumnIndex(headers, [
      "Name",
      "Agent",
      "Agent name",
    ]);

    const monthIndex = getColumnIndex(headers, ["Month", "Date"]);

    const qualityIndex = getColumnIndex(headers, ["IQS"]);

    const escalationIndex = getColumnIndex(headers, [
      "Escalation / Follow up",
      "Escalation/Follow up",
      "Escalation",
    ]);

    const missing: string[] = [];

    if (nameIndex < 0) missing.push("Name");
    if (monthIndex < 0) missing.push("Month");
    if (qualityIndex < 0) missing.push("IQS");
    if (escalationIndex < 0) missing.push("Escalation / Follow up");

    if (missing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Missing columns in Google Sheet: ${missing.join(", ")}`,
        },
        { status: 422 }
      );
    }

    const requestedAgents = new Map(
      agents.map((name) => [normalizeText(name), name])
    );

    const result: Record<string, SheetAgentKpi> = {};

    agents.forEach((name) => {
      result[name] = {
        quality: null,
        escalation: null,
      };
    });

    for (const row of values.slice(1)) {
      const normalizedName = normalizeText(row[nameIndex]);
      const canonicalName = requestedAgents.get(normalizedName);

      if (!canonicalName) continue;

      const rowMonth = parseMonthYear(row[monthIndex]);

      if (
        !rowMonth ||
        rowMonth.month !== requestedMonth ||
        (rowMonth.year !== null && rowMonth.year !== requestedYear)
      ) {
        continue;
      }

      result[canonicalName] = {
        quality: parseNumber(row[qualityIndex]),
        escalation: parseEscalationMinutes(row[escalationIndex]),
      };
    }

    return NextResponse.json({
      ok: true,
      agents: result,
    });
  } catch (error) {
    console.error("Google Sheets KPI error", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Google Sheets KPI error",
      },
      { status: 500 }
    );
  }
}