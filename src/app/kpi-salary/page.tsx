"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeEuro, MessageSquare, Moon, RefreshCw, Trash2, Users } from "lucide-react";

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

const DAY_RATE = 4;
const NIGHT_RATE = 6;
const KPI_MIN_POINTS = 51;
const KPI_MAX_BONUS = 100;

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
  return /^(?:vacation|vac|annual\s*leave|sick\s*leave)$/i.test(value.trim());
}

function getSimpleCycleShift(value: string): BaseCycleShift | null {
  const clean = value.trim();

  if (!clean || /^(?:OFF|DAY\s*OFF|O|-)$/i.test(clean)) return "OFF";
  if (/^[DEN]$/i.test(clean)) return clean.toUpperCase() as "D" | "E" | "N";

  // Leave, training, custom ranges and combined/extra shifts do not tell us
  // what the agent's underlying 3/2 shift should have been.
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

      if (observed === expected) {
        // Explicit D/E/N cells are stronger evidence than an empty OFF cell.
        score += observed === "OFF" ? 1 : 5;
      } else {
        score -= observed === "OFF" ? 1 : 4;
      }
    });

    // Prefer an offset backed by more usable cells when scores tie.
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

  // Vacation and Sick leave are paid only when the agent would normally
  // work according to the underlying D -> E -> N -> OFF -> OFF cycle.
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

function getCsatPoints(csat: number) {
  if (csat >= 90) return 10;
  if (csat >= 80) return 8;
  if (csat >= 70) return 5;
  if (csat >= 65) return 0;
  return -5;
}

function getFrtChatPoints(seconds: number) {
  if (seconds <= 15) return 10;
  if (seconds <= 20) return 8;
  if (seconds <= 25) return 7;
  if (seconds <= 31) return 5;
  if (seconds <= 40) return 1;
  if (seconds <= 50) return 0;
  if (seconds <= 60) return -2;
  return -5;
}

function getFrtEmailPoints(minutes: number) {
  if (minutes <= 0) return 0;
  if (minutes <= 30) return 10;
  if (minutes <= 35) return 8;
  if (minutes <= 40) return 6;
  if (minutes <= 45) return 5;
  if (minutes <= 50) return 3;
  if (minutes <= 55) return 2;
  if (minutes <= 60) return 1;
  return 0;
}

function getArtPoints(seconds: number) {
  if (seconds <= 121) return 5;
  if (seconds <= 181) return 2;
  if (seconds <= 301) return 0;
  return -5;
}

function getTrustpilotPoints(count: number) {
  if (count >= 100) return 5;
  if (count >= 80) return 4;
  if (count >= 50) return 3;
  if (count >= 20) return 2;
  if (count >= 1) return 1;
  return -5;
}

function getEscalationPoints(minutes: number) {
  if (minutes <= 0) return 0;
  if (minutes <= 10) return 10;
  if (minutes <= 15) return 8;
  if (minutes <= 30) return 5;
  if (minutes <= 45) return 2;
  if (minutes <= 60) return 0;
  if (minutes <= 120) return -2;
  return -5;
}

function getQualityCardPoints(score: number) {
  if (score >= 95) return 50;
  if (score >= 89) return 40;
  if (score >= 81) return 25;
  if (score >= 75) return 10;
  if (score >= 65) return 5;
  return 0;
}

type LiveKpi = {
  chats?: number;
  csat?: string;
  frtChats?: number;
  frtEmails?: number;
  art?: number;
  trustpilot?: number;
};

type Row = {
  agent: string;
  email: string;
  dayHours: number;
  nightHours: number;
  chats: number;
  csat: number;
  frtChats: number;
  frtEmails: number;
  art: number;
  trustpilot: number;
  escalation: number;
  qualityCard: number;
  baseSalary: number;
  csatPoints: number;
  frtChatPoints: number;
  frtEmailPoints: number;
  artPoints: number;
  trustpilotPoints: number;
  escalationPoints: number;
  qualityCardPoints: number;
  totalKpiPoints: number;
  kpiBonus: number;
  finalSalary: number;
};

type Totals = {
  agents: number;
  chats: number;
  base: number;
  bonus: number;
  final: number;
  dayHours: number;
  nightHours: number;
};

export default function KpiSalaryPage() {
  const [availableMonths, setAvailableMonths] = useState<GoogleScheduleMonth[]>([]);
  const [savedSnapshots, setSavedSnapshots] = useState<SalarySnapshot[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [parsed, setParsed] = useState<ParsedSchedule>(emptyParsed);
  const [liveKpi, setLiveKpi] = useState<Record<string, LiveKpi>>({});
  const [qualityScores, setQualityScores] = useState<Record<string, number | null>>({});
  const [escalationTimes, setEscalationTimes] = useState<Record<string, number | null>>({});
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

    if (!response.ok) {
      throw new Error(json.error || "Failed to load Agent Mapping");
    }

    const mappings = Array.isArray(json.data) ? (json.data as AgentMapping[]) : [];

    return new Map(
      mappings.map((item) => [
        item.schedule_name.trim(),
        item.email.trim().toLowerCase(),
      ])
    );
  }

  async function fetchGoogleSchedule(
    monthKey: string,
    allowFallback = true
  ): Promise<{ monthKey: string; parsed: ParsedSchedule; title: string }> {
    const response = await fetch(
      `/api/google-sheets/schedule?month=${encodeURIComponent(monthKey)}&t=${Date.now()}`,
      { cache: "no-store" }
    );

    const data = (await response.json()) as GoogleScheduleResponse;
    const months = Array.isArray(data.availableMonths) ? data.availableMonths : [];

    if (months.length > 0) {
      setAvailableMonths(months);
    }

    if (!response.ok || !data.ok) {
      const fallback = months[0]?.monthKey;

      if (allowFallback && fallback && fallback !== monthKey) {
        return fetchGoogleSchedule(fallback, false);
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
        {
          name: agent,
          label: agent,
          email: mappings.get(agent) || null,
        },
      ])
    );

    return {
      monthKey: data.month || monthKey,
      title: data.sheetTitle || monthKey,
      parsed: {
        agents,
        agentDetails,
        days,
        rows: scheduleRows,
      },
    };
  }

  async function loadGoogleSchedule(monthKey: string, allowFallback = true) {
    if (!monthKey) return;

    setStatus("Loading Google Schedule...");

    try {
      const fresh = await fetchGoogleSchedule(monthKey, allowFallback);

      setSelectedMonth(fresh.monthKey);
      setParsed(fresh.parsed);
      setLiveKpi({});
      setQualityScores({});
      setEscalationTimes({});

      const missing = fresh.parsed.agents.filter(
        (agent) => !fresh.parsed.agentDetails?.[agent]?.email
      );

      if (missing.length > 0) {
        setStatus(`Schedule loaded. Map agents first: ${missing.join(", ")}`);
      } else {
        setStatus(`Google Schedule loaded: ${fresh.title}`);
      }
    } catch (error) {
      setParsed(emptyParsed);
      setStatus(
        error instanceof Error ? error.message : "Google Schedule load error"
      );
    }
  }

  async function loadInitialSchedule() {
    await loadGoogleSchedule(getCurrentMonthKey(), true);
  }

  async function loadKpi() {
    if (!selectedMonth) return;

    setLoadingKpi(true);
    setStatus("Refreshing Google Schedule...");

    try {
      const fresh = await fetchGoogleSchedule(selectedMonth, false);
      const freshParsed = fresh.parsed;

      setSelectedMonth(fresh.monthKey);
      setParsed(freshParsed);

      const missingMappings = freshParsed.agents.filter(
        (agent) => !freshParsed.agentDetails?.[agent]?.email
      );

      if (missingMappings.length > 0) {
        setLiveKpi({});
        setQualityScores({});
        setEscalationTimes({});
        setStatus(`Map agents first: ${missingMappings.join(", ")}`);
        return;
      }

      const agents = freshParsed.agents
        .map((agent) => freshParsed.agentDetails?.[agent])
        .filter(
          (agent): agent is NonNullable<typeof agent> => Boolean(agent?.email)
        );

      if (!agents.length) {
        setLiveKpi({});
        setQualityScores({});
        setEscalationTimes({});
        setStatus("No agent emails found in Google Schedule");
        return;
      }

      const { from, to } = getMonthRange(fresh.monthKey);

      setStatus("Loading LiveChat KPI...");

      const response = await fetch(
        `/api/livechat/agent-kpi?from=${from}&to=${to}&agents=${encodeURIComponent(
          agents.map((a) => a.email).join(",")
        )}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "KPI API error");
      }

      setLiveKpi(data.agents || {});
      setStatus("Loading Google Sheets KPI...");

      const sheetsResponse = await fetch("/api/google-sheets/kpi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: fresh.monthKey,
          agents: freshParsed.agents,
        }),
        cache: "no-store",
      });

      const sheetsData = await sheetsResponse.json();

      if (!sheetsResponse.ok || !sheetsData.ok) {
        throw new Error(sheetsData.error || "Google Sheets KPI error");
      }

      const nextQuality: Record<string, number | null> = {};
      const nextEscalation: Record<string, number | null> = {};

      freshParsed.agents.forEach((agent) => {
        const sheetAgent = sheetsData.agents?.[agent];

        nextQuality[agent] =
          typeof sheetAgent?.quality === "number" ? sheetAgent.quality : null;

        nextEscalation[agent] =
          typeof sheetAgent?.escalation === "number"
            ? sheetAgent.escalation
            : null;
      });

      setQualityScores(nextQuality);
      setEscalationTimes(nextEscalation);
      setStatus(
        `Fresh Google Schedule + LiveChat + HelpDesk + KPI loaded (${fresh.title})`
      );
    } catch (error) {
      setLiveKpi({});
      setQualityScores({});
      setEscalationTimes({});
      setStatus(error instanceof Error ? error.message : "KPI load error");
    } finally {
      setLoadingKpi(false);
    }
  }

  const rows: Row[] = useMemo(() => {
    return parsed.agents.map((agent) => {
      const details = parsed.agentDetails?.[agent];
      const email = details?.email?.toLowerCase() || "";
      const shifts = parsed.rows[agent] ?? [];

      let dayHours = 0;
      let nightHours = 0;
      const cycleOffset = inferBaseCycleOffset(shifts);

      shifts.forEach((shift, index) => {
        const expectedBaseShift = getExpectedBaseShift(index, cycleOffset);
        const hours = getShiftHours(shift, expectedBaseShift);
        dayHours += hours.day;
        nightHours += hours.night;
      });

      const api = liveKpi[email] || {};
      const csat = Number(String(api.csat || "0").replace("%", ""));
      const frtChats = Number(api.frtChats || 0);
      const frtEmails = Math.round(Number(api.frtEmails || 0));
      const art = Number(api.art || 0);
      const trustpilot = Number(api.trustpilot || 0);
      const chats = Number(api.chats || 0);

      const escalationValue = escalationTimes[agent];
      const qualityValue = qualityScores[agent];
      const escalation = typeof escalationValue === "number" ? escalationValue : 0;
      const qualityCard = typeof qualityValue === "number" ? qualityValue : 0;

      const csatPoints = getCsatPoints(csat);
      const frtChatPoints = getFrtChatPoints(frtChats);
      const frtEmailPoints = getFrtEmailPoints(frtEmails);
      const artPoints = getArtPoints(art);
      const trustpilotPoints = getTrustpilotPoints(trustpilot);
      const escalationPoints = getEscalationPoints(escalation);
      const qualityCardPoints = getQualityCardPoints(qualityCard);

      const totalKpiPoints =
        csatPoints +
        frtChatPoints +
        frtEmailPoints +
        artPoints +
        trustpilotPoints +
        escalationPoints +
        qualityCardPoints;

      const baseSalary = dayHours * DAY_RATE + nightHours * NIGHT_RATE;
      const kpiBonus =
        totalKpiPoints >= KPI_MIN_POINTS
          ? Math.min(totalKpiPoints, KPI_MAX_BONUS)
          : 0;

      return {
        agent,
        email,
        dayHours,
        nightHours,
        chats,
        csat,
        frtChats,
        frtEmails,
        art,
        trustpilot,
        escalation,
        qualityCard,
        baseSalary,
        csatPoints,
        frtChatPoints,
        frtEmailPoints,
        artPoints,
        trustpilotPoints,
        escalationPoints,
        qualityCardPoints,
        totalKpiPoints,
        kpiBonus,
        finalSalary: baseSalary + kpiBonus,
      };
    });
  }, [parsed, liveKpi, qualityScores, escalationTimes]);

  const totals: Totals = useMemo(() => {
    return {
      agents: rows.length,
      chats: rows.reduce((sum, row) => sum + row.chats, 0),
      base: rows.reduce((sum, row) => sum + row.baseSalary, 0),
      bonus: rows.reduce((sum, row) => sum + row.kpiBonus, 0),
      final: rows.reduce((sum, row) => sum + row.finalSalary, 0),
      dayHours: rows.reduce((sum, row) => sum + row.dayHours, 0),
      nightHours: rows.reduce((sum, row) => sum + row.nightHours, 0),
    };
  }, [rows]);

  async function handleSaveMonth() {
    if (!selectedMonth || rows.length === 0) {
      setStatus("Nothing to save");
      return;
    }

    setSavingSnapshot(true);
    setStatus("Saving salary snapshot...");

    const title =
      availableMonths.find((item) => item.monthKey === selectedMonth)?.title ??
      selectedMonth;

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
    void loadInitialSchedule();
    void loadSnapshots();
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <PageHeader
          eyebrow="Operations"
          title="KPI & Salary"
          description="Schedule comes directly from Google Sheets. Load KPI always refreshes the latest schedule before recalculating Day, Night, Base and Final salary."
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
              className="h-12 rounded-2xl border border-white/10 bg-[#080B12] px-4 text-white outline-none"
            >
              {availableMonths.length === 0 ? (
                <option value={selectedMonth || ""}>
                  {selectedMonth || "Loading months..."}
                </option>
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
            onClick={() =>
              selectedMonth && loadGoogleSchedule(selectedMonth, false)
            }
            disabled={!selectedMonth || loadingKpi}
            className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 font-semibold text-white/70 hover:bg-white/[0.07] disabled:opacity-40"
          >
            <RefreshCw size={16} />
            Refresh Schedule
          </button>

          <button
            onClick={loadKpi}
            disabled={loadingKpi || !selectedMonth}
            className="h-12 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-6 font-semibold text-cyan-300 hover:bg-cyan-400/15 disabled:opacity-40"
          >
            {loadingKpi ? "Refreshing + Loading..." : "Load KPI"}
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Agents" value={totals.agents} icon={<Users size={20} />} />
        <StatCard title="Chats" value={totals.chats} icon={<MessageSquare size={20} />} />
        <StatCard title="Base Salary" value={`${totals.base}€`} icon={<BadgeEuro size={20} />} />
        <StatCard title="Final Payroll" value={`${totals.final}€`} icon={<Moon size={20} />} />
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold text-white">Agent Salary Table</h2>

        <div className="overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-max w-full text-sm">
            <thead className="bg-white/[0.04] text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">Agent</th>
                <th>Day</th>
                <th>Night</th>
                <th>Chats</th>
                <th>Base</th>
                <th>Quality</th>
                <th>Escalation</th>
                <th>KPI Points</th>
                <th>Bonus</th>
                <th>Final</th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-white/40">
                    No KPI data available
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.agent} className="border-t border-white/10">
                    <td className="px-4 py-3 font-semibold text-white">{row.agent}</td>
                    <td className="text-center text-white/70">{row.dayHours}h</td>
                    <td className="text-center text-white/70">{row.nightHours}h</td>
                    <td className="text-center font-semibold text-cyan-300">{row.chats}</td>
                    <td className="text-center text-white/70">{row.baseSalary}€</td>

                    <td className="text-center">
                      <ImportedValue value={qualityScores[row.agent]} suffix="%" />
                    </td>

                    <td className="text-center">
                      <ImportedValue value={escalationTimes[row.agent]} suffix="m" />
                    </td>

                    <td className="text-center">
                      <Badge good={row.totalKpiPoints >= KPI_MIN_POINTS}>
                        {row.totalKpiPoints}
                      </Badge>
                    </td>

                    <td className="text-center font-bold text-emerald-300">
                      +{row.kpiBonus}€
                    </td>

                    <td className="text-center font-black text-yellow-300">
                      {row.finalSalary}€
                    </td>
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
                <th>ART</th>
                <th>Trustpilot</th>
                <th>Escalation</th>
                <th>Quality</th>
                <th>Total</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={`${row.agent}-breakdown`} className="border-t border-white/10">
                  <td className="px-4 py-3 font-semibold text-white">{row.agent}</td>
                  <Metric value={`${row.csat}%`} points={row.csatPoints} />
                  <Metric value={`${row.frtChats}s`} points={row.frtChatPoints} />
                  <Metric value={`${row.frtEmails}m`} points={row.frtEmailPoints} />
                  <Metric value={`${row.art}s`} points={row.artPoints} />
                  <Metric value={row.trustpilot} points={row.trustpilotPoints} />
                  <Metric
                    value={escalationTimes[row.agent] == null ? "No data" : `${row.escalation}m`}
                    points={row.escalationPoints}
                  />
                  <Metric
                    value={qualityScores[row.agent] == null ? "No data" : row.qualityCard}
                    points={row.qualityCardPoints}
                  />
                  <td className="text-center font-black text-yellow-300">
                    {row.totalKpiPoints}
                  </td>
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
                <details
                  key={snapshot.month_key}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-white">{snapshot.title}</div>
                      <div className="mt-1 text-xs text-white/40">
                        {snapshot.month_key} · {snapshotRows.length} agents · Payroll{" "}
                        {snapshotTotals?.final ?? 0}€
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
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </summary>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard title="Agents" value={snapshotTotals?.agents ?? 0} icon={<Users size={20} />} />
                    <StatCard title="Chats" value={snapshotTotals?.chats ?? 0} icon={<MessageSquare size={20} />} />
                    <StatCard title="Base Salary" value={`${snapshotTotals?.base ?? 0}€`} icon={<BadgeEuro size={20} />} />
                    <StatCard title="Final Payroll" value={`${snapshotTotals?.final ?? 0}€`} icon={<Moon size={20} />} />
                  </div>

                  <div className="mt-5 overflow-auto rounded-2xl border border-white/10">
                    <table className="min-w-max w-full text-sm">
                      <thead className="bg-white/[0.04] text-white/60">
                        <tr>
                          <th className="px-4 py-3 text-left">Agent</th>
                          <th>Day</th>
                          <th>Night</th>
                          <th>Chats</th>
                          <th>Base</th>
                          <th>KPI Points</th>
                          <th>Bonus</th>
                          <th>Final</th>
                        </tr>
                      </thead>

                      <tbody>
                        {snapshotRows.map((row) => (
                          <tr key={`${snapshot.month_key}-${row.agent}`} className="border-t border-white/10">
                            <td className="px-4 py-3 font-semibold text-white">{row.agent}</td>
                            <td className="text-center text-white/70">{row.dayHours}h</td>
                            <td className="text-center text-white/70">{row.nightHours}h</td>
                            <td className="text-center font-semibold text-cyan-300">{row.chats}</td>
                            <td className="text-center text-white/70">{row.baseSalary}€</td>
                            <td className="text-center">
                              <Badge good={row.totalKpiPoints >= KPI_MIN_POINTS}>
                                {row.totalKpiPoints}
                              </Badge>
                            </td>
                            <td className="text-center font-bold text-emerald-300">+{row.kpiBonus}€</td>
                            <td className="text-center font-black text-yellow-300">{row.finalSalary}€</td>
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

function ImportedValue({
  value,
  suffix = "",
}: {
  value: number | null | undefined;
  suffix?: string;
}) {
  if (value == null) {
    return <span className="text-xs font-semibold text-white/35">No data</span>;
  }

  return (
    <span className="inline-flex min-w-20 justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 font-semibold text-cyan-300">
      {value}{suffix}
    </span>
  );
}

function Metric({ value, points }: { value: string | number; points: number }) {
  const color =
    points > 0 ? "text-emerald-300" : points < 0 ? "text-red-300" : "text-yellow-300";

  return (
    <td className={`px-4 py-3 text-center font-semibold ${color}`}>
      {value} / {points} pts
    </td>
  );
}

function Badge({
  good,
  children,
}: {
  good: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex min-w-20 justify-center rounded-full border px-3 py-1 text-xs font-bold ${
        good
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
          : "border-red-400/20 bg-red-400/10 text-red-300"
      }`}
    >
      {children}
    </span>
  );
}
