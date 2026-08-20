"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Moon,
  RefreshCw,
  Users,
} from "lucide-react";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { getAgentMappings, type AgentScheduleMapping } from "@/services/agentMappingService";
import { saveSchedule } from "@/services/scheduleService";
import {
  calculateScheduleStats,
  parseShiftValue,
  type ParsedSchedule,
  type ScheduleStats,
} from "@/lib/schedule/parseSchedule";

type GoogleScheduleResponse = {
  ok: boolean;
  error?: string;
  month?: string;
  sheetTitle?: string;
  agents?: string[];
  days?: string[];
  dayLabels?: string[];
  rows?: Record<string, string[]>;
  availableMonths?: { title: string; monthKey: string }[];
  sourceUrl?: string;
};

const emptyParsed: ParsedSchedule = {
  agents: [],
  agentDetails: {},
  days: [],
  rows: {},
};

const emptyStats: ScheduleStats = {
  agents: 0,
  days: 0,
  dayHours: 0,
  nightHours: 0,
  totalHours: 0,
  workingCells: 0,
  offCells: 0,
  leaveCells: 0,
  trainingCells: 0,
  invalidCells: 0,
};

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getCellClass(value: string) {
  const shift = parseShiftValue(value);
  if (!value.trim()) return "bg-white/[0.02] text-white/25";
  if (!shift.valid) return "border-red-400/50 bg-red-400/10 text-red-200";
  if (shift.status === "sick_leave") return "border-orange-400/30 bg-orange-400/10 text-orange-200";
  if (shift.status === "vacation") return "border-violet-400/30 bg-violet-400/10 text-violet-200";
  if (shift.status === "training") return "border-blue-400/30 bg-blue-400/10 text-blue-200";
  if (shift.nightHours > 0) return "border-indigo-400/30 bg-indigo-400/10 text-indigo-200";
  return "border-amber-400/30 bg-amber-400/10 text-amber-100";
}

export default function SchedulePage() {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [parsed, setParsed] = useState<ParsedSchedule>(emptyParsed);
  const [stats, setStats] = useState<ScheduleStats>(emptyStats);
  const [availableMonths, setAvailableMonths] = useState<{ title: string; monthKey: string }[]>([]);
  const [dayLabels, setDayLabels] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sheetTitle, setSheetTitle] = useState("");
  const [status, setStatus] = useState("Loading Google Schedule...");
  const [loading, setLoading] = useState(false);
  const [unmapped, setUnmapped] = useState<string[]>([]);

  const invalidCells = useMemo(() => {
    const result: { agent: string; day: string; value: string }[] = [];
    parsed.agents.forEach((agent) => {
      parsed.days.forEach((day, index) => {
        const value = parsed.rows[agent]?.[index] ?? "";
        if (value && !parseShiftValue(value).valid) result.push({ agent, day, value });
      });
    });
    return result;
  }, [parsed]);

  async function loadMonth(requestedMonth: string) {
    setLoading(true);
    setStatus("Reading Google Schedule...");

    try {
      const response = await fetch(`/api/google-sheets/schedule?month=${requestedMonth}`, { cache: "no-store" });
      const json = (await response.json()) as GoogleScheduleResponse;

      setAvailableMonths(json.availableMonths ?? []);

      if (!json.ok) {
        const fallback = json.availableMonths?.[0]?.monthKey;
        if (fallback && fallback !== requestedMonth) {
          setMonthKey(fallback);
          setLoading(false);
          await loadMonth(fallback);
          return;
        }
        throw new Error(json.error || "Failed to read Google Schedule");
      }

      const { data: mappingData, error: mappingError } = await getAgentMappings();
      if (mappingError) throw new Error(`Agent Mapping: ${mappingError.message}`);

      const mappings = (mappingData ?? []) as AgentScheduleMapping[];
      const mappingMap = new Map(mappings.map((item) => [item.schedule_name, item.email]));
      const agents = json.agents ?? [];
      const missing = agents.filter((name) => !mappingMap.get(name));
      setUnmapped(missing);

      const nextParsed: ParsedSchedule = {
        agents,
        days: json.days ?? [],
        rows: json.rows ?? {},
        agentDetails: Object.fromEntries(
          agents.map((name) => {
            const email = mappingMap.get(name) ?? null;
            return [name, { name, email, label: email ? `${name} / ${email}` : name }];
          })
        ),
      };

      const nextStats = calculateScheduleStats(nextParsed);
      const nextInvalidCount = agents.reduce((total, agent) => {
        return total + (nextParsed.rows[agent] ?? []).filter((value) => value && !parseShiftValue(value).valid).length;
      }, 0);

      setParsed(nextParsed);
      setStats(nextStats);
      setDayLabels(json.dayLabels ?? json.days ?? []);
      setSourceUrl(json.sourceUrl ?? "");
      setSheetTitle(json.sheetTitle ?? requestedMonth);
      setMonthKey(requestedMonth);

      if (missing.length === 0 && agents.length > 0 && nextInvalidCount === 0) {
        const { error: syncError } = await saveSchedule({
          month_key: requestedMonth,
          title: json.sheetTitle ?? requestedMonth,
          raw_text: null,
          parsed_data: nextParsed,
          stats: nextStats,
        });

        setStatus(syncError ? `Google loaded, SupportOS sync failed: ${syncError.message}` : "Google Schedule loaded and synced");
      } else if (missing.length > 0) {
        setStatus(`Google Schedule loaded · ${missing.length} unmapped agent(s)`);
      } else {
        setStatus("Google Schedule loaded");
      }
    } catch (error) {
      setParsed(emptyParsed);
      setStats(emptyStats);
      setStatus(error instanceof Error ? error.message : "Schedule load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMonth(currentMonthKey());
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <PageHeader
          eyebrow="Operations"
          title="Schedule"
          description="Read-only view of the Support Team Google Schedule. Edit the source spreadsheet; SupportOS reads it directly and links names to LiveChat emails through Agent Mapping."
        />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/40">Schedule month</label>
              <select
                value={monthKey}
                onChange={(event) => loadMonth(event.target.value)}
                className="h-12 rounded-2xl border border-white/10 bg-[#080B12] px-4 text-white outline-none"
              >
                {availableMonths.length === 0 && <option value={monthKey}>{monthKey}</option>}
                {availableMonths.map((month) => (
                  <option key={month.monthKey} value={month.monthKey}>{month.title}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => loadMonth(monthKey)}
              disabled={loading}
              className="flex h-12 items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-5 font-semibold text-cyan-200 disabled:opacity-50"
            >
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} /> Refresh
            </button>

            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 font-semibold text-white/70 hover:bg-white/[0.06]"
              >
                <ExternalLink size={17} /> Open Google Sheet
              </a>
            )}
          </div>

          <div className="text-right">
            <div className="text-sm text-white/55">{status}</div>
            <div className="mt-1 text-xs text-white/30">Source tab: {sheetTitle || "—"}</div>
          </div>
        </div>
      </Card>

      {unmapped.length > 0 && (
        <Card className="border border-red-400/20 bg-red-400/[0.04] p-5">
          <div className="flex gap-3 text-red-200">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Agent Mapping required</div>
              <p className="mt-1 text-sm text-red-200/70">
                These names exist in Google Schedule but have no linked email: <b>{unmapped.join(", ")}</b>. Link them in Agent Mapping before KPI or salary uses this schedule.
              </p>
              <a href="/agent-mapping" className="mt-3 inline-block text-sm font-semibold text-red-100 underline underline-offset-4">Open Agent Mapping</a>
            </div>
          </div>
        </Card>
      )}

      {invalidCells.length > 0 && (
        <Card className="border border-amber-400/20 bg-amber-400/[0.04] p-5">
          <div className="flex gap-3 text-amber-200">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Unknown schedule values</div>
              <p className="mt-1 text-sm text-amber-200/70">
                {invalidCells.slice(0, 6).map((item) => `${item.agent}: ${item.value}`).join(" · ")}
                {invalidCells.length > 6 ? ` · +${invalidCells.length - 6} more` : ""}
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Agents" value={stats.agents} icon={<Users size={20} />} />
        <StatCard title="Days" value={stats.days} icon={<CalendarDays size={20} />} />
        <StatCard title="Day hours" value={`${stats.dayHours}h`} icon={<Clock size={20} />} />
        <StatCard title="Night hours" value={`${stats.nightHours}h`} icon={<Moon size={20} />} />
        <StatCard title="Total hours" value={`${stats.totalHours}h`} icon={<CheckCircle2 size={20} />} />
      </div>

      <Card className="p-6">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-white">Google Schedule</h2>
          <p className="mt-1 text-sm text-white/40">Read-only. Any change must be made in the Google Sheet and then refreshed here.</p>
        </div>

        {parsed.agents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-sm text-white/40">No schedule data loaded.</div>
        ) : (
          <div className="overflow-auto rounded-2xl border border-white/10">
            <table className="min-w-max border-collapse text-sm">
              <thead>
                <tr className="bg-white/[0.04]">
                  <th className="sticky left-0 z-20 min-w-[220px] border-r border-white/10 bg-[#10141D] px-3 py-3 text-left text-white">Agent</th>
                  {parsed.days.map((day, index) => (
                    <th key={`${day}-${index}`} className="min-w-[105px] border-r border-white/10 px-2 py-3 text-center text-xs text-white/60">
                      <div>{dayLabels[index] ?? day}</div>
                      <div className="mt-1 text-[10px] text-white/25">{day}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.agents.map((agent) => {
                  const details = parsed.agentDetails[agent];
                  return (
                    <tr key={agent} className="border-t border-white/10">
                      <td className="sticky left-0 z-10 border-r border-white/10 bg-[#10141D] px-3 py-2">
                        <div className="font-semibold text-white">{agent}</div>
                        <div className={`mt-1 text-[11px] ${details?.email ? "text-cyan-300/65" : "text-red-300"}`}>{details?.email ?? "Email not mapped"}</div>
                      </td>
                      {parsed.days.map((day, dayIndex) => {
                        const value = parsed.rows[agent]?.[dayIndex] ?? "";
                        return (
                          <td key={`${agent}-${day}-${dayIndex}`} className="border-r border-white/10 p-1">
                            <div className={`flex h-10 items-center justify-center rounded-lg border px-2 text-center text-xs font-semibold ${getCellClass(value)}`}>
                              {value || "—"}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
