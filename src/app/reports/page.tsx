"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, MessageSquare, Save, Trash2, X } from "lucide-react";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import {
  deleteSavedReport,
  getSavedReports,
  saveReport,
  type SavedReport,
} from "@/services/reportService";

type ReportType = "weekly" | "monthly";

type ProjectRow = {
  name: string;
  project: string;
  chats: number;
  missed: number;
  positive: number;
  negative: number;
  csat: number;
  avgChatDurationSec: number;
};

type TagRow = {
  tag: string;
  label: string;
  total: number;
  vip: number;
  regular: number;
  previousTotal: number;
  changePercent: number | null;
  changeLabel: string;
};

type ReportData = {
  ok: boolean;
  period: { from: string; to: string };
  project: string | null;
  summary: {
    totalChats: number;
    totalChatsFromDuration: number;
    totalChatsFromArchives: number;
    missedChats: number;
    avgChatDurationSec: number;
    totalChatTimeSec: number;
    csatPercent: number;
    positive: number;
    negative: number;
  };
  projects: ProjectRow[];
};

type TagReportData = {
  ok: boolean;
  rows: TagRow[];
};

type ProjectOption = {
  name: string;
  groupIds?: number[];
};

function today() {
  const date = new Date();
  return date.toISOString().slice(0, 10);
}

function sevenDaysAgo() {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return date.toISOString().slice(0, 10);
}

function currentMonthKey() {
  return today().slice(0, 7);
}

function monthLastDay(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function getMonthOptions() {
  const result: string[] = [];
  const now = new Date();

  for (let i = 0; i < 18; i++) {
    const item = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${item.getFullYear()}-${String(item.getMonth() + 1).padStart(2, "0")}`);
  }

  return result;
}

function formatSeconds(seconds: number) {
  const value = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function reportTitle(reportType: ReportType, from: string, to: string, project: string) {
  const scope = project === "All Projects" ? "All Projects" : project;
  if (reportType === "monthly") return `${formatMonthLabel(from.slice(0, 7))} · ${scope}`;
  return `${from} - ${to} · ${scope}`;
}

function buildReportKey(reportType: ReportType, from: string, to: string, project: string) {
  return `${reportType}_${project}_${from}_${to}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("weekly");
  const [weekFrom, setWeekFrom] = useState(sevenDaysAgo());
  const [weekTo, setWeekTo] = useState(today());
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [project, setProject] = useState("All Projects");

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [tagRows, setTagRows] = useState<TagRow[]>([]);
  const [notes, setNotes] = useState("");
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [initialProjectsLoaded, setInitialProjectsLoaded] = useState(false);

  const range = useMemo(() => {
    if (reportType === "monthly") {
      return {
        from: `${monthKey}-01`,
        to: monthLastDay(monthKey),
      };
    }

    return {
      from: weekFrom,
      to: weekTo,
    };
  }, [reportType, weekFrom, weekTo, monthKey]);

  function clearLiveData(message = "Filters changed. Click Refresh LiveChat.") {
    setReport(null);
    setTagRows([]);
    setStatus(message);
  }

  async function loadSavedReports() {
    const { data, error } = await getSavedReports();

    if (error) {
      setStatus(`Saved reports load error: ${error.message}`);
      return;
    }

    setSavedReports(data ?? []);
  }

  async function loadProjectOptions() {
    try {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
      });

      const response = await fetch(`/api/livechat/reports?${params.toString()}`, {
        cache: "no-store",
      });

      const json: ReportData = await response.json();

      if (!response.ok || !json.ok) throw new Error("Failed to load projects");

      const detected = (json.projects ?? [])
        .map((item) => ({ name: item.name }))
        .filter((item) => item.name);

      setProjects(detected);
      setInitialProjectsLoaded(true);

      if (!project || (project !== "All Projects" && !detected.some((item) => item.name === project))) {
        setProject("All Projects");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Projects load error");
      setInitialProjectsLoaded(true);
    }
  }

  async function refreshReport() {
    const currentRequestKey = `${reportType}_${range.from}_${range.to}_${project}`;

    setLoading(true);
    setReport(null);
    setTagRows([]);
    setStatus("Loading LiveChat report...");

    try {
      const reportParams = new URLSearchParams({
        from: range.from,
        to: range.to,
      });

      const tagParams = new URLSearchParams({
        from: range.from,
        to: range.to,
        mode: reportType,
      });

      if (project !== "All Projects") {
        reportParams.set("project", project);
        tagParams.set("project", project);
      }

      const [reportResponse, tagResponse] = await Promise.all([
        fetch(`/api/livechat/reports?${reportParams.toString()}`, { cache: "no-store" }),
        fetch(`/api/livechat/tag-report?${tagParams.toString()}`, { cache: "no-store" }),
      ]);

      const [reportJson, tagJson]: [ReportData, TagReportData] = await Promise.all([
        reportResponse.json(),
        tagResponse.json(),
      ]);

      const stillCurrent = currentRequestKey === `${reportType}_${range.from}_${range.to}_${project}`;
      if (!stillCurrent) return;

      if (!reportResponse.ok || !reportJson.ok) throw new Error("Report API error");
      if (!tagResponse.ok || !tagJson.ok) throw new Error("Tag report API error");

      setReport(reportJson);
      setTagRows(tagJson.rows ?? []);

      if (project === "All Projects") {
        const detected = (reportJson.projects ?? []).map((item) => ({ name: item.name }));
        if (detected.length > 0) setProjects(detected);
      }

      setStatus("LiveChat report loaded");
    } catch (error) {
      setReport(null);
      setTagRows([]);
      setStatus(error instanceof Error ? error.message : "Report load error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveReport() {
    if (!report) {
      setStatus("Nothing to save. Refresh LiveChat first.");
      return;
    }

    setStatus("Saving report...");

    const key = buildReportKey(reportType, range.from, range.to, project);
    const title = reportTitle(reportType, range.from, range.to, project);

    const { error } = await saveReport({
      report_key: key,
      title,
      report_type: reportType,
      project,
      period: {
        from: range.from,
        to: range.to,
      },
      summary: report.summary,
      projects: report.projects,
      tags: tagRows,
      agents: [],
      notes,
      ai_summary: "",
    });

    if (error) {
      setStatus(`Save error: ${error.message}`);
      return;
    }

    setStatus("Report saved");
    await loadSavedReports();
  }

  async function handleDeleteReport(reportKey: string) {
    const ok = confirm("Delete saved report?");
    if (!ok) return;

    const { error } = await deleteSavedReport(reportKey);

    if (error) {
      setStatus(`Delete error: ${error.message}`);
      return;
    }

    setStatus("Saved report deleted");
    await loadSavedReports();
  }

  function openSavedReport(saved: SavedReport) {
    const period = saved.period as { from?: string; to?: string };

    setReport({
      ok: true,
      period: {
        from: String(period?.from ?? ""),
        to: String(period?.to ?? ""),
      },
      project: saved.project === "All Projects" ? null : saved.project,
      summary: saved.summary as ReportData["summary"],
      projects: saved.projects as ProjectRow[],
    });

    setTagRows(saved.tags as TagRow[]);
    setNotes(saved.notes ?? "");
    setReportType(saved.report_type);
    setProject(saved.project);

    if (period?.from && period?.to) {
      if (saved.report_type === "monthly") {
        setMonthKey(String(period.from).slice(0, 7));
      } else {
        setWeekFrom(String(period.from));
        setWeekTo(String(period.to));
      }
    }

    setStatus(`Opened saved report: ${saved.title}`);
  }

  useEffect(() => {
    loadSavedReports();
    loadProjectOptions();
  }, []);

  useEffect(() => {
    clearLiveData();
  }, [reportType, weekFrom, weekTo, monthKey, project]);

  const summary = report?.summary;

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <PageHeader
          eyebrow="Analytics"
          title="Reports"
          description="LiveChat reports with auto-detected projects, top tags, notes, and saved report snapshots."
        />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="rounded-2xl border border-white/10 bg-[#080B12] p-1">
            <button
              onClick={() => setReportType("weekly")}
              className={`h-10 rounded-xl px-5 text-sm font-bold ${
                reportType === "weekly"
                  ? "bg-cyan-400/15 text-cyan-300"
                  : "text-white/45 hover:text-white"
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setReportType("monthly")}
              className={`h-10 rounded-xl px-5 text-sm font-bold ${
                reportType === "monthly"
                  ? "bg-cyan-400/15 text-cyan-300"
                  : "text-white/45 hover:text-white"
              }`}
            >
              Monthly
            </button>
          </div>

          {reportType === "weekly" ? (
            <>
              <DatePickerInput label="From" value={weekFrom} onChange={setWeekFrom} />
              <DatePickerInput label="To" value={weekTo} onChange={setWeekTo} />
            </>
          ) : (
            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-300/60">
                Month
              </label>
              <select
                value={monthKey}
                onChange={(event) => setMonthKey(event.target.value)}
                className="h-12 min-w-[180px] rounded-2xl border border-white/10 bg-[#080B12] px-4 text-white outline-none focus:border-cyan-400/40"
              >
                {getMonthOptions().map((month) => (
                  <option key={month} value={month}>
                    {formatMonthLabel(month)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-300/60">
              Project
            </label>
            <select
              value={project}
              onChange={(event) => setProject(event.target.value)}
              className="h-12 min-w-[190px] rounded-2xl border border-white/10 bg-[#080B12] px-4 text-white outline-none focus:border-cyan-400/40"
            >
              <option value="All Projects">All Projects</option>
              {projects.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={refreshReport}
            disabled={loading || !initialProjectsLoaded}
            className="h-12 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-6 font-bold text-cyan-300 hover:bg-cyan-400/15 disabled:opacity-40"
          >
            {loading ? "Loading..." : "Refresh LiveChat"}
          </button>

          <button
            onClick={handleSaveReport}
            disabled={!report || loading}
            className="flex h-12 items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-6 font-bold text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-40"
          >
            <Save size={16} /> Save Report
          </button>

          <div className="text-sm text-white/45">{status}</div>
        </div>
      </Card>

      {loading && (
        <Card className="p-10 text-center text-white/50">
          Loading fresh LiveChat data...
        </Card>
      )}

      {!loading && report && summary && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Total Chats" value={summary.totalChats} icon={<MessageSquare size={20} />} />
            <StatCard title="Missed" value={summary.missedChats} icon={<BarChart3 size={20} />} />
            <StatCard title="CSAT" value={`${summary.csatPercent}%`} icon={<CalendarDays size={20} />} />
            <StatCard title="Avg Duration" value={formatSeconds(summary.avgChatDurationSec)} icon={<CalendarDays size={20} />} />
          </div>

          <Card className="p-6">
            <h2 className="mb-4 text-xl font-bold text-white">Project Summary</h2>
            <div className="overflow-auto rounded-2xl border border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-white/[0.04] text-white/60">
                  <tr>
                    <th className="px-4 py-3 text-left">Project</th>
                    <th className="px-4 py-3 text-center">Chats</th>
                    <th className="px-4 py-3 text-center">Missed</th>
                    <th className="px-4 py-3 text-center">CSAT</th>
                    <th className="px-4 py-3 text-center">Avg Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {report.projects.map((item) => (
                    <tr key={item.name} className="border-t border-white/10">
                      <td className="px-4 py-3 font-semibold text-white">{item.name}</td>
                      <td className="px-4 py-3 text-center text-cyan-300">{item.chats}</td>
                      <td className="px-4 py-3 text-center">{item.missed}</td>
                      <td className="px-4 py-3 text-center">{item.csat}%</td>
                      <td className="px-4 py-3 text-center">{formatSeconds(item.avgChatDurationSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-xl font-bold text-white">Top Tags</h2>
            <div className="overflow-auto rounded-2xl border border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-white/[0.04] text-white/60">
                  <tr>
                    <th className="px-4 py-3 text-left">Tag / Topic</th>
                    <th className="px-4 py-3 text-center">Total</th>
                    <th className="px-4 py-3 text-center">VIP</th>
                    <th className="px-4 py-3 text-center">Regular</th>
                    <th className="px-4 py-3 text-center">Previous</th>
                    <th className="px-4 py-3 text-center">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {tagRows.slice(0, 20).map((tag) => (
                    <tr key={tag.tag} className="border-t border-white/10">
                      <td className="px-4 py-3">
                        <div className="font-bold text-white">{tag.label}</div>
                        <div className="mt-1 text-xs text-white/35">{tag.tag}</div>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-cyan-300">{tag.total}</td>
                      <td className="px-4 py-3 text-center">{tag.vip}</td>
                      <td className="px-4 py-3 text-center">{tag.regular}</td>
                      <td className="px-4 py-3 text-center">{tag.previousTotal}</td>
                      <td
                        className={`px-4 py-3 text-center font-bold ${
                          tag.changePercent === null
                            ? "text-cyan-300"
                            : tag.changePercent > 0
                              ? "text-red-300"
                              : tag.changePercent < 0
                                ? "text-emerald-300"
                                : "text-white/60"
                        }`}
                      >
                        {tag.changeLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-xl font-bold text-white">Notes</h2>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add report notes before saving..."
              className="min-h-[140px] w-full rounded-2xl border border-white/10 bg-[#05070D] p-4 text-white outline-none placeholder:text-white/25 focus:border-cyan-400/40"
            />
          </Card>
        </>
      )}

      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold text-white">Saved Reports</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {savedReports.length === 0 ? (
            <div className="text-sm text-white/45">No saved reports yet.</div>
          ) : (
            savedReports.map((item) => (
              <div key={item.report_key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <button onClick={() => openSavedReport(item)} className="block w-full text-left">
                  <div className="font-bold text-white">{item.title}</div>
                  <div className="mt-1 text-xs text-white/40">
                    {item.report_type} · {item.project}
                  </div>
                </button>
                <button
                  onClick={() => handleDeleteReport(item.report_key)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-400/15"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function DatePickerInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseDate(value));
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setViewDate(parseDate(value));
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-300/60">
        {label}
      </label>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-12 min-w-[180px] items-center gap-3 rounded-2xl border border-white/10 bg-[#080B12] px-4 text-left text-white outline-none hover:border-cyan-400/30"
      >
        <CalendarDays size={16} className="text-cyan-300/60" />
        <span className="font-semibold">{value}</span>
      </button>

      {open && (
        <CalendarPopup
          selected={value}
          viewDate={viewDate}
          setViewDate={setViewDate}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function CalendarPopup({
  selected,
  viewDate,
  setViewDate,
  onSelect,
  onClose,
}: {
  selected: string;
  viewDate: Date;
  setViewDate: (date: Date) => void;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const selectedDate = parseDate(selected);
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const startOffset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = monthEnd.getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = viewDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  function moveMonth(direction: number) {
    setViewDate(new Date(year, month + direction, 1));
  }

  return (
    <div className="absolute left-0 top-[74px] z-50 w-[330px] rounded-3xl border border-cyan-400/20 bg-[#05070D] p-4 shadow-[0_20px_80px_rgba(0,0,0,0.65)]">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => moveMonth(-1)}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/70 hover:border-cyan-400/30 hover:text-cyan-300"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="font-black text-white">{monthLabel}</div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => moveMonth(1)}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/70 hover:border-cyan-400/30 hover:text-cyan-300"
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/70 hover:border-red-400/30 hover:text-red-300"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-white/35">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div key={day} className="py-2">{day}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, index) => {
          if (!date) return <div key={`empty-${index}`} className="h-10" />;

          const iso = toISODate(date);
          const isSelected = iso === selected;
          const isToday = iso === today();

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              className={`h-10 rounded-xl text-sm font-bold transition ${
                isSelected
                  ? "border border-cyan-300 bg-cyan-400/20 text-cyan-200"
                  : isToday
                    ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15"
                    : "border border-transparent text-white/70 hover:border-cyan-400/20 hover:bg-cyan-400/10 hover:text-white"
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
