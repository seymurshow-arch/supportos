export type ScheduleAgent = {
  name: string;
  email: string | null;
  label: string;
};

export type ParsedSchedule = {
  agents: string[];
  agentDetails: Record<string, ScheduleAgent>;
  days: string[];
  rows: Record<string, string[]>;
};

export type ShiftInterval = {
  start: string;
  end: string;
  source: "preset" | "custom";
  code?: string;
  dayOffset: number;
};

export type ShiftStatus =
  | "working"
  | "off"
  | "sick_leave"
  | "vacation"
  | "training";

export type ParsedShift = {
  raw: string;
  normalized: string;
  status: ShiftStatus;
  codes: string[];
  intervals: ShiftInterval[];
  dayHours: number;
  nightHours: number;
  totalHours: number;
  valid: boolean;
  unknownParts: string[];
};

export type ScheduleIssue = {
  level: "error" | "warning";
  message: string;
  agent?: string;
  day?: string;
  value?: string;
};

export type ScheduleStats = {
  agents: number;
  days: number;
  dayHours: number;
  nightHours: number;
  totalHours: number;
  workingCells: number;
  offCells: number;
  leaveCells: number;
  trainingCells: number;
  invalidCells: number;
};

const PRESET_INTERVALS: Record<string, ShiftInterval> = {
  D: { start: "08:00", end: "16:00", source: "preset", code: "D", dayOffset: 0 },
  E: { start: "16:00", end: "00:00", source: "preset", code: "E", dayOffset: 0 },
  N: { start: "00:00", end: "08:00", source: "preset", code: "N", dayOffset: 1 },
};

const TIME_RANGE_RE = /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/g;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isValidTime(time: string) {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function splitIntervalHours(start: string, end: string) {
  let startMinutes = timeToMinutes(start);
  let endMinutes = timeToMinutes(end);

  if (endMinutes <= startMinutes) endMinutes += 24 * 60;

  let dayMinutes = 0;
  let nightMinutes = 0;

  for (let minute = startMinutes; minute < endMinutes; minute += 1) {
    const normalizedMinute = minute % (24 * 60);
    if (normalizedMinute < 8 * 60) nightMinutes += 1;
    else dayMinutes += 1;
  }

  return {
    dayHours: dayMinutes / 60,
    nightHours: nightMinutes / 60,
  };
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

export function parseShiftValue(value: string): ParsedShift {
  const raw = value ?? "";
  const clean = normalizeWhitespace(raw);

  if (!clean || /^(OFF|DAY OFF|O|-)$/i.test(clean)) {
    return {
      raw,
      normalized: clean,
      status: "off",
      codes: [],
      intervals: [],
      dayHours: 0,
      nightHours: 0,
      totalHours: 0,
      valid: true,
      unknownParts: [],
    };
  }

  if (/^(S|SICK\s*LEAVE)$/i.test(clean)) {
    return {
      raw,
      normalized: "Sick leave",
      status: "sick_leave",
      codes: [],
      intervals: [],
      dayHours: 8,
      nightHours: 0,
      totalHours: 8,
      valid: true,
      unknownParts: [],
    };
  }

  if (/^(V|VACATION|VAC|ANNUAL\s*LEAVE)$/i.test(clean)) {
    return {
      raw,
      normalized: "Vacation",
      status: "vacation",
      codes: [],
      intervals: [],
      dayHours: 8,
      nightHours: 0,
      totalHours: 8,
      valid: true,
      unknownParts: [],
    };
  }

  if (/^TRAINING$/i.test(clean)) {
    return {
      raw,
      normalized: "Training",
      status: "training",
      codes: [],
      intervals: [],
      dayHours: 8,
      nightHours: 0,
      totalHours: 8,
      valid: true,
      unknownParts: [],
    };
  }

  const intervals: ShiftInterval[] = [];
  const codes: string[] = [];
  const normalizedParts: string[] = [];
  const unknownParts: string[] = [];

  const ranges = [...clean.matchAll(TIME_RANGE_RE)];
  for (const range of ranges) {
    const start = normalizeTime(range[1]);
    const end = normalizeTime(range[2]);

    if (!isValidTime(start) || !isValidTime(end) || start === end) {
      unknownParts.push(range[0]);
      continue;
    }

    intervals.push({ start, end, source: "custom", dayOffset: 0 });
    normalizedParts.push(`${start}-${end}`);
  }

  const remaining = clean
    .replace(TIME_RANGE_RE, " ")
    .split(/[+;,/\s]+/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

  for (const token of remaining) {
    if (PRESET_INTERVALS[token]) {
      codes.push(token);
      intervals.push({ ...PRESET_INTERVALS[token] });
      normalizedParts.push(token);
    } else {
      unknownParts.push(token);
    }
  }

  let dayHours = 0;
  let nightHours = 0;

  for (const interval of intervals) {
    const hours = splitIntervalHours(interval.start, interval.end);
    dayHours += hours.dayHours;
    nightHours += hours.nightHours;
  }

  dayHours = roundHours(dayHours);
  nightHours = roundHours(nightHours);

  return {
    raw,
    normalized: normalizedParts.join(" + "),
    status: intervals.length > 0 ? "working" : "off",
    codes,
    intervals,
    dayHours,
    nightHours,
    totalHours: roundHours(dayHours + nightHours),
    valid: intervals.length > 0 && unknownParts.length === 0,
    unknownParts,
  };
}

function looksLikeHeader(line: string) {
  return /(?:mon|tue|wed|thu|fri|sat|sun)\s*,?\s*\d{1,2}\/\d{1,2}/i.test(line);
}

function parseAgent(rawAgent: string): ScheduleAgent {
  const separatorIndex = rawAgent.lastIndexOf("/");
  const rawName = separatorIndex >= 0 ? rawAgent.slice(0, separatorIndex) : rawAgent;
  const rawEmail = separatorIndex >= 0 ? rawAgent.slice(separatorIndex + 1) : "";
  const name = normalizeWhitespace(rawName);
  const email = normalizeWhitespace(rawEmail).toLowerCase();

  return {
    name,
    email: email || null,
    label: email ? `${name} / ${email}` : name,
  };
}

export function parseScheduleText(rawText: string): ParsedSchedule {
  const lines = rawText
    .split("\n")
    .map((line) => line.replace(/\r/g, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { agents: [], agentDetails: {}, days: [], rows: {} };
  }

  const hasTabs = rawText.includes("\t");
  const hasHeader = looksLikeHeader(lines[0]);

  const splitLine = (line: string) =>
    hasTabs
      ? line.split("\t").map((cell) => cell.trim())
      : line.split(/\s{2,}/).map((cell) => cell.trim());

  const headerParts = hasHeader ? splitLine(lines[0]) : [];
  const days = hasHeader
    ? headerParts[0] === ""
      ? headerParts.slice(1)
      : headerParts
    : [];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const agents: string[] = [];
  const agentDetails: Record<string, ScheduleAgent> = {};
  const rows: Record<string, string[]> = {};
  let maxDays = days.length;

  for (const line of dataLines) {
    const parts = splitLine(line);
    const rawAgent = parts[0]?.trim();
    if (!rawAgent) continue;

    const agent = parseAgent(rawAgent);
    if (!agent.name) continue;

    let key = agent.name;
    let duplicateIndex = 2;
    while (rows[key]) {
      key = `${agent.name} (${duplicateIndex})`;
      duplicateIndex += 1;
    }

    agents.push(key);
    agentDetails[key] = { ...agent, name: key };
    rows[key] = parts.slice(1).map((cell) => normalizeWhitespace(cell));
    maxDays = Math.max(maxDays, rows[key].length);
  }

  const finalDays = days.length
    ? days.map((day) => normalizeWhitespace(day))
    : Array.from({ length: maxDays }, (_, index) => `Day ${index + 1}`);

  for (const agent of agents) {
    rows[agent] = Array.from(
      { length: finalDays.length },
      (_, index) => rows[agent]?.[index] ?? ""
    );
  }

  return { agents, agentDetails, days: finalDays, rows };
}

export function serializeScheduleText(parsed: ParsedSchedule) {
  if (!parsed.days.length) return "";

  const header = ["", ...parsed.days].join("\t");
  const rows = parsed.agents.map((agent) => {
    const details = parsed.agentDetails[agent];
    const label = details?.email
      ? `${details.name} / ${details.email}`
      : details?.name ?? agent;
    return [label, ...(parsed.rows[agent] ?? [])].join("\t");
  });

  return [header, ...rows].join("\n");
}

export function validateSchedule(
  parsed: ParsedSchedule,
  monthKey?: string
): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const emails = new Map<string, string>();

  if (!parsed.days.length) {
    issues.push({ level: "error", message: "Schedule has no date columns." });
  }

  for (const day of parsed.days) {
    const match = day.match(/(\d{1,2})\/(\d{1,2})/);
    if (!match) {
      issues.push({ level: "warning", message: `Unrecognized date header: ${day}`, day });
      continue;
    }

    if (monthKey) {
      const expectedMonth = Number(monthKey.split("-")[1]);
      if (Number(match[2]) !== expectedMonth) {
        issues.push({
          level: "warning",
          message: `${day} does not match selected month ${monthKey}.`,
          day,
        });
      }
    }
  }

  for (const agent of parsed.agents) {
    const details = parsed.agentDetails[agent];
    const email = details?.email?.toLowerCase() ?? "";

    if (!email) {
      issues.push({ level: "error", message: "Agent email is missing.", agent });
    } else if (!EMAIL_RE.test(email)) {
      issues.push({ level: "error", message: `Invalid agent email: ${email}`, agent });
    } else if (emails.has(email)) {
      issues.push({
        level: "error",
        message: `Duplicate email also used by ${emails.get(email)}.`,
        agent,
      });
    } else {
      emails.set(email, agent);
    }

    (parsed.rows[agent] ?? []).forEach((value, index) => {
      const shift = parseShiftValue(value);
      if (!shift.valid && value.trim()) {
        issues.push({
          level: "error",
          message: `Unknown shift part: ${shift.unknownParts.join(", ") || value}`,
          agent,
          day: parsed.days[index],
          value,
        });
      }
    });
  }

  return issues;
}

export function calculateScheduleStats(parsed: ParsedSchedule): ScheduleStats {
  let dayHours = 0;
  let nightHours = 0;
  let workingCells = 0;
  let offCells = 0;
  let leaveCells = 0;
  let trainingCells = 0;
  let invalidCells = 0;

  for (const agent of parsed.agents) {
    for (const value of parsed.rows[agent] ?? []) {
      const shift = parseShiftValue(value);
      dayHours += shift.dayHours;
      nightHours += shift.nightHours;

      if (!shift.valid && value.trim()) invalidCells += 1;
      if (shift.status === "working") workingCells += 1;
      if (shift.status === "off") offCells += 1;
      if (shift.status === "sick_leave" || shift.status === "vacation") leaveCells += 1;
      if (shift.status === "training") trainingCells += 1;
    }
  }

  dayHours = roundHours(dayHours);
  nightHours = roundHours(nightHours);

  return {
    agents: parsed.agents.length,
    days: parsed.days.length,
    dayHours,
    nightHours,
    totalHours: roundHours(dayHours + nightHours),
    workingCells,
    offCells,
    leaveCells,
    trainingCells,
    invalidCells,
  };
}