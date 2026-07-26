"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Moon,
  Save,
  Trash2,
  Users,
} from "lucide-react";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import {
  deleteSchedule,
  getSchedule,
  getSchedules,
  saveSchedule,
  type Schedule,
} from "@/services/scheduleService";
import {
  calculateScheduleStats,
  parseScheduleText,
  parseShiftValue,
  serializeScheduleText,
  validateSchedule,
  type ParsedSchedule,
  type ScheduleStats,
} from "@/lib/schedule/parseSchedule";

const months = Array.from({ length: 36 }, (_, index) => {
  const date = new Date(2025, index, 1);
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    label: date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  };
});

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

const quickValues = [
  "D",
  "E",
  "N",
  "D+N",
  "D+E",
  "E+N",
  "Training",
  "Sick leave",
  "Vacation",
];

function getMonthLabel(monthKey: string) {
  return months.find((month) => month.key === monthKey)?.label ?? monthKey;
}

function getCellClass(value: string) {
  const shift = parseShiftValue(value);

  if (!value.trim()) return "bg-white/[0.02]";
  if (!shift.valid) return "border-red-400/60 bg-red-400/10 text-red-200";
  if (shift.status === "sick_leave") return "border-orange-400/30 bg-orange-400/10 text-orange-200";
  if (shift.status === "vacation") return "border-violet-400/30 bg-violet-400/10 text-violet-200";
  if (shift.status === "training") return "border-blue-400/30 bg-blue-400/10 text-blue-200";
  if (shift.nightHours > 0 && shift.dayHours > 0) return "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200";
  if (shift.nightHours > 0) return "border-indigo-400/30 bg-indigo-400/10 text-indigo-200";
  return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
}

export default function SchedulePage() {
  const [monthKey, setMonthKey] = useState("2026-07");
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParsedSchedule>(emptyParsed);
  const [savedSchedules, setSavedSchedules] = useState<Schedule[]>([]);
  const [status, setStatus] = useState("Ready");
  const [stats, setStats] = useState<ScheduleStats>(emptyStats);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(true);
  const [validationOpen, setValidationOpen] = useState(true);

  const issues = useMemo(
    () => validateSchedule(parsed, monthKey),
    [parsed, monthKey]
  );
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  async function loadSavedSchedules() {
    const { data, error } = await getSchedules();
    if (error) {
      setStatus(`Load error: ${error.message}`);
      return;
    }
    setSavedSchedules(data ?? []);
  }

  async function loadSchedule(selectedMonth: string) {
    setMonthKey(selectedMonth);
    setStatus("Loading schedule...");

    const { data, error } = await getSchedule(selectedMonth);
    if (error || !data) {
      setRawText("");
      setParsed(emptyParsed);
      setStats(emptyStats);
      setStatus("No saved schedule for this month");
      return;
    }

    const loadedParsed = data.parsed_data?.agents
      ? (data.parsed_data as ParsedSchedule)
      : parseScheduleText(data.raw_text ?? "");

    setParsed(loadedParsed);
    setRawText(serializeScheduleText(loadedParsed));
    setStats(calculateScheduleStats(loadedParsed));
    setStatus(`Loaded ${data.title}`);
  }

  function applyParsed(nextParsed: ParsedSchedule, nextStatus: string) {
    setParsed(nextParsed);
    setStats(calculateScheduleStats(nextParsed));
    setStatus(nextStatus);
  }

  function handleRawTextChange(value: string) {
    setRawText(value);
    applyParsed(parseScheduleText(value), "Schedule parsed automatically");
  }

  function updateCell(agent: string, dayIndex: number, value: string) {
    const nextRows = {
      ...parsed.rows,
      [agent]: [...(parsed.rows[agent] ?? [])],
    };
    nextRows[agent][dayIndex] = value;

    const nextParsed = { ...parsed, rows: nextRows };
    setRawText(serializeScheduleText(nextParsed));
    applyParsed(nextParsed, "Unsaved changes");
  }


  async function handleSave() {
    const parsedToSave = parsed.agents.length ? parsed : parseScheduleText(rawText);
    const validationIssues = validateSchedule(parsedToSave, monthKey);
    const blockingErrors = validationIssues.filter((issue) => issue.level === "error");

    if (blockingErrors.length) {
      setStatus(`Cannot save: ${blockingErrors.length} validation error(s)`);
      return;
    }

    setSaving(true);
    setStatus("Saving...");

    const normalizedRawText = serializeScheduleText(parsedToSave);
    const calculatedStats = calculateScheduleStats(parsedToSave);

    const { error } = await saveSchedule({
      month_key: monthKey,
      title: getMonthLabel(monthKey),
      raw_text: normalizedRawText,
      parsed_data: parsedToSave,
      stats: calculatedStats,
    });

    setSaving(false);

    if (error) {
      setStatus(`Save error: ${error.message}`);
      return;
    }

    setRawText(normalizedRawText);
    setParsed(parsedToSave);
    setStats(calculatedStats);
    setStatus("Saved successfully");
    await loadSavedSchedules();
  }

  async function handleDelete() {
    if (!confirm(`Delete schedule for ${getMonthLabel(monthKey)}?`)) return;

    setStatus("Deleting...");
    const { error } = await deleteSchedule(monthKey);

    if (error) {
      setStatus(`Delete error: ${error.message}`);
      return;
    }

    setRawText("");
    setParsed(emptyParsed);
    setStats(emptyStats);
    setStatus("Deleted");
    await loadSavedSchedules();
  }

  useEffect(() => {
    loadSavedSchedules();
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <PageHeader
          eyebrow="Operations"
          title="Schedule"
          description="Import the monthly Google Sheets schedule once. This validated grid becomes the shared source of truth for KPI, salary, breaks, and future reports."
        />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/40">
              Schedule month
            </label>
            <select
              value={monthKey}
              onChange={(event) => loadSchedule(event.target.value)}
              className="h-12 rounded-2xl border border-white/10 bg-[#080B12] px-4 text-white outline-none"
            >
              {months.map((month) => (
                <option key={month.key} value={month.key}>{month.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || errors.length > 0 || parsed.agents.length === 0}
            className="flex h-12 items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-6 font-semibold text-emerald-300 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={17} />
            {saving ? "Saving..." : "Save Schedule"}
          </button>

          <button
            onClick={handleDelete}
            className="flex h-12 items-center gap-2 rounded-2xl border border-red-400/30 bg-red-400/10 px-5 font-semibold text-red-300 hover:bg-red-400/15"
          >
            <Trash2 size={17} /> Delete
          </button>

          <div className="text-sm text-white/50">{status}</div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Editable schedule grid</h2>
            <p className="mt-1 text-sm text-white/40">Every edit immediately updates validation, totals, and the import text.</p>
          </div>
          <div className="text-xs text-white/40">
            Working: {stats.workingCells} · Leave: {stats.leaveCells} · Training: {stats.trainingCells}
          </div>
        </div>

        {parsed.agents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-sm text-white/40">Paste a schedule to generate the grid.</div>
        ) : (
          <div className="overflow-auto rounded-2xl border border-white/10">
            <table className="min-w-max border-collapse text-sm">
              <thead>
                <tr className="bg-white/[0.04]">
                  <th className="sticky left-0 z-20 min-w-[250px] border-r border-white/10 bg-[#10141D] px-3 py-3 text-left text-white">Agent / LiveChat email</th>
                  {parsed.days.map((day, index) => (
                    <th key={`${day}-${index}`} className="min-w-[118px] border-r border-white/10 px-3 py-3 text-center text-xs text-white/60">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.agents.map((agent) => {
                  const details = parsed.agentDetails[agent];
                  return (
                    <tr key={agent} className="border-t border-white/10">
                      <td className="sticky left-0 z-10 border-r border-white/10 bg-[#10141D] px-3 py-2">
                        <div className="font-semibold text-white">{details?.name ?? agent}</div>
                        <div className={`mt-1 text-[11px] ${details?.email ? "text-cyan-300/65" : "text-red-300"}`}>{details?.email ?? "Email missing"}</div>
                      </td>
                      {parsed.days.map((day, dayIndex) => {
                        const value = parsed.rows[agent]?.[dayIndex] ?? "";
                        const shift = parseShiftValue(value);
                        const tooltip = shift.valid
                          ? `${shift.dayHours} day h · ${shift.nightHours} night h · ${shift.totalHours} total h`
                          : `Unknown: ${shift.unknownParts.join(", ")}`;

                        return (
                          <td key={`${agent}-${day}-${dayIndex}`} className="border-r border-white/10 p-1">
                            <input
                              value={value}
                              title={tooltip}
                              onChange={(event) => updateCell(agent, dayIndex, event.target.value)}
                              className={`h-10 w-full rounded-lg border px-2 text-center text-xs outline-none focus:border-cyan-400/60 ${getCellClass(value)}`}
                            />
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Agents" value={stats.agents} icon={<Users size={20} />} />
        <StatCard title="Days" value={stats.days} icon={<CalendarDays size={20} />} />
        <StatCard title="Day hours" value={`${stats.dayHours}h`} icon={<Clock size={20} />} />
        <StatCard title="Night hours" value={`${stats.nightHours}h`} icon={<Moon size={20} />} />
        <StatCard title="Total hours" value={`${stats.totalHours}h`} icon={<CheckCircle2 size={20} />} />
      </div>

      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setImportOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left hover:bg-white/[0.02]"
        >
          <div>
            <h2 className="text-xl font-bold text-white">Import from Google Sheets</h2>
            <p className="mt-1 text-sm text-white/45">
              Paste or review the source table used to generate the schedule grid.
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60">
            {importOpen ? "Hide" : "Show"}
            {importOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </span>
        </button>

        {importOpen && (
          <div className="border-t border-white/10 px-6 pb-6 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="max-w-3xl text-sm text-white/45">
                Agent rows must use <b className="text-white/70">Name / LiveChat email</b>. Supported values include D, E, N, combined shifts, custom time ranges, Training, Sick leave, and Vacation.
              </p>
              <div className="flex max-w-xl flex-wrap gap-2">
                {quickValues.map((value) => (
                  <span key={value} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/55">{value}</span>
                ))}
              </div>
            </div>

            <textarea
              value={rawText}
              onChange={(event) => handleRawTextChange(event.target.value)}
              placeholder="Paste the monthly schedule from Google Sheets here..."
              className="mt-4 min-h-[220px] w-full rounded-2xl border border-white/10 bg-[#05070D] p-5 font-mono text-sm text-white outline-none placeholder:text-white/25 focus:border-cyan-400/40"
            />
          </div>
        )}
      </Card>

      {parsed.agents.length > 0 && (
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => setValidationOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left hover:bg-white/[0.02]"
          >
            <div>
              <h2 className="text-xl font-bold text-white">Validation</h2>
              <p className="mt-1 text-sm text-white/45">Errors block saving. Warnings can be reviewed before publication.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full bg-red-400/10 px-3 py-1 text-sm text-red-300">{errors.length} errors</span>
              <span className="rounded-full bg-amber-400/10 px-3 py-1 text-sm text-amber-300">{warnings.length} warnings</span>
              <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-sm text-emerald-300">{stats.invalidCells} invalid cells</span>
              <span className="ml-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60">
                {validationOpen ? "Hide" : "Show"}
                {validationOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </span>
            </div>
          </button>

          {validationOpen && (
            <div className="border-t border-white/10 px-6 pb-6 pt-5">
              {issues.length === 0 ? (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-300">
                  <CheckCircle2 size={18} /> Schedule is valid and ready to save.
                </div>
              ) : (
                <div className="max-h-52 space-y-2 overflow-auto">
                  {issues.map((issue, index) => (
                    <div key={`${issue.message}-${index}`} className={`flex gap-3 rounded-xl border p-3 text-sm ${issue.level === "error" ? "border-red-400/20 bg-red-400/5 text-red-200" : "border-amber-400/20 bg-amber-400/5 text-amber-200"}`}>
                      <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                      <div>
                        <div>{issue.message}</div>
                        {(issue.agent || issue.day || issue.value) && (
                          <div className="mt-1 text-xs opacity-60">{[issue.agent, issue.day, issue.value].filter(Boolean).join(" · ")}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="p-6">
        <h2 className="text-xl font-bold text-white">Saved schedules</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {savedSchedules.length === 0 ? (
            <div className="text-sm text-white/45">No saved schedules yet.</div>
          ) : (
            savedSchedules.map((schedule) => (
              <button
                key={schedule.id}
                onClick={() => loadSchedule(schedule.month_key)}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left hover:border-cyan-400/30 hover:bg-cyan-400/5"
              >
                <div className="font-semibold text-white">{schedule.title}</div>
                <div className="mt-1 text-xs text-white/40">{schedule.month_key}</div>
              </button>
            ))
          )}
        </div>
      </Card>
      <Card className="p-6">
        <div>
          <h2 className="text-xl font-bold text-white">Shift meanings and paid hours</h2>
          <p className="mt-1 text-sm text-white/45">These rules are used by the schedule totals and will be reused by KPI, salary, and break calculations.</p>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
          <div className="grid grid-cols-[140px_1fr_150px] gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/45">
            <div>Value</div>
            <div>Meaning</div>
            <div>Paid hours</div>
          </div>
          {[
            ["D", "Day shift, 08:00-16:00.", "8 day hours"],
            ["E", "Evening shift, 16:00-00:00.", "8 day hours"],
            ["N", "Night shift, 00:00-08:00.", "8 night hours"],
            ["D+N", "One full day shift plus one full night shift.", "8 day + 8 night"],
            ["D+E", "One full day shift plus one full evening shift.", "16 day hours"],
            ["E+N", "One full evening shift plus one full night shift.", "8 day + 8 night"],
            ["Training", "Paid working day used for agent training.", "8 day hours"],
            ["Sick leave", "Paid sick-leave day.", "8 day hours"],
            ["Vacation", "Paid vacation day.", "8 day hours"],
            ["Custom time", "Any valid interval such as 16:00-22:00 or 15:00-00:00. Hours are calculated from the exact interval.", "Calculated exactly"],
            ["Mixed value", "A preset shift plus a custom interval, for example N+22:00-00:00 or 22:30-00:00+N.", "Sum of all parts"],
            ["Empty / OFF / O / -", "The agent is not scheduled to work.", "0 hours"],
          ].map(([value, meaning, hours]) => (
            <div key={value} className="grid grid-cols-[140px_1fr_150px] gap-3 border-b border-white/10 px-4 py-3 text-sm last:border-b-0">
              <div className="font-semibold text-cyan-200">{value}</div>
              <div className="text-white/65">{meaning}</div>
              <div className="font-medium text-white">{hours}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
          <b>Day SM</b> and <b>B</b> are no longer supported schedule values. If either is entered, validation will mark the cell as invalid and block saving.
        </div>
      </Card>

    </div>
  );
}