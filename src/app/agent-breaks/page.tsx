"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Moon, Users } from "lucide-react";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import {
  getSchedule,
  getSchedules,
  type Schedule,
} from "@/services/scheduleService";
import {
  calculateScheduleStats,
  parseShiftValue,
  type ParsedSchedule,
  type ShiftInterval,
} from "@/lib/schedule/parseSchedule";

const emptyParsed: ParsedSchedule = {
  agents: [],
  agentDetails: {},
  days: [],
  rows: {},
};

const emptyStats = {
  agents: 0,
  days: 0,
  dayHours: 0,
  nightHours: 0,
};

type ShiftWindow = {
  start: Date;
  end: Date;
  dateKey: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayToDateParts(day: string, selectedMonth: string) {
  const match = day.match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return null;

  const [, rawDay, rawMonth] = match;
  const year = Number(selectedMonth.split("-")[0]);
  const month = Number(rawMonth);
  const date = Number(rawDay);

  if (!year || !month || !date) return null;

  return { year, month, day: date };
}

function makeDateTime(
  year: number,
  month: number,
  day: number,
  time: string,
  dayOffset = 0
) {
  const [hours, minutes] = time.split(":").map(Number);
  const utc = Date.UTC(year, month - 1, day + dayOffset, hours - 3, minutes, 0);
  return new Date(utc);
}

function dateKeyFromParts(
  year: number,
  month: number,
  day: number,
  dayOffset = 0
) {
  const date = new Date(Date.UTC(year, month - 1, day + dayOffset, 12, 0, 0));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function intervalToWindow(
  interval: ShiftInterval,
  day: string,
  selectedMonth: string
): ShiftWindow | null {
  const date = dayToDateParts(day, selectedMonth);
  if (!date) return null;

  const start = makeDateTime(
    date.year,
    date.month,
    date.day,
    interval.start,
    interval.dayOffset
  );
  let end = makeDateTime(
    date.year,
    date.month,
    date.day,
    interval.end,
    interval.dayOffset
  );

  if (end <= start) end = new Date(end.getTime() + DAY_MS);

  return {
    start,
    end,
    dateKey: dateKeyFromParts(
      date.year,
      date.month,
      date.day,
      interval.dayOffset
    ),
  };
}

function getShiftWindows(
  shift: string,
  day: string,
  selectedMonth: string
): ShiftWindow[] {
  const parsedShift = parseShiftValue(shift);
  if (parsedShift.status !== "working" || !parsedShift.valid) return [];

  return parsedShift.intervals
    .map((interval) => intervalToWindow(interval, day, selectedMonth))
    .filter((window): window is ShiftWindow => Boolean(window));
}

function getOverlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());

  if (end <= start) return 0;

  return Math.round((end - start) / 1000 / 60);
}

function getBreakMinutesInsideShift(
  activity: unknown,
  email: string | null,
  shiftWindow: ShiftWindow
) {
  if (!email || !activity || typeof activity !== "object") {
    return 0;
  }

  const activityObject = activity as Record<string, unknown>;
  const events = activityObject[email.toLowerCase()];

  if (!Array.isArray(events)) return 0;

  let totalMinutes = 0;

  for (const event of events) {
    if (!event || typeof event !== "object") continue;

    const item = event as {
      type?: string;
      start_time?: string;
      end_time?: string;
    };

    if (item.type !== "status_away") continue;
    if (!item.start_time || !item.end_time) continue;

    totalMinutes += getOverlapMinutes(
      new Date(item.start_time),
      new Date(item.end_time),
      shiftWindow.start,
      shiftWindow.end
    );
  }

  return totalMinutes;
}

export default function AgentBreaksPage() {
  const [savedSchedules, setSavedSchedules] = useState<Schedule[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [parsed, setParsed] = useState<ParsedSchedule>(emptyParsed);
  const [stats, setStats] = useState(emptyStats);
  const [status, setStatus] = useState("Ready");
  const [breakActivity, setBreakActivity] = useState<Record<string, unknown>>(
    {}
  );
  const [loadingBreaks, setLoadingBreaks] = useState(false);

  async function loadSchedules() {
    const { data, error } = await getSchedules();

    if (error) {
      setStatus(`Load error: ${error.message}`);
      return;
    }

    const schedules = data ?? [];
    setSavedSchedules(schedules);

    if (schedules.length > 0) {
      loadSchedule(schedules[0].month_key);
    }
  }

  async function loadSchedule(monthKey: string) {
    setSelectedMonth(monthKey);
    setStatus("Loading schedule...");

    const { data, error } = await getSchedule(monthKey);

    if (error || !data) {
      setParsed(emptyParsed);
      setStats(emptyStats);
      setBreakActivity({});
      setStatus("No schedule found");
      return;
    }

    const schedule = data.parsed_data as ParsedSchedule;

    setParsed(schedule);
    setStats(data.stats ?? calculateScheduleStats(schedule));
    setBreakActivity({});
    setStatus(`Loaded ${data.title}`);
  }

  async function loadBreaks() {
    if (!parsed.days.length) {
      setStatus("No schedule days found");
      return;
    }

    setLoadingBreaks(true);
    setStatus("Loading LiveChat breaks...");

    try {
      const dates = [
        ...new Set(
          parsed.agents.flatMap((agent) => {
            const shifts = parsed.rows[agent] ?? [];

            return parsed.days
              .map((day, index) => {
                return getShiftWindows(
                  shifts[index] ?? "",
                  day,
                  selectedMonth
                ).map((window) => window.dateKey);
              })
              .flat()
              .filter(Boolean) as string[];
          })
        ),
      ];

      const response = await fetch("/api/livechat/breaks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dates }),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        setStatus(result.error ?? "Failed to load breaks");
        return;
      }

      const mergedActivity: Record<string, unknown> = {};

      for (const item of result.results ?? []) {
        mergedActivity[item.date] = item.activity;
      }

      setBreakActivity(mergedActivity);
      setStatus("LiveChat breaks loaded");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoadingBreaks(false);
    }
  }

  const breakGrid = useMemo(() => {
    return parsed.agents.map((agent) => {
      const details = parsed.agentDetails?.[agent];
      const shifts = parsed.rows[agent] ?? [];

      const days = parsed.days.map((day, dayIndex) => {
        const shift = shifts[dayIndex] ?? "";
        const parsedShift = parseShiftValue(shift);
        const shiftWindows = getShiftWindows(shift, day, selectedMonth);
        const breakMinutes = shiftWindows.reduce(
          (total, shiftWindow) =>
            total +
            getBreakMinutesInsideShift(
              breakActivity[shiftWindow.dateKey],
              details?.email ?? null,
              shiftWindow
            ),
          0
        );

        const label =
          parsedShift.status === "sick_leave"
            ? "Sick leave"
            : parsedShift.status === "vacation"
              ? "Vacation"
              : parsedShift.status === "training"
                ? "Training"
                : null;

        return {
          day,
          shift,
          label,
          working: shiftWindows.length > 0,
          breakMinutes,
          status:
            shiftWindows.length === 0
              ? "off"
              : breakMinutes > 30
                ? "bad"
                : "good",
        };
      });

      const totalBreakMinutes = days.reduce(
        (sum, item) => sum + item.breakMinutes,
        0
      );

      return {
        agent,
        days,
        totalBreakMinutes,
      };
    });
  }, [breakActivity, parsed, selectedMonth]);

  const totalBreakMinutes = breakGrid.reduce(
    (sum, row) => sum + row.totalBreakMinutes,
    0
  );

  const overBreakDays = breakGrid.reduce(
    (sum, row) => sum + row.days.filter((day) => day.status === "bad").length,
    0
  );

  useEffect(() => {
    loadSchedules();
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <PageHeader
          eyebrow="Operations"
          title="Agent Breaks"
          description="Breaks are calculated only inside scheduled working hours. Night shift is counted on the next day from 00:00 to 08:00."
        />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/40">
              Saved Schedule
            </label>

            <select
              value={selectedMonth}
              onChange={(e) => loadSchedule(e.target.value)}
              className="h-12 rounded-2xl border border-white/10 bg-[#080B12] px-4 text-white outline-none"
            >
              {savedSchedules.length === 0 ? (
                <option value="">No saved schedules</option>
              ) : (
                savedSchedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.month_key}>
                    {schedule.title}
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            onClick={loadBreaks}
            disabled={loadingBreaks || parsed.agents.length === 0}
            className="h-12 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-6 font-semibold text-cyan-300 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingBreaks ? "Loading..." : "Load LiveChat Breaks"}
          </button>

          <div className="text-sm text-white/45">{status}</div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Agents"
          value={stats.agents}
          icon={<Users size={20} />}
        />
        <StatCard
          title="Days"
          value={stats.days}
          icon={<CalendarDays size={20} />}
        />
        <StatCard
          title="Total Breaks"
          value={`${totalBreakMinutes} min`}
          icon={<Clock size={20} />}
        />
        <StatCard
          title="Over 30 min"
          value={overBreakDays}
          icon={<Moon size={20} />}
        />
      </div>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-white">Daily Breaks Grid</h2>

          <div className="flex gap-3 text-xs">
            <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-emerald-300">
              ≤ 30 min
            </span>
            <span className="rounded-full bg-red-400/10 px-3 py-1 text-red-300">
              &gt; 30 min
            </span>
          </div>
        </div>

        <div className="overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-max border-collapse text-sm">
            <thead>
              <tr className="bg-white/[0.04]">
                <th className="sticky left-0 z-10 min-w-[160px] border-r border-white/10 bg-[#10141D] px-3 py-3 text-left text-white">
                  Agent
                </th>

                {parsed.days.map((day) => (
                  <th
                    key={day}
                    className="min-w-[92px] border-r border-white/10 px-3 py-3 text-center text-xs text-white/60"
                  >
                    {day}
                  </th>
                ))}

                <th className="min-w-[120px] px-3 py-3 text-center text-xs text-white/60">
                  Total
                </th>
              </tr>
            </thead>

            <tbody>
              {breakGrid.map((row) => (
                <tr key={row.agent} className="border-t border-white/10">
                  <td className="sticky left-0 z-10 border-r border-white/10 bg-[#10141D] px-3 py-2 font-semibold text-white">
                    {row.agent}
                  </td>

                  {row.days.map((day) => (
                    <td
                      key={`${row.agent}-${day.day}`}
                      className="border-r border-white/10 p-1"
                    >
                      {day.label ? (
                        <div className="flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-2 text-center text-[11px] font-semibold text-white/60">
                          {day.label}
                        </div>
                      ) : !day.working ? (
                        <div className="h-9 rounded-lg bg-white/[0.02]" />
                      ) : (
                        <div
                          className={`flex h-9 items-center justify-center rounded-lg border text-xs font-semibold ${
                            day.status === "bad"
                              ? "border-red-400/30 bg-red-400/15 text-red-300"
                              : "border-emerald-400/30 bg-emerald-400/15 text-emerald-300"
                          }`}
                        >
                          {day.breakMinutes}m
                        </div>
                      )}
                    </td>
                  ))}

                  <td className="px-3 py-2 text-center font-semibold text-white">
                    {row.totalBreakMinutes}m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}