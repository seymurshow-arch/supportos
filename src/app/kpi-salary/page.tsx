"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CircleDollarSign,
  Clock3,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import {
  deleteSalarySnapshot,
  getSalarySnapshots,
  saveSalarySnapshot,
  type SalarySnapshot,
} from "@/services/salaryService";
import { type ParsedSchedule } from "@/lib/schedule/parseSchedule";

const HOURLY_RATE = 5.5;
const KPI_BONUS_PER_POINT = 2;
const KPI_MAX_POINTS = 100;

const EXTERNAL_METRICS = [
  "Escalation / Follow-up",
  "Trustpilot Reviews",
  "Quality Card",
  "VIP Service",
  "VIP FRT Chats",
] as const;

type ExternalMetricName = (typeof EXTERNAL_METRICS)[number];
type ExternalMetricValues = Record<ExternalMetricName, number | null>;

const emptyParsed: ParsedSchedule = {
  agents: [],
  agentDetails: {},
  days: [],
  rows: {},
};

type GoogleScheduleMonth = {
  title: string;
  monthKey: string;
};

type GoogleScheduleResponse = {
  ok: boolean;
  error?: string;
  month?: string;
  sheetTitle?: string;
  agents?: string[];
  days?: string[];
  rows?: Record<string, string[]>;
  availableMonths?: GoogleScheduleMonth[];
};

type AgentMapping = {
  schedule_name: string;
  email: string;
};

type AgentKpiSheetResponse = {
  ok: boolean;
  error?: string;
  agents?: Record<string, ExternalMetricValues>;
  missingDocuments?: string[];
  missingMetrics?: Record<string, ExternalMetricName[]>;
  errors?: Record<string, string>;
};

type LiveKpi = {
  chats?: number;
  csat?: string;
  frtChats?: number;
  frtEmails?: number;
  art?: number;
};

type Row = {
  agent: string;
  email: string;
  workedDays: number;
  totalHours: number;
  chats: number;
  csat: number | null;
  frtChats: number | null;
  frtEmails: number | null;
  art: number | null;
  csatPoints: number;
  frtChatPoints: number;
  frtEmailPoints: number;
  artPoints: number;
  escalationPoints: number;
  trustpilotPoints: number;
  qualityCardPoints: number;
  vipServicePoints: number;
  vipFrtChatsPoints: number;
  totalKpiPoints: number;
  kpiPercent: number;
  baseSalary: number;
  kpiBonus: number;
  finalSalary: number;
};

type Totals = {
  agents: number;
  workedDays: number;
  totalHours: number;
  base: number;
  bonus: number;
  final: number;
};

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();

  return {
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function splitTimeRange(start: string, end: string) {
  let startMin = timeToMinutes(start);
  let endMin = timeToMinutes(end);

  if (endMin <= startMin) endMin += 24 * 60;

  let day = 0;
  let night = 0;

  for (let minute = startMin; minute < endMin; minute += 15) {
    const normalized = minute % (24 * 60);
    if (normalized >= 0 && normalized < 8 * 60) night += 15;
    else day += 15;
  }

  return { day: day / 60, night: night / 60 };
}

type BaseCycleShift = "D" | "E" | "N" | "OFF";
const BASE_SHIFT_CYCLE: BaseCycleShift[] = ["D", "E", "N", "OFF", "OFF"];

function isPaidLeave(value: string) {
  return /^(?:S|V|vacation|vac|annual\s*leave|sick\s*leave)$/i.test(value.trim());
}

function getSimpleCycleShift(value: string): BaseCycleShift | null {
  const clean = value.trim();
  if (!clean || /^(?:OFF|DAY\s*OFF|O|-)$/i.test(clean)) return "OFF";
  if (/^[DEN]$/i.test(clean)) return clean.toUpperCase() as "D" | "E" | "N";
  return null;
}

function inferBaseCycleOffset(shifts: string[]) {
  let bestOffset = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let offset = 0; offset < BASE_SHIFT_CYCLE.length; offset += 1) {
    let score = 0;
    let evidence = 0;

    shifts.forEach((value, index) => {
      const observed = getSimpleCycleShift(value);
      if (!observed) return;
      const expected = BASE_SHIFT_CYCLE[(index + offset) % BASE_SHIFT_CYCLE.length];
      evidence += 1;
      if (observed === expected) score += observed === "OFF" ? 1 : 5;
      else score -= observed === "OFF" ? 1 : 4;
    });

    score += evidence * 0.001;
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return bestOffset;
}

function getExpectedBaseShift(index: number, cycleOffset: number): BaseCycleShift {
  return BASE_SHIFT_CYCLE[(index + cycleOffset) % BASE_SHIFT_CYCLE.length];
}

function getShiftHours(value: string, expectedBaseShift?: BaseCycleShift) {
  const clean = value.trim();
  if (!clean) return { day: 0, night: 0 };

  if (isPaidLeave(clean)) {
    if (expectedBaseShift === "D" || expectedBaseShift === "E") {
      return { day: 8, night: 0 };
    }
    if (expectedBaseShift === "N") {
      return { day: 0, night: 8 };
    }
    return { day: 0, night: 0 };
  }

  let day = 0;
  let night = 0;
  const timeRanges = clean.match(/\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/g) || [];

  timeRanges.forEach((range) => {
    const [start, end] = range.split(/[-–]/).map((x) => x.trim());
    const result = splitTimeRange(start, end);
    day += result.day;
    night += result.night;
  });

  const tokens = clean
    .replace(/\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/g, "")
    .replace(/Day SM/gi, "")
    .replace(/Training/gi, "")
    .split(/[\s+]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

  tokens.forEach((token) => {
    if (token === "D" || token === "E") day += 8;
    if (token === "N") night += 8;
  });

  if (/\bday sm\b/i.test(clean)) day += 8;
  if (/\btraining\b/i.test(clean)) day += 8;

  return { day, night };
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getCsatPoints(csat: number | null) {
  if (csat === null) return 0;
  if (csat >= 90) return 5;
  if (csat >= 85) return 4;
  if (csat >= 80) return 3;
  if (csat >= 75) return 1;
  return 0;
}

function getFrtChatPoints(seconds: number | null) {
  if (seconds === null) return 0;
  if (seconds < 15) return 10;
  if (seconds <= 20) return 8;
  if (seconds <= 25) return 7;
  if (seconds <= 31) return 5;
  if (seconds <= 45) return 0;
  if (seconds <= 60) return -2;
  return -5;
}

function getFrtEmailPoints(minutes: number | null) {
  if (minutes === null) return 0;
  if (minutes < 10) return 10;
  if (minutes <= 15) return 8;
  if (minutes <= 20) return 5;
  if (minutes <= 30) return 2;
  if (minutes <= 45) return 0;
  return -5;
}

function getArtPoints(seconds: number | null) {
  if (seconds === null) return 0;
  if (seconds <= 60) return 3;
  if (seconds <= 120) return 2;
  if (seconds <= 180) return 1;
  if (seconds <= 300) return 0;
  return -5;
}

function externalValue(
  source: Record<string, ExternalMetricValues>,
  agent: string,
  metric: ExternalMetricName
) {
  const value = source[agent]?.[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default function KpiSalaryPage() {
  const [availableMonths, setAvailableMonths] = useState<GoogleScheduleMonth[]>([]);
  const [savedSnapshots, setSavedSnapshots] = useState<SalarySnapshot[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [parsed, setParsed] = useState<ParsedSchedule>(emptyParsed);
  const [liveKpi, setLiveKpi] = useState<Record<string, LiveKpi>>({});
  const [sheetPoints, setSheetPoints] = useState<Record<string, ExternalMetricValues>>({});
  const [status, setStatus] = useState("Ready");
  const [loadingKpi, setLoadingKpi] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  async function loadSnapshots() {
    const { data, error } = await getSalarySnapshots();
    if (error) {
      setStatus(`Snapshots load error: ${error.message}`);
      return;
    }
    setSavedSnapshots(data ?? []);
  }

  async function loadAgentMappings() {
    const response = await fetch("/api/agent-mappings", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Failed to load Agent Mapping");

    const mappings = Array.isArray(json.data) ? (json.data as AgentMapping[]) : [];
    return new Map(
      mappings.map((item) => [item.schedule_name.trim(), item.email.trim().toLowerCase()])
    );
  }

  async function loadGoogleSchedule(monthKey: string, allowFallback = true) {
    if (!monthKey) return;

    setSelectedMonth(monthKey);
    setLiveKpi({});
    setSheetPoints({});
    setStatus("Loading Google Schedule...");

    try {
      const response = await fetch(
        `/api/google-sheets/schedule?month=${encodeURIComponent(monthKey)}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as GoogleScheduleResponse;

      const months = Array.isArray(data.availableMonths) ? data.availableMonths : [];
      if (months.length > 0) setAvailableMonths(months);

      if (!response.ok || !data.ok) {
        if (allowFallback && months.length > 0 && months[0].monthKey !== monthKey) {
          await loadGoogleSchedule(months[0].monthKey, false);
          return;
        }
        throw new Error(data.error || "Google Schedule load error");
      }

      const mappings = await loadAgentMappings();
      const agents = Array.isArray(data.agents) ? data.agents : [];
      const days = Array.isArray(data.days) ? data.days : [];
      const scheduleRows = data.rows ?? {};

      const agentDetails = Object.fromEntries(
        agents.map((agent) => [
          agent,
          { name: agent, label: agent, email: mappings.get(agent) || null },
        ])
      );

      setParsed({ agents, agentDetails, days, rows: scheduleRows });

      const missing = agents.filter((agent) => !mappings.get(agent));
      setStatus(
        missing.length
          ? `Schedule loaded. Map agents first: ${missing.join(", ")}`
          : `Google Schedule loaded: ${data.sheetTitle || monthKey}`
      );
    } catch (error) {
      setParsed(emptyParsed);
      setStatus(error instanceof Error ? error.message : "Google Schedule load error");
    }
  }

  async function loadKpi() {
    if (!selectedMonth || parsed.agents.length === 0) return;

    const missingMappings = parsed.agents.filter(
      (agent) => !parsed.agentDetails?.[agent]?.email
    );
    if (missingMappings.length) {
      setStatus(`Map agents first: ${missingMappings.join(", ")}`);
      return;
    }

    const agents = parsed.agents
      .map((agent) => parsed.agentDetails?.[agent])
      .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent?.email));

    const { from, to } = getMonthRange(selectedMonth);

    setLoadingKpi(true);
    setLiveKpi({});
    setSheetPoints({});
    setStatus("Loading KPI data...");

    const errors: string[] = [];
    const warnings: string[] = [];

    // 1) LiveChat metrics load independently.
    // A LiveChat 401/500 must NOT block the agent Google KPI documents.
    try {
      const response = await fetch(
        `/api/livechat/agent-kpi?from=${from}&to=${to}&agents=${encodeURIComponent(
          agents.map((a) => a.email).join(",")
        )}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "LiveChat KPI API error");
      }

      setLiveKpi(data.agents || {});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "LiveChat KPI load error";
      errors.push(`LiveChat: ${message}`);
    }

    // 2) Personal Google KPI documents load independently.
    // The API reads ONLY the "Calculation" tab and ONLY the 5 exact metric names.
    try {
      const sheetResponse = await fetch("/api/google-sheets/agent-kpi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: selectedMonth,
          agents: parsed.agents,
        }),
        cache: "no-store",
      });

      const sheetData = (await sheetResponse.json()) as AgentKpiSheetResponse;

      if (!sheetResponse.ok || !sheetData.ok) {
        throw new Error(sheetData.error || "Personal KPI documents load error");
      }

      setSheetPoints(sheetData.agents || {});

      if (sheetData.missingDocuments?.length) {
        warnings.push(`no KPI document: ${sheetData.missingDocuments.join(", ")}`);
      }

      const metricWarnings = Object.entries(sheetData.missingMetrics || {})
        .filter(([, metrics]) => metrics.length > 0)
        .map(([agent, metrics]) => `${agent}: ${metrics.join(", ")}`);

      if (metricWarnings.length) {
        warnings.push(`missing metrics — ${metricWarnings.join(" | ")}`);
      }

      const documentErrors = Object.entries(sheetData.errors || {});
      if (documentErrors.length) {
        warnings.push(
          `document errors — ${documentErrors
            .map(([agent, message]) => `${agent}: ${message}`)
            .join(" | ")}`
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Personal KPI documents load error";
      errors.push(`Google KPI: ${message}`);
    }

    if (errors.length === 0 && warnings.length === 0) {
      setStatus("All KPI data loaded");
    } else {
      const parts = [...errors, ...warnings];
      setStatus(`Loaded with issues — ${parts.join(" ; ")}`);
    }

    setLoadingKpi(false);
  }

  const rows: Row[] = useMemo(() => {
    return parsed.agents.map((agent) => {
      const details = parsed.agentDetails?.[agent];
      const email = details?.email?.toLowerCase() || "";
      const shifts = parsed.rows[agent] ?? [];
      const cycleOffset = inferBaseCycleOffset(shifts);

      let totalHours = 0;
      let workedDays = 0;

      shifts.forEach((shift, index) => {
        const expectedBaseShift = getExpectedBaseShift(index, cycleOffset);
        const hours = getShiftHours(shift, expectedBaseShift);
        const shiftHours = hours.day + hours.night;
        totalHours += shiftHours;
        if (shiftHours > 0) workedDays += 1;
      });

      const api = liveKpi[email] || {};
      const csatRaw = String(api.csat ?? "").replace("%", "").trim();
      const csat = csatRaw ? finiteNumber(csatRaw) : null;
      const frtChats = finiteNumber(api.frtChats);
      const frtEmails = finiteNumber(api.frtEmails);
      const art = finiteNumber(api.art);
      const chats = finiteNumber(api.chats) ?? 0;

      const csatPoints = getCsatPoints(csat);
      const frtChatPoints = getFrtChatPoints(frtChats);
      const frtEmailPoints = getFrtEmailPoints(frtEmails);
      const artPoints = getArtPoints(art);

      const escalationPoints = externalValue(sheetPoints, agent, "Escalation / Follow-up");
      const trustpilotPoints = externalValue(sheetPoints, agent, "Trustpilot Reviews");
      const qualityCardPoints = externalValue(sheetPoints, agent, "Quality Card");
      const vipServicePoints = externalValue(sheetPoints, agent, "VIP Service");
      const vipFrtChatsPoints = externalValue(sheetPoints, agent, "VIP FRT Chats");

      const totalKpiPoints =
        csatPoints +
        frtChatPoints +
        frtEmailPoints +
        artPoints +
        escalationPoints +
        trustpilotPoints +
        qualityCardPoints +
        vipServicePoints +
        vipFrtChatsPoints;

      const kpiPercent = Math.max(0, Math.min(KPI_MAX_POINTS, totalKpiPoints));
      const baseSalary = roundMoney(totalHours * HOURLY_RATE);
      const kpiBonus = roundMoney(kpiPercent * KPI_BONUS_PER_POINT);
      const finalSalary = roundMoney(baseSalary + kpiBonus);

      return {
        agent,
        email,
        workedDays,
        totalHours,
        chats,
        csat,
        frtChats,
        frtEmails,
        art,
        csatPoints,
        frtChatPoints,
        frtEmailPoints,
        artPoints,
        escalationPoints,
        trustpilotPoints,
        qualityCardPoints,
        vipServicePoints,
        vipFrtChatsPoints,
        totalKpiPoints,
        kpiPercent,
        baseSalary,
        kpiBonus,
        finalSalary,
      };
    });
  }, [parsed, liveKpi, sheetPoints]);

  const totals: Totals = useMemo(
    () => ({
      agents: rows.length,
      workedDays: rows.reduce((sum, row) => sum + row.workedDays, 0),
      totalHours: rows.reduce((sum, row) => sum + row.totalHours, 0),
      base: roundMoney(rows.reduce((sum, row) => sum + row.baseSalary, 0)),
      bonus: roundMoney(rows.reduce((sum, row) => sum + row.kpiBonus, 0)),
      final: roundMoney(rows.reduce((sum, row) => sum + row.finalSalary, 0)),
    }),
    [rows]
  );

  async function handleSaveMonth() {
    if (!selectedMonth || rows.length === 0) {
      setStatus("Nothing to save");
      return;
    }

    setSavingSnapshot(true);
    setStatus("Saving salary snapshot...");
    const title =
      availableMonths.find((item) => item.monthKey === selectedMonth)?.title ?? selectedMonth;

    const { error } = await saveSalarySnapshot({
      month_key: selectedMonth,
      title,
      rows,
      totals,
    });

    if (error) {
      setStatus(`Save error: ${error.message}`);
      setSavingSnapshot(false);
      return;
    }

    setStatus("Salary snapshot saved");
    setSavingSnapshot(false);
    await loadSnapshots();
  }

  async function handleDeleteSnapshot(monthKey: string) {
    const ok = confirm(`Delete salary snapshot for ${monthKey}?`);
    if (!ok) return;

    setStatus("Deleting salary snapshot...");
    const { error } = await deleteSalarySnapshot(monthKey);
    if (error) {
      setStatus(`Delete error: ${error.message}`);
      return;
    }

    setStatus("Salary snapshot deleted");
    await loadSnapshots();
  }

  useEffect(() => {
    loadGoogleSchedule(getCurrentMonthKey(), true);
    loadSnapshots();
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <PageHeader
          eyebrow="Operations"
          title="KPI & Salary"
          description="Schedule comes directly from the SportBet Google Schedule. Base salary is Total Hours × $5.5; KPI combines LiveChat metrics with the agent's personal KPI document."
        />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/40">
              Schedule month
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => loadGoogleSchedule(e.target.value, false)}
              className="h-12 rounded-2xl border border-white/10 bg-[#091426] px-4 text-white outline-none"
            >
              {availableMonths.length === 0 ? (
                <option value={selectedMonth || ""}>{selectedMonth || "Loading months..."}</option>
              ) : (
                availableMonths.map((item) => (
                  <option key={item.monthKey} value={item.monthKey}>
                    {item.title}
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            onClick={() => selectedMonth && loadGoogleSchedule(selectedMonth, false)}
            disabled={!selectedMonth}
            className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 font-semibold text-white/70 hover:bg-white/[0.07] disabled:opacity-40"
          >
            <RefreshCw size={16} />
            Refresh Schedule
          </button>

          <button
            onClick={loadKpi}
            disabled={loadingKpi || parsed.agents.length === 0}
            className="h-12 rounded-2xl border border-sb-green/30 bg-sb-green/10 px-6 font-semibold text-sb-green hover:bg-sb-green/15 disabled:opacity-40"
          >
            {loadingKpi ? "Loading..." : "Load KPI"}
          </button>

          <button
            onClick={handleSaveMonth}
            disabled={savingSnapshot || rows.length === 0}
            className="h-12 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-6 font-semibold text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-40"
          >
            {savingSnapshot ? "Saving..." : "Save Month"}
          </button>

          <div className="text-sm text-white/45">{status}</div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard title="Agents" value={totals.agents} icon={<Users size={20} />} />
        <StatCard title="Worked Days" value={totals.workedDays} icon={<CalendarDays size={20} />} />
        <StatCard title="Total Hours" value={`${totals.totalHours}h`} icon={<Clock3 size={20} />} />
        <StatCard title="Base Salary" value={`$${totals.base}`} icon={<CircleDollarSign size={20} />} />
        <StatCard title="KPI Bonus" value={`$${totals.bonus}`} icon={<CircleDollarSign size={20} />} />
        <StatCard title="Final Payroll" value={`$${totals.final}`} icon={<CircleDollarSign size={20} />} />
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold text-white">Agent Salary Table</h2>
        <div className="overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-max w-full text-sm">
            <thead className="bg-white/[0.04] text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">Agent</th>
                <th>Worked Days</th>
                <th>Total Hours</th>
                <th>Base Salary</th>
                <th>KPI Points</th>
                <th>KPI %</th>
                <th>Bonus</th>
                <th>Final</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-white/40">
                    No KPI data available
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.agent} className="border-t border-white/10">
                    <td className="px-4 py-3 font-semibold text-white">{row.agent}</td>
                    <td className="text-center text-white/70">{row.workedDays}</td>
                    <td className="text-center text-white/70">{row.totalHours}h</td>
                    <td className="text-center text-white/70">${row.baseSalary}</td>
                    <td className="text-center"><KpiBadge value={row.totalKpiPoints} /></td>
                    <td className="text-center font-semibold text-sb-green">{row.kpiPercent}%</td>
                    <td className="text-center font-bold text-emerald-300">+${row.kpiBonus}</td>
                    <td className="text-center font-black text-yellow-300">${row.finalSalary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold text-white">KPI Points Breakdown</h2>
        <div className="overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-max w-full text-sm">
            <thead className="bg-white/[0.04] text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">Agent</th>
                <th>CSAT</th>
                <th>FRT Chats</th>
                <th>FRT Emails</th>
                <th>ART Chats</th>
                <th>Escalation / Follow-up</th>
                <th>Trustpilot Reviews</th>
                <th>Quality Card</th>
                <th>VIP Service</th>
                <th>VIP FRT Chats</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.agent}-breakdown`} className="border-t border-white/10">
                  <td className="px-4 py-3 font-semibold text-white">{row.agent}</td>
                  <Metric value={row.csat === null ? "No data" : `${row.csat}%`} points={row.csatPoints} />
                  <Metric value={row.frtChats === null ? "No data" : `${row.frtChats}s`} points={row.frtChatPoints} />
                  <Metric value={row.frtEmails === null ? "No data" : `${row.frtEmails}m`} points={row.frtEmailPoints} />
                  <Metric value={row.art === null ? "No data" : `${row.art}s`} points={row.artPoints} />
                  <ImportedPoints value={sheetPoints[row.agent]?.["Escalation / Follow-up"]} />
                  <ImportedPoints value={sheetPoints[row.agent]?.["Trustpilot Reviews"]} />
                  <ImportedPoints value={sheetPoints[row.agent]?.["Quality Card"]} />
                  <ImportedPoints value={sheetPoints[row.agent]?.["VIP Service"]} />
                  <ImportedPoints value={sheetPoints[row.agent]?.["VIP FRT Chats"]} />
                  <td className="text-center font-black text-yellow-300">{row.totalKpiPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold text-white">Saved Salary Snapshots</h2>
        <div className="space-y-4">
          {savedSnapshots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40">
              No saved salary snapshots yet.
            </div>
          ) : (
            savedSnapshots.map((snapshot) => {
              const snapshotRows = snapshot.rows as Row[];
              const snapshotTotals = snapshot.totals as Totals;

              return (
                <details key={snapshot.month_key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <summary className="flex cursor-pointer items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-white">{snapshot.title}</div>
                      <div className="mt-1 text-xs text-white/40">
                        {snapshot.month_key} · {snapshotRows.length} agents · Payroll ${snapshotTotals?.final ?? 0}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleDeleteSnapshot(snapshot.month_key);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/15"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </summary>

                  <div className="mt-5 overflow-auto rounded-2xl border border-white/10">
                    <table className="min-w-max w-full text-sm">
                      <thead className="bg-white/[0.04] text-white/60">
                        <tr>
                          <th className="px-4 py-3 text-left">Agent</th>
                          <th>Days</th>
                          <th>Hours</th>
                          <th>Base</th>
                          <th>KPI %</th>
                          <th>Bonus</th>
                          <th>Final</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshotRows.map((row) => (
                          <tr key={`${snapshot.month_key}-${row.agent}`} className="border-t border-white/10">
                            <td className="px-4 py-3 font-semibold text-white">{row.agent}</td>
                            <td className="text-center text-white/70">{row.workedDays}</td>
                            <td className="text-center text-white/70">{row.totalHours}h</td>
                            <td className="text-center text-white/70">${row.baseSalary}</td>
                            <td className="text-center font-semibold text-sb-green">{row.kpiPercent}%</td>
                            <td className="text-center font-bold text-emerald-300">+${row.kpiBonus}</td>
                            <td className="text-center font-black text-yellow-300">${row.finalSalary}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

function ImportedPoints({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return <td className="px-4 py-3 text-center text-xs font-semibold text-white/35">No data</td>;
  }
  const color = value > 0 ? "text-emerald-300" : value < 0 ? "text-red-300" : "text-yellow-300";
  return <td className={`px-4 py-3 text-center font-semibold ${color}`}>{value} pts</td>;
}

function Metric({ value, points }: { value: string | number; points: number }) {
  const color = points > 0 ? "text-emerald-300" : points < 0 ? "text-red-300" : "text-yellow-300";
  return <td className={`px-4 py-3 text-center font-semibold ${color}`}>{value} / {points} pts</td>;
}

function KpiBadge({ value }: { value: number }) {
  const good = value >= 50;
  return (
    <span className={`inline-flex min-w-20 justify-center rounded-full border px-3 py-1 text-xs font-bold ${
      good
        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
        : "border-red-400/20 bg-red-400/10 text-red-300"
    }`}>
      {value}
    </span>
  );
}
