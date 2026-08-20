import { createSign } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type SheetMeta = {
  properties?: {
    title?: string;
    sheetId?: number;
  };
};

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

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedToken}.${signature}`,
    }),
    cache: "no-store",
  });

  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google authentication failed");
  }

  return String(json.access_token);
}

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function monthKeyFromSheetTitle(title: string) {
  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  const match = title.trim().match(/^([A-Za-z]+)\s+(\d{2}|\d{4})$/);
  if (!match) return null;

  const month = months[match[1].toLowerCase()];
  if (!month) return null;

  let year = Number(match[2]);
  if (year < 100) year += 2000;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseHeaderDate(value: unknown, year: number) {
  const text = normalize(value);
  if (!text) return null;

  const match = text.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*,?\s*(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/i);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let parsedYear = match[3] ? Number(match[3]) : year;
  if (parsedYear < 100) parsedYear += 2000;

  if (!day || !month || month > 12 || day > 31) return null;
  return `${parsedYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function getSheets(accessToken: string, spreadsheetId: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=sheets.properties(title,sheetId)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = await response.json();

  if (!response.ok) throw new Error(json.error?.message || "Failed to read spreadsheet metadata");
  return Array.isArray(json.sheets) ? (json.sheets as SheetMeta[]) : [];
}

async function readSheet(accessToken: string, spreadsheetId: string, sheetName: string) {
  const range = `'${sheetName.replace(/'/g, "''")}'!A1:AZ200`;
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
  if (!response.ok) throw new Error(json.error?.message || "Failed to read schedule sheet");
  return Array.isArray(json.values) ? (json.values as unknown[][]) : [];
}

export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get("month")?.trim() || "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ ok: false, error: "Invalid month format" }, { status: 400 });
    }

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const spreadsheetId = process.env.GOOGLE_SCHEDULE_SPREADSHEET_ID?.trim();

    if (!clientEmail || !privateKey || !spreadsheetId) {
      return NextResponse.json(
        { ok: false, error: "Google Schedule credentials are not configured" },
        { status: 500 }
      );
    }

    const accessToken = await getAccessToken(clientEmail, privateKey);
    const sheets = await getSheets(accessToken, spreadsheetId);

    const availableMonths = sheets
      .map((sheet) => ({
        title: normalize(sheet.properties?.title),
        monthKey: monthKeyFromSheetTitle(normalize(sheet.properties?.title)),
      }))
      .filter((item): item is { title: string; monthKey: string } => Boolean(item.title && item.monthKey))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));

    const selected = availableMonths.find((item) => item.monthKey === month);
    if (!selected) {
      return NextResponse.json({
        ok: false,
        error: `No Google Sheet tab found for ${month}`,
        availableMonths,
      }, { status: 404 });
    }

    const values = await readSheet(accessToken, spreadsheetId, selected.title);
    if (!values.length) {
      return NextResponse.json({ ok: true, month, sheetTitle: selected.title, agents: [], days: [], rows: {}, availableMonths });
    }

    const year = Number(month.slice(0, 4));
    const header = values[0] ?? [];
    const dateColumns: { columnIndex: number; isoDate: string; label: string }[] = [];

    for (let columnIndex = 1; columnIndex < header.length; columnIndex += 1) {
      const isoDate = parseHeaderDate(header[columnIndex], year);
      if (!isoDate) continue;
      dateColumns.push({ columnIndex, isoDate, label: normalize(header[columnIndex]) || isoDate });
    }

    const agents: string[] = [];
    const rows: Record<string, string[]> = {};

    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex] ?? [];
      const name = normalize(row[0]);

      if (!name) {
        if (agents.length > 0) break;
        continue;
      }

      const normalizedName = name.toLowerCase();
      if (["customer support", "training", "sick leave", "vacation"].includes(normalizedName)) break;

      agents.push(name);
      rows[name] = dateColumns.map(({ columnIndex }) => normalize(row[columnIndex]));
    }

    return NextResponse.json({
      ok: true,
      month,
      sheetTitle: selected.title,
      agents,
      days: dateColumns.map((item) => item.isoDate),
      dayLabels: dateColumns.map((item) => item.label),
      rows,
      availableMonths,
      sourceUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown Google Schedule error" },
      { status: 500 }
    );
  }
}
