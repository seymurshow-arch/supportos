import { createSign } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const PROJECT_SHEETS: Record<string, string> = {
  "50 Crowns": "50Crowns",
  "Tip-top": "TipTop",
  FanoBet: "FanoBet",
  WonderLuck: "WonderLuck",
  LunuBet: "LunuBet",
  Roostino: "Roostino",
  "Haha Spin": "HAHA",
  Galleon: "Galleon",
  Inky: "Inky",
  Spartastic: "Spartastic",
};

const ALL_BRANDS_SHEET = "ALL Brands";

const HEADER_BG = { red: 23 / 255, green: 54 / 255, blue: 93 / 255 };
const MONTH_BG = { red: 68 / 255, green: 114 / 255, blue: 196 / 255 };
const WEEK_BG = { red: 226 / 255, green: 240 / 255, blue: 217 / 255 };
const TAG_HEADER_BG = { red: 217 / 255, green: 226 / 255, blue: 243 / 255 };
const TOP_10_BG = { red: 1, green: 242 / 255, blue: 204 / 255 };
const WHITE = { red: 1, green: 1, blue: 1 };
const BLACK = { red: 0, green: 0, blue: 0 };
const NAVY_TEXT = { red: 23 / 255, green: 54 / 255, blue: 93 / 255 };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type TagRow = {
  tag: string;
  label: string;
  total: number;
  vip: number;
  regular: number;
};

type ProjectPayload = {
  name: string;
  chats: number;
  totalChatTimeSec?: number;
  avgChatDurationSec: number;
  csat: number;
  tags: TagRow[];
};

type SummaryPayload = {
  chats: number;
  totalChatTimeSec: number;
  avgChatDurationSec: number;
  csat: number;
};

type ExportBody = {
  from?: string;
  to?: string;
  projects?: ProjectPayload[];
  allSummary?: SummaryPayload;
};

type SheetInfo = {
  sheetId: number;
  title: string;
};

type WeekBlock = {
  start: number; // 0-based inclusive row index
  end: number;   // 0-based exclusive row index
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
  const payload = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));

  const unsignedToken = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${base64Url(signer.sign(privateKey))}`;

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
    throw new Error(json.error_description || json.error || "Google authentication failed");
  }
  return String(json.access_token);
}

async function sheetsFetch(accessToken: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error?.message || `Google Sheets request failed (${response.status})`);
  }
  return json;
}

async function getSpreadsheetMeta(accessToken: string, spreadsheetId: string) {
  return sheetsFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`
  );
}

async function batchUpdate(accessToken: string, spreadsheetId: string, requests: unknown[]) {
  if (!requests.length) return {};
  return sheetsFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({ requests }),
    }
  );
}

async function batchReadValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitles: string[]
): Promise<Map<string, unknown[][]>> {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`
  );

  for (const title of sheetTitles) {
    url.searchParams.append("ranges", `'${title.replace(/'/g, "''")}'!A:E`);
  }
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");

  const json = await sheetsFetch(accessToken, url.toString());
  const result = new Map<string, unknown[][]>();

  (json.valueRanges || []).forEach((item: any, index: number) => {
    result.set(sheetTitles[index], Array.isArray(item.values) ? item.values : []);
  });

  for (const title of sheetTitles) {
    if (!result.has(title)) result.set(title, []);
  }
  return result;
}

function parseISODate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    !year || !month || !day ||
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function monthLabelFromEndDate(to: string) {
  const date = parseISODate(to);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function formatDateShort(value: string) {
  const date = parseISODate(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function weekLabel(from: string, to: string) {
  return `${formatDateShort(from)}-${formatDateShort(to)}`;
}

function normalizeWeekText(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalWeekKey(value: unknown) {
  const normalized = normalizeWeekText(value).replace(/^week\s*/i, "");
  const dates = normalized.match(/\d{1,2}\s*\/\s*\d{1,2}/g);
  if (!dates || dates.length < 2) return normalized.toLowerCase();

  const cleanDate = (date: string) => {
    const [day, month] = date.split("/").map((part) => Number(part.trim()));
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  };

  return `${cleanDate(dates[0])}-${cleanDate(dates[1])}`;
}

function isWeekLabel(value: unknown) {
  return /^week\s+/i.test(normalizeWeekText(value));
}

function isMonthLabel(value: unknown) {
  const text = String(value ?? "").trim();
  return MONTH_NAMES.some((month) => new RegExp(`^${month}\\s+\\d{4}$`, "i").test(text));
}

function trimRows(values: unknown[][]) {
  let last = values.length;
  while (last > 0) {
    const row = values[last - 1] ?? [];
    if (row.some((value) => String(value ?? "").trim() !== "")) break;
    last -= 1;
  }
  return values.slice(0, last);
}

function findMonthRow(values: unknown[][], monthLabel: string) {
  return values.findIndex((row) => String(row?.[0] ?? "").trim() === monthLabel);
}

function findMonthEndIndex(values: unknown[][], monthIndex: number) {
  for (let i = monthIndex + 1; i < values.length; i += 1) {
    if (isMonthLabel(values[i]?.[0])) return i;
  }
  return values.length;
}

function findAllWeekBlocks(values: unknown[][], label: string): WeekBlock[] {
  const target = canonicalWeekKey(label);
  const anchors: number[] = [];

  for (let i = 0; i < values.length; i += 1) {
    const first = values[i]?.[0];
    if (canonicalWeekKey(first) === target) anchors.push(i);
  }

  if (!anchors.length) return [];

  const isKpiHeader = (row: unknown[] | undefined) =>
    String(row?.[0] ?? "").trim().toLowerCase() === "week / date range";

  const blocks: WeekBlock[] = anchors.map((anchor) => {
    let start = anchor;

    // Expand upward across the KPI header and optional "Week ..." title.
    if (start > 0 && isKpiHeader(values[start - 1])) start -= 1;
    if (
      start > 0 &&
      isWeekLabel(values[start - 1]?.[0]) &&
      canonicalWeekKey(values[start - 1]?.[0]) === target
    ) {
      start -= 1;
    }

    // If anchor itself is the Week title, keep it.
    if (
      isWeekLabel(values[anchor]?.[0]) &&
      canonicalWeekKey(values[anchor]?.[0]) === target
    ) {
      start = anchor;
    }

    let end = values.length;
    for (let j = Math.max(anchor + 1, start + 1); j < values.length; j += 1) {
      const first = values[j]?.[0];

      // Another month/week begins.
      if (isMonthLabel(first)) {
        end = j;
        break;
      }

      if (isWeekLabel(first)) {
        // Same target again => this is another duplicate block; stop here so it
        // becomes its own block and can be removed too.
        end = j;
        break;
      }

      // Orphan duplicate: a second KPI header after we've passed this block's data.
      if (j > anchor + 1 && isKpiHeader(values[j])) {
        end = j;
        break;
      }
    }

    return { start, end };
  });

  // Merge overlaps only. Adjacent duplicates remain separate so every copy is deleted.
  const sorted = blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: WeekBlock[] = [];

  for (const block of sorted) {
    const last = merged[merged.length - 1];
    if (!last || block.start >= last.end) {
      merged.push({ ...block });
    } else {
      last.end = Math.max(last.end, block.end);
    }
  }

  return merged;
}

function secondsToTimeValue(seconds: number) {
  return Math.max(0, Number(seconds) || 0) / 86400;
}

function sortedTags(tags: TagRow[]) {
  return [...tags]
    .filter((item) => item && Number(item.total) > 0 && String(item.label || item.tag).trim())
    .sort((a, b) => {
      if (Number(b.total) !== Number(a.total)) return Number(b.total) - Number(a.total);
      return String(a.label || a.tag).localeCompare(String(b.label || b.tag));
    });
}

function aggregateProjects(projects: ProjectPayload[]): ProjectPayload {
  const totalChats = projects.reduce((sum, p) => sum + Math.max(0, Number(p.chats) || 0), 0);
  const totalTimeSec = projects.reduce(
    (sum, p) => sum + Math.max(0, Number(p.chats) || 0) * Math.max(0, Number(p.avgChatDurationSec) || 0),
    0
  );

  const csatValues = projects
    .filter((p) => Number(p.chats) > 0 && Number.isFinite(Number(p.csat)))
    .map((p) => Number(p.csat));

  return {
    name: "All Projects",
    chats: totalChats,
    avgChatDurationSec: totalChats > 0 ? totalTimeSec / totalChats : 0,
    csat: csatValues.length ? csatValues.reduce((a, b) => a + b, 0) / csatValues.length : 0,
    tags: [],
  };
}

function mergeDuplicateProjects(projects: ProjectPayload[]) {
  const grouped = new Map<string, ProjectPayload[]>();

  for (const project of projects) {
    const sheetTitle = PROJECT_SHEETS[project.name];
    if (!sheetTitle) continue;
    const items = grouped.get(sheetTitle) ?? [];
    items.push(project);
    grouped.set(sheetTitle, items);
  }

  const result: ProjectPayload[] = [];

  for (const [sheetTitle, items] of grouped.entries()) {
    if (items.length === 1) {
      result.push(items[0]);
      continue;
    }

    const chats = items.reduce((sum, p) => sum + Math.max(0, Number(p.chats) || 0), 0);
    const totalTimeSec = items.reduce(
      (sum, p) => sum + Math.max(0, Number(p.chats) || 0) * Math.max(0, Number(p.avgChatDurationSec) || 0),
      0
    );
    const csatValues = items
      .filter((p) => Number(p.chats) > 0 && Number.isFinite(Number(p.csat)))
      .map((p) => Number(p.csat));

    const tagMap = new Map<string, TagRow>();
    for (const p of items) {
      for (const tag of p.tags || []) {
        const key = String(tag.tag || tag.label).trim().toLowerCase();
        if (!key) continue;
        const current = tagMap.get(key) ?? {
          tag: tag.tag,
          label: tag.label || tag.tag,
          total: 0,
          vip: 0,
          regular: 0,
        };
        current.total += Number(tag.total) || 0;
        current.vip += Number(tag.vip) || 0;
        current.regular += Number(tag.regular) || 0;
        tagMap.set(key, current);
      }
    }

    const canonicalName =
      Object.entries(PROJECT_SHEETS).find(([, title]) => title === sheetTitle)?.[0] ??
      items[0].name;

    result.push({
      name: canonicalName,
      chats,
      totalChatTimeSec: totalTimeSec,
      avgChatDurationSec: chats > 0 ? totalTimeSec / chats : 0,
      csat: csatValues.length ? csatValues.reduce((a, b) => a + b, 0) / csatValues.length : 0,
      tags: sortedTags(Array.from(tagMap.values())),
    });
  }

  return result;
}

function validateBody(body: ExportBody) {
  const from = String(body.from || "").trim();
  const to = String(body.to || "").trim();

  const fromDate = parseISODate(from);
  const toDate = parseISODate(to);
  if (toDate.getTime() < fromDate.getTime()) {
    throw new Error("The end date cannot be earlier than the start date");
  }

  const projects = Array.isArray(body.projects) ? body.projects : [];
  if (!projects.length) throw new Error("No project report data received");

  return { from, to, projects };
}

function rowRange(sheetId: number, row1Based: number, rowCount = 1, startColumn = 0, endColumn = 5) {
  return {
    sheetId,
    startRowIndex: row1Based - 1,
    endRowIndex: row1Based - 1 + rowCount,
    startColumnIndex: startColumn,
    endColumnIndex: endColumn,
  };
}

function colorFormat(backgroundColor: Record<string, number>, foregroundColor = WHITE, bold = false) {
  return {
    backgroundColor,
    textFormat: { foregroundColor, bold },
  };
}

function cellValue(value: string | number | null, formula?: string) {
  if (formula) return { userEnteredValue: { formulaValue: formula } };
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "string") return { userEnteredValue: { stringValue: value } };
  return {};
}

function makeRow(values: (string | number | null)[], formulas: Record<number, string> = {}) {
  return {
    values: values.map((value, index) => cellValue(value, formulas[index])),
  };
}

function buildWeekRows(label: string, project: ProjectPayload, includeTags: boolean) {
  const tags = includeTags ? sortedTags(project.tags || []) : [];
  const dataRowOffset = 2;
  const exactTotalTimeSec = Math.max(0, Number(project.totalChatTimeSec) || 0);

  const rows = [
    makeRow([`Week ${label}`, null, null, null, null]),
    makeRow([
      "Week / Date Range",
      "Total Chats",
      "Total Chat Time (hh:mm:ss)",
      "Avg Chat Duration (hh:mm:ss)",
      "Chat Satisfaction (%)",
    ]),
    makeRow([
      label,
      Math.max(0, Number(project.chats) || 0),
      exactTotalTimeSec > 0 ? secondsToTimeValue(exactTotalTimeSec) : null,
      secondsToTimeValue(project.avgChatDurationSec),
      Number(project.chats) > 0 ? Math.max(0, Number(project.csat) || 0) / 100 : null,
    ]),
    makeRow([null, null, null, null, null]),
  ];

  if (includeTags) {
    rows.push(makeRow(["Tag / Topic", "Total", "VIP", "Regular", null]));
    for (const tag of tags) {
      rows.push(
        makeRow([
          tag.label || tag.tag,
          Number(tag.total) || 0,
          Number(tag.vip) || 0,
          Number(tag.regular) || 0,
          null,
        ])
      );
    }
    rows.push(makeRow([null, null, null, null, null]));
  }

  return {
    rows,
    tagCount: tags.length,
    includeTags,
    dataRowOffset,
    hasExactTotalTime: exactTotalTimeSec > 0,
  };
}

function addWeekFormattingRequests(
  requests: any[],
  sheetId: number,
  startRowIndex: number,
  tagCount: number,
  includeTags: boolean,
  hasExactTotalTime: boolean
) {
  const startRow = startRowIndex + 1;
  const dataRow = startRow + 2;
  const tagHeaderRow = startRow + 4;
  const tagStartRow = startRow + 5;
  const totalRows = includeTags ? 6 + tagCount : 4;

  // Reset the entire newly inserted block first so no old/inherited dark formatting leaks
  // into KPI data rows or tag rows.
  requests.push({
    repeatCell: {
      range: rowRange(sheetId, startRow, totalRows, 0, 5),
      cell: {
        userEnteredFormat: {
          backgroundColor: WHITE,
          textFormat: { foregroundColor: BLACK, bold: false },
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });

  requests.push(
    {
      mergeCells: {
        range: rowRange(sheetId, startRow, 1, 0, 5),
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: rowRange(sheetId, startRow, 1, 0, 5),
        cell: { userEnteredFormat: colorFormat(WEEK_BG, NAVY_TEXT, true) },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    },
    {
      repeatCell: {
        range: rowRange(sheetId, startRow + 1, 1, 0, 5),
        cell: {
          userEnteredFormat: {
            ...colorFormat(HEADER_BG, WHITE, true),
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat",
      },
    },
    {
      repeatCell: {
        range: rowRange(sheetId, dataRow, 1, 0, 5),
        cell: {
          userEnteredFormat: {
            backgroundColor: WHITE,
            textFormat: { foregroundColor: BLACK, bold: false },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    {
      repeatCell: {
        range: rowRange(sheetId, dataRow, 1, 2, 4),
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "TIME", pattern: "[h]:mm:ss" },
          },
        },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    {
      repeatCell: {
        range: rowRange(sheetId, dataRow, 1, 4, 5),
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "PERCENT", pattern: "0%" },
          },
        },
        fields: "userEnteredFormat.numberFormat",
      },
    },
  );

  if (!hasExactTotalTime) {
    requests.push({
      updateCells: {
        range: rowRange(sheetId, dataRow, 1, 2, 3),
        rows: [
          {
            values: [
              {
                userEnteredValue: { formulaValue: `=B${dataRow}*D${dataRow}` },
                userEnteredFormat: {
                  numberFormat: { type: "TIME", pattern: "[h]:mm:ss" },
                },
              },
            ],
          },
        ],
        fields: "userEnteredValue,userEnteredFormat.numberFormat",
      },
    });
  }

  if (includeTags) {
    requests.push({
      repeatCell: {
        range: rowRange(sheetId, tagHeaderRow, 1, 0, 4),
        cell: {
          userEnteredFormat: {
            ...colorFormat(TAG_HEADER_BG, NAVY_TEXT, true),
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat",
      },
    });

    if (tagCount > 0) {
      requests.push({
        repeatCell: {
          range: rowRange(sheetId, tagStartRow, tagCount, 0, 4),
          cell: {
            userEnteredFormat: {
              backgroundColor: WHITE,
              textFormat: { foregroundColor: BLACK, bold: false },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });

      requests.push({
        repeatCell: {
          range: rowRange(sheetId, tagStartRow, Math.min(10, tagCount), 0, 4),
          cell: {
            userEnteredFormat: {
              backgroundColor: TOP_10_BG,
            },
          },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
    }
  }
}

function addMonthFormattingRequests(requests: any[], sheetId: number, rowIndex: number) {
  const row = rowIndex + 1;
  requests.push(
    {
      mergeCells: {
        range: rowRange(sheetId, row, 1, 0, 5),
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: rowRange(sheetId, row, 1, 0, 5),
        cell: {
          userEnteredFormat: colorFormat(MONTH_BG, WHITE, true),
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    }
  );
}

async function ensureSheets(
  accessToken: string,
  spreadsheetId: string,
  requiredTitles: string[]
) {
  let meta;
  try {
    meta = await getSpreadsheetMeta(accessToken, spreadsheetId);
  } catch (error) {
    throw new Error(
      `Cannot open report spreadsheet ${spreadsheetId}: ` +
      (error instanceof Error ? error.message : String(error))
    );
  }

  const result = new Map<string, SheetInfo>();
  (meta.sheets || []).forEach((sheet: any) => {
    const title = String(sheet?.properties?.title || "");
    const sheetId = Number(sheet?.properties?.sheetId);
    if (title && Number.isFinite(sheetId)) {
      result.set(title, { title, sheetId });
    }
  });

  const missing = requiredTitles.filter((title) => !result.has(title));
  if (missing.length) {
    throw new Error(
      `Missing required report sheet(s): ${missing.join(", ")}. ` +
      `Open the new report spreadsheet and make sure these tabs exist with exactly these names.`
    );
  }

  return result;
}

function addHeaderRequests(requests: any[], sheet: SheetInfo) {
  const isAll = sheet.title === ALL_BRANDS_SHEET;
  const title = `${sheet.title} — Support Weekly Report`;
  const note = isAll
    ? "SupportOS creates weekly KPI blocks here. Tags are intentionally not exported to ALL Brands."
    : "SupportOS creates the selected week only after Export Report. Each project week includes KPI + real tags; Top 10 tags are highlighted.";

  requests.push(
    {
      updateCells: {
        range: {
          sheetId: sheet.sheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
        rows: [
          makeRow([title, null, null, null, null]),
          makeRow([note, null, null, null, null]),
          makeRow([null, null, null, null, null]),
        ],
        fields: "userEnteredValue",
      },
    },
    {
      mergeCells: {
        range: rowRange(sheet.sheetId, 1, 1, 0, 5),
        mergeType: "MERGE_ALL",
      },
    },
    {
      mergeCells: {
        range: rowRange(sheet.sheetId, 2, 1, 0, 5),
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: rowRange(sheet.sheetId, 1, 1, 0, 5),
        cell: {
          userEnteredFormat: colorFormat(HEADER_BG, WHITE, true),
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: sheet.sheetId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: 5,
        },
        properties: { pixelSize: 180 },
        fields: "pixelSize",
      },
    }
  );
}

function planSheetExport(
  requests: any[],
  sheet: SheetInfo,
  rawValues: unknown[][],
  monthLabel: string,
  label: string,
  project: ProjectPayload,
  includeTags: boolean
) {
  let values = trimRows(rawValues);
  const headerMissing = !String(values[0]?.[0] ?? "").trim();

  if (headerMissing) {
    addHeaderRequests(requests, sheet);
    values = [
      [`${sheet.title} — Support Weekly Report`],
      [""],
      [""],
    ];
  }

  const duplicates = findAllWeekBlocks(values, label);
  let insertionIndex: number | null = null;

  if (duplicates.length) {
    insertionIndex = Math.min(...duplicates.map((b) => b.start));

    // Delete from bottom to top, then insert one fresh block at the earliest old position.
    [...duplicates]
      .sort((a, b) => b.start - a.start)
      .forEach((block) => {
        requests.push({
          deleteDimension: {
            range: {
              sheetId: sheet.sheetId,
              dimension: "ROWS",
              startIndex: block.start,
              endIndex: block.end,
            },
          },
        });
      });
  }

  // Work on a lightweight virtual copy after duplicate removal so month positions stay correct.
  if (duplicates.length) {
    const keep = values.filter((_, index) => !duplicates.some((b) => index >= b.start && index < b.end));
    values = keep;
  }

  let monthIndex = findMonthRow(values, monthLabel);

  if (monthIndex < 0) {
    const monthRowIndex = Math.max(3, values.length);
    requests.push({
      insertDimension: {
        range: {
          sheetId: sheet.sheetId,
          dimension: "ROWS",
          startIndex: monthRowIndex,
          endIndex: monthRowIndex + 1,
        },
        inheritFromBefore: false,
      },
    });
    requests.push({
      updateCells: {
        range: {
          sheetId: sheet.sheetId,
          startRowIndex: monthRowIndex,
          endRowIndex: monthRowIndex + 1,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
        rows: [makeRow([monthLabel, null, null, null, null])],
        fields: "userEnteredValue",
      },
    });
    addMonthFormattingRequests(requests, sheet.sheetId, monthRowIndex);

    monthIndex = monthRowIndex;

    if (insertionIndex == null) {
      insertionIndex = monthRowIndex + 1;
    } else if (insertionIndex >= monthRowIndex) {
      insertionIndex += 1;
    }
  }

  if (insertionIndex == null) {
    insertionIndex = findMonthEndIndex(values, monthIndex);
    if (monthIndex >= values.length) insertionIndex = monthIndex + 1;
  }

  const built = buildWeekRows(label, project, includeTags);

  requests.push({
    insertDimension: {
      range: {
        sheetId: sheet.sheetId,
        dimension: "ROWS",
        startIndex: insertionIndex,
        endIndex: insertionIndex + built.rows.length,
      },
      inheritFromBefore: false,
    },
  });

  requests.push({
    updateCells: {
      range: {
        sheetId: sheet.sheetId,
        startRowIndex: insertionIndex,
        endRowIndex: insertionIndex + built.rows.length,
        startColumnIndex: 0,
        endColumnIndex: 5,
      },
      rows: built.rows,
      fields: "userEnteredValue",
    },
  });

  addWeekFormattingRequests(
    requests,
    sheet.sheetId,
    insertionIndex,
    built.tagCount,
    built.includeTags,
    built.hasExactTotalTime
  );
}

const exportTails = new Map<string, Promise<void>>();

async function withExportLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = exportTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  exportTails.set(key, tail);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (exportTails.get(key) === tail) exportTails.delete(key);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ExportBody;
    const { from, to, projects } = validateBody(body);

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const spreadsheetId = process.env.GOOGLE_REPORT_SPREADSHEET_ID?.trim();

    if (!clientEmail || !privateKey) {
      return NextResponse.json(
        { ok: false, error: "Google Sheets credentials are not configured" },
        { status: 500 }
      );
    }
    if (!spreadsheetId) {
      return NextResponse.json(
        { ok: false, error: "GOOGLE_REPORT_SPREADSHEET_ID is not configured" },
        { status: 500 }
      );
    }

    const normalizedProjects = mergeDuplicateProjects(
      projects
        .map((item) => ({
          ...item,
          name: String(item.name || "").trim(),
          chats: Math.max(0, Number(item.chats) || 0),
          totalChatTimeSec: Math.max(0, Number(item.totalChatTimeSec) || 0),
          avgChatDurationSec: Math.max(0, Number(item.avgChatDurationSec) || 0),
          csat: Math.max(0, Number(item.csat) || 0),
          tags: sortedTags(Array.isArray(item.tags) ? item.tags : []),
        }))
        .filter((item) => PROJECT_SHEETS[item.name])
    );

    if (!normalizedProjects.length) {
      return NextResponse.json(
        { ok: false, error: "None of the detected projects match report sheet mappings" },
        { status: 422 }
      );
    }

    const accessToken = await getAccessToken(clientEmail, privateKey);
    const requiredTitles = [
      ALL_BRANDS_SHEET,
      ...Array.from(new Set(Object.values(PROJECT_SHEETS))),
    ];

    const sheets = await ensureSheets(accessToken, spreadsheetId, requiredTitles);
    const monthLabel = monthLabelFromEndDate(to);
    const label = weekLabel(from, to);

    return await withExportLock(`${spreadsheetId}:${canonicalWeekKey(label)}`, async () => {
      const valuesBySheet = await batchReadValues(accessToken, spreadsheetId, requiredTitles);
      const requests: any[] = [];

      // Every individual project: KPI + real tags.
      for (const project of normalizedProjects) {
        const sheetTitle = PROJECT_SHEETS[project.name];
        const sheet = sheets.get(sheetTitle);
        if (!sheet) throw new Error(`Missing sheet: ${sheetTitle}`);

        planSheetExport(
          requests,
          sheet,
          valuesBySheet.get(sheetTitle) ?? [],
          monthLabel,
          label,
          project,
          true
        );
      }

      // ALL Brands: KPI only, no tags.
      // Prefer the direct all-project LiveChat summary so empty/new projects with 0 metrics
      // do not distort CSAT or average duration.
      const directSummary = body.allSummary;
      const allBrands: ProjectPayload =
        directSummary &&
        Number.isFinite(Number(directSummary.chats)) &&
        Number.isFinite(Number(directSummary.avgChatDurationSec)) &&
        Number.isFinite(Number(directSummary.csat))
          ? {
              name: "All Projects",
              chats: Math.max(0, Number(directSummary.chats) || 0),
              totalChatTimeSec: Math.max(0, Number(directSummary.totalChatTimeSec) || 0),
              avgChatDurationSec: Math.max(0, Number(directSummary.avgChatDurationSec) || 0),
              csat: Math.max(0, Number(directSummary.csat) || 0),
              tags: [],
            }
          : aggregateProjects(normalizedProjects);

      const allSheet = sheets.get(ALL_BRANDS_SHEET);
      if (!allSheet) throw new Error(`Missing sheet: ${ALL_BRANDS_SHEET}`);

      planSheetExport(
        requests,
        allSheet,
        valuesBySheet.get(ALL_BRANDS_SHEET) ?? [],
        monthLabel,
        label,
        allBrands,
        false
      );

      // One Sheets write request for the whole export.
      await batchUpdate(accessToken, spreadsheetId, requests);

      // Hard idempotency verification:
      // re-read the affected sheets after the write. If any target week still exists
      // more than once, remove every copy and write exactly one canonical block.
      const affectedTitles = [
        ...normalizedProjects.map((project) => PROJECT_SHEETS[project.name]),
        ALL_BRANDS_SHEET,
      ];
      const uniqueAffectedTitles = Array.from(new Set(affectedTitles));
      const afterValues = await batchReadValues(accessToken, spreadsheetId, uniqueAffectedTitles);
      const repairRequests: any[] = [];

      for (const project of normalizedProjects) {
        const sheetTitle = PROJECT_SHEETS[project.name];
        const sheet = sheets.get(sheetTitle);
        if (!sheet) continue;

        const values = afterValues.get(sheetTitle) ?? [];
        const copies = findAllWeekBlocks(values, label);

        if (copies.length > 1) {
          const earliest = Math.min(...copies.map((block) => block.start));

          [...copies]
            .sort((a, b) => b.start - a.start)
            .forEach((block) => {
              repairRequests.push({
                deleteDimension: {
                  range: {
                    sheetId: sheet.sheetId,
                    dimension: "ROWS",
                    startIndex: block.start,
                    endIndex: block.end,
                  },
                },
              });
            });

          const built = buildWeekRows(label, project, true);
          repairRequests.push({
            insertDimension: {
              range: {
                sheetId: sheet.sheetId,
                dimension: "ROWS",
                startIndex: earliest,
                endIndex: earliest + built.rows.length,
              },
              inheritFromBefore: false,
            },
          });
          repairRequests.push({
            updateCells: {
              range: {
                sheetId: sheet.sheetId,
                startRowIndex: earliest,
                endRowIndex: earliest + built.rows.length,
                startColumnIndex: 0,
                endColumnIndex: 5,
              },
              rows: built.rows,
              fields: "userEnteredValue",
            },
          });
          addWeekFormattingRequests(
            repairRequests,
            sheet.sheetId,
            earliest,
            built.tagCount,
            built.includeTags,
            built.hasExactTotalTime
          );
        }
      }

      const allAfter = afterValues.get(ALL_BRANDS_SHEET) ?? [];
      const allCopies = findAllWeekBlocks(allAfter, label);
      if (allCopies.length > 1) {
        const allSheet = sheets.get(ALL_BRANDS_SHEET);
        if (allSheet) {
          const earliest = Math.min(...allCopies.map((block) => block.start));

          [...allCopies]
            .sort((a, b) => b.start - a.start)
            .forEach((block) => {
              repairRequests.push({
                deleteDimension: {
                  range: {
                    sheetId: allSheet.sheetId,
                    dimension: "ROWS",
                    startIndex: block.start,
                    endIndex: block.end,
                  },
                },
              });
            });

          const built = buildWeekRows(label, allBrands, false);
          repairRequests.push({
            insertDimension: {
              range: {
                sheetId: allSheet.sheetId,
                dimension: "ROWS",
                startIndex: earliest,
                endIndex: earliest + built.rows.length,
              },
              inheritFromBefore: false,
            },
          });
          repairRequests.push({
            updateCells: {
              range: {
                sheetId: allSheet.sheetId,
                startRowIndex: earliest,
                endRowIndex: earliest + built.rows.length,
                startColumnIndex: 0,
                endColumnIndex: 5,
              },
              rows: built.rows,
              fields: "userEnteredValue",
            },
          });
          addWeekFormattingRequests(
            repairRequests,
            allSheet.sheetId,
            earliest,
            built.tagCount,
            built.includeTags,
            built.hasExactTotalTime
          );
        }
      }

      if (repairRequests.length) {
        await batchUpdate(accessToken, spreadsheetId, repairRequests);
      }

      return NextResponse.json({
        ok: true,
        period: { from, to },
        month: monthLabel,
        week: label,
        projectsExported: normalizedProjects.map((item) => item.name),
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        mode: "replace-existing-week",
        tags: "project-tabs-only",
      });
    });
  } catch (error) {
    console.error("[report-export]", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Report export failed",
      },
      { status: 500 }
    );
  }
}
