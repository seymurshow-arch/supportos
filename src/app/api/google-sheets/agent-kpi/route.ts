import { createSign } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALCULATION_SHEET = "Calculation";

const KPI_METRICS = [
  "Escalation / Follow-up",
  "Trustpilot Reviews",
  "Quality Card",
  "VIP Service",
  "VIP FRT Chats",
] as const;

type KpiMetric = (typeof KPI_METRICS)[number];
type MetricValues = Record<KpiMetric, number | null>;

type RequestBody = {
  month?: string;
  agents?: string[];
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

  const header = base64Url(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
    })
  );

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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedToken}.${signature}`,
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

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function extractSpreadsheetId(value: string) {
  const clean = value.trim();

  const urlMatch = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) return urlMatch[1];

  if (/^[a-zA-Z0-9-_]+$/.test(clean)) return clean;

  return "";
}

function parseMetricNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = normalize(value);
  if (!text) return null;

  const normalized = text.replace(",", ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function emptyMetricValues(): MetricValues {
  return {
    "Escalation / Follow-up": null,
    "Trustpilot Reviews": null,
    "Quality Card": null,
    "VIP Service": null,
    "VIP FRT Chats": null,
  };
}

function readAgentSheetsConfig() {
  const raw = process.env.AGENT_KPI_SHEETS_JSON?.trim();

  if (!raw) {
    throw new Error("AGENT_KPI_SHEETS_JSON is not configured");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AGENT_KPI_SHEETS_JSON is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AGENT_KPI_SHEETS_JSON must be a JSON object");
  }

  return parsed as Record<string, string>;
}

async function readCalculationSheet(
  accessToken: string,
  spreadsheetId: string
) {
  const range = `'${CALCULATION_SHEET}'!A1:Z300`;

  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}`
  );

  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const json = await response.json();

  if (!response.ok) {
    const googleMessage =
      json.error?.message || "Failed to read Calculation sheet";

    if (
      String(googleMessage).toLowerCase().includes("unable to parse range") ||
      String(googleMessage).toLowerCase().includes("range")
    ) {
      throw new Error(`"${CALCULATION_SHEET}" sheet not found`);
    }

    throw new Error(googleMessage);
  }

  return Array.isArray(json.values) ? (json.values as unknown[][]) : [];
}

function findMetrics(values: unknown[][]) {
  const result = emptyMetricValues();

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] ?? [];

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = normalize(row[columnIndex]);

      // Exact metric-name match. No aliases.
      if (!KPI_METRICS.includes(cell as KpiMetric)) continue;

      const metric = cell as KpiMetric;
      const valueToTheRight = row[columnIndex + 1];

      result[metric] = parseMetricNumber(valueToTheRight);
    }
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const agents = Array.isArray(body.agents)
      ? body.agents.map((agent) => normalize(agent)).filter(Boolean)
      : [];

    if (agents.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No agents supplied",
        },
        { status: 400 }
      );
    }

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n"
    );

    if (!clientEmail || !privateKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Google Sheets credentials are not configured",
        },
        { status: 500 }
      );
    }

    const sheetConfig = readAgentSheetsConfig();
    const accessToken = await getAccessToken(clientEmail, privateKey);

    const result: Record<string, MetricValues> = {};
    const missingDocuments: string[] = [];
    const missingMetrics: Record<string, KpiMetric[]> = {};
    const errors: Record<string, string> = {};

    for (const agent of agents) {
      const configured = normalize(sheetConfig[agent]);

      if (!configured) {
        missingDocuments.push(agent);
        result[agent] = emptyMetricValues();
        continue;
      }

      const spreadsheetId = extractSpreadsheetId(configured);

      if (!spreadsheetId) {
        errors[agent] = "Invalid Spreadsheet ID or URL";
        result[agent] = emptyMetricValues();
        continue;
      }

      try {
        const values = await readCalculationSheet(
          accessToken,
          spreadsheetId
        );

        const metrics = findMetrics(values);
        result[agent] = metrics;

        const missing = KPI_METRICS.filter(
          (metric) => metrics[metric] === null
        );

        if (missing.length > 0) {
          missingMetrics[agent] = [...missing];
        }
      } catch (error) {
        errors[agent] =
          error instanceof Error ? error.message : "Unknown Google Sheets error";
        result[agent] = emptyMetricValues();
      }
    }

    return NextResponse.json({
      ok: true,
      month: body.month ?? null,
      sheet: CALCULATION_SHEET,
      metrics: KPI_METRICS,
      agents: result,
      missingDocuments,
      missingMetrics,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown agent KPI error",
      },
      { status: 500 }
    );
  }
}