"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Mail,
  MessageSquare,
  Save,
  Tags,
  Trash2,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from "lucide-react";

type MonthData = {
  key: string;
  label: string;
  chats: number;
  frt: number;
  art: number;
  duration: number;
  csat: number;
  emails: number;
  emailFrt: number;
  openMedian: number;
};

type MetricKey = "chats" | "frt" | "art" | "duration" | "csat" | "emails" | "emailFrt" | "openMedian";

type SavedMonthSnapshot = MonthData & {
  savedAt: string;
  demo?: boolean;
};

const SAVED_REPORTS_STORAGE_KEY = "sportbet-reports-saved-months-v1";

const history: MonthData[] = [
  { key: "2026-03", label: "Mar", chats: 10842, frt: 51, art: 73, duration: 612, csat: 89.4, emails: 4212, emailFrt: 1420, openMedian: 3910 },
  { key: "2026-04", label: "Apr", chats: 11290, frt: 48, art: 70, duration: 598, csat: 90.1, emails: 4380, emailFrt: 1330, openMedian: 3740 },
  { key: "2026-05", label: "May", chats: 11784, frt: 46, art: 68, duration: 584, csat: 90.8, emails: 4511, emailFrt: 1290, openMedian: 3595 },
  { key: "2026-06", label: "Jun", chats: 12121, frt: 43, art: 65, duration: 571, csat: 91.6, emails: 4698, emailFrt: 1215, openMedian: 3410 },
  { key: "2026-07", label: "Jul", chats: 12540, frt: 42, art: 61, duration: 563, csat: 91.2, emails: 4820, emailFrt: 1184, openMedian: 3290 },
  { key: "2026-08", label: "Aug", chats: 13201, frt: 38, art: 57, duration: 548, csat: 93.1, emails: 5094, emailFrt: 1096, openMedian: 3018 },
];

const initialSavedSnapshots: SavedMonthSnapshot[] = [
  {
    key: "2026-07",
    label: "Jul",
    chats: 12540,
    frt: 42,
    art: 61,
    duration: 563,
    csat: 91.2,
    emails: 4820,
    emailFrt: 1184,
    openMedian: 3290,
    savedAt: "2026-08-01T09:15:00.000Z",
    demo: true,
  },
];

const tags = [
  { name: "Withdrawal", total: 2861, prev: 2488 },
  { name: "Deposit", total: 2240, prev: 2195 },
  { name: "Verification", total: 1749, prev: 1512 },
  { name: "Bonus", total: 1588, prev: 1694 },
  { name: "Sports bet settlement", total: 1294, prev: 1018 },
  { name: "Account", total: 982, prev: 1055 },
  { name: "Technical issue", total: 711, prev: 642 },
];

const emailTags = [
  { name: "Verification", total: 1204, prev: 1098 },
  { name: "Withdrawal", total: 996, prev: 915 },
  { name: "Responsible Gaming", total: 580, prev: 621 },
  { name: "Payment", total: 498, prev: 457 },
  { name: "Other", total: 1816, prev: 1729 },
];

const preChat = [
  { value: "Withdrawal 🏧", count: 17, share: 7.33, prevShare: 8.10 },
  { value: "Deposit 💵", count: 53, share: 22.84, prevShare: 20.40 },
  { value: "Bonus 🎁", count: 50, share: 21.55, prevShare: 19.75 },
  { value: "VIP 👑", count: 7, share: 3.02, prevShare: 3.60 },
  { value: "Bet 🏀", count: 44, share: 18.97, prevShare: 20.15 },
  { value: "Other ❓", count: 61, share: 26.29, prevShare: 28.00 },
];

const preChatFilled = 232;

const metricMeta: Record<MetricKey, { label: string; suffix?: string; lowerIsBetter?: boolean }> = {
  chats: { label: "Total Chats" },
  frt: { label: "First Response Time", suffix: "s", lowerIsBetter: true },
  art: { label: "ART", suffix: "s", lowerIsBetter: true },
  duration: { label: "Chat Duration", suffix: "s", lowerIsBetter: true },
  csat: { label: "CSAT", suffix: "%" },
  emails: { label: "Total Emails" },
  emailFrt: { label: "Email FRT", suffix: "s", lowerIsBetter: true },
  openMedian: { label: "Open Status Median", suffix: "s", lowerIsBetter: true },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) return monthKey;

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function formatTime(seconds: number) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m}m ${rest}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function formatMetric(key: MetricKey, value: number) {
  if (key === "frt" || key === "art" || key === "duration" || key === "emailFrt" || key === "openMedian") return formatTime(value);
  if (key === "csat") return `${value.toFixed(1)}%`;
  return formatNumber(value);
}

function changePercent(current: number, previous: number) {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

function Delta({ current, previous, lowerIsBetter = false, percentagePoints = false }: { current: number; previous: number; lowerIsBetter?: boolean; percentagePoints?: boolean }) {
  const delta = percentagePoints ? current - previous : changePercent(current, previous);
  const positiveDirection = delta >= 0;
  const good = lowerIsBetter ? !positiveDirection : positiveDirection;
  const Icon = positiveDirection ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${good ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : "border-rose-300/20 bg-rose-300/10 text-rose-200"}`}>
      <Icon size={13} /> {delta > 0 ? "+" : ""}{percentagePoints ? `${delta.toFixed(1)} pp` : `${delta.toFixed(1)}%`}
    </span>
  );
}

function StatCard({ title, value, current, previous, icon: Icon, lowerIsBetter = false, percentagePoints = false }: { title: string; value: string; current: number; previous: number; icon: typeof BarChart3; lowerIsBetter?: boolean; percentagePoints?: boolean }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[#0d1a2d] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">{title}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-sb-green/15 bg-sb-green/[0.06] text-sb-green"><Icon size={18} /></div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Delta current={current} previous={previous} lowerIsBetter={lowerIsBetter} percentagePoints={percentagePoints} />
        <span className="text-xs text-white/30">vs previous month</span>
      </div>
    </div>
  );
}

function TrendChart({ metric }: { metric: MetricKey }) {
  const values = history.map((item) => item[metric] as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const width = 900;
  const height = 220;
  const padX = 32;
  const padY = 26;
  const points = values.map((value, index) => {
    const x = padX + (index * (width - padX * 2)) / Math.max(values.length - 1, 1);
    const y = height - padY - ((value - min) / range) * (height - padY * 2);
    return { x, y, value, label: history[index].label };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height + 42}`} className="min-w-[720px] w-full" role="img" aria-label={`${metricMeta[metric].label} trend`}>
        {[0, 1, 2, 3].map((line) => {
          const y = padY + (line * (height - padY * 2)) / 3;
          return <line key={line} x1={padX} y1={y} x2={width - padX} y2={y} stroke="rgba(255,255,255,.07)" strokeWidth="1" />;
        })}
        <path d={path} fill="none" stroke="rgb(103 232 249)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="5" fill="rgb(103 232 249)" />
            <circle cx={point.x} cy={point.y} r="9" fill="transparent" stroke="rgba(103,232,249,.2)" strokeWidth="4" />
            <text x={point.x} y={height + 12} textAnchor="middle" fill="rgba(255,255,255,.45)" fontSize="12">{point.label}</text>
            <text x={point.x} y={Math.max(point.y - 14, 13)} textAnchor="middle" fill="rgba(255,255,255,.78)" fontSize="11">{formatMetric(metric, point.value)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}


function BarRows({ rows, total }: { rows: { name: string; total: number; prev?: number }[]; total: number }) {
  const max = Math.max(...rows.map((row) => row.total), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.name}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-white/60">{row.name}</span>
            <span className="shrink-0 font-semibold text-white/80">{formatNumber(row.total)} · {((row.total / Math.max(total, 1)) * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]"><div className="h-full rounded-full bg-sb-green" style={{ width: `${(row.total / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const [monthIndex, setMonthIndex] = useState(history.length - 1);
  const [metric, setMetric] = useState<MetricKey>("chats");
  const [activeSection, setActiveSection] = useState<"overview" | "tags" | "prechat" | "emails" | "history">("overview");
  const [notice, setNotice] = useState("");
  const [savedSnapshots, setSavedSnapshots] = useState<SavedMonthSnapshot[]>(initialSavedSnapshots);
  const [selectedSavedKey, setSelectedSavedKey] = useState<string | null>(null);

  const current = history[monthIndex];
  const previous = history[Math.max(0, monthIndex - 1)];

  const selectedSavedSnapshot = useMemo(
    () => savedSnapshots.find((item) => item.key === selectedSavedKey) ?? null,
    [savedSnapshots, selectedSavedKey]
  );

  const displayCurrent = selectedSavedSnapshot ?? current;

  const displayPrevious = useMemo(() => {
    const source = selectedSavedSnapshot ? savedSnapshots : history;
    const index = source.findIndex((item) => item.key === displayCurrent.key);

    if (index > 0) return source[index - 1];

    const fallbackIndex = history.findIndex((item) => item.key === displayCurrent.key);
    return history[Math.max(0, fallbackIndex - 1)] ?? displayCurrent;
  }, [displayCurrent, selectedSavedSnapshot, savedSnapshots]);
  const sections = [
    ["overview", "Overview"],
    ["tags", "Chat Tags"],
    ["prechat", "Pre-chat Forms"],
    ["emails", "Emails"],
    ["history", "Historical Trends"],
  ] as const;

  const currentMonthTitle = useMemo(() => {
    const [year, month] = displayCurrent.key.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [displayCurrent.key]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_REPORTS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSavedSnapshots(parsed);
      }
    } catch {
      // Keep demo defaults if browser storage is unavailable/corrupt.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SAVED_REPORTS_STORAGE_KEY,
        JSON.stringify(savedSnapshots)
      );
    } catch {
      // Browser storage is only a temporary demo persistence layer.
    }
  }, [savedSnapshots]);

  function saveCurrentMonthDemo() {
    const snapshot: SavedMonthSnapshot = {
      ...displayCurrent,
      savedAt: new Date().toISOString(),
      demo: true,
    };

    setSavedSnapshots((items) => {
      const withoutCurrent = items.filter((item) => item.key !== snapshot.key);
      return [...withoutCurrent, snapshot].sort((a, b) => a.key.localeCompare(b.key));
    });

    setSelectedSavedKey(snapshot.key);
    setActiveSection("overview");
    showNotice(`${currentMonthTitle} saved. It is now available in Saved Months below.`);
  }

  function openSavedSnapshot(monthKey: string) {
    const snapshot = savedSnapshots.find((item) => item.key === monthKey);
    if (!snapshot) return;

    setSelectedSavedKey(monthKey);

    const historyIndex = history.findIndex((item) => item.key === monthKey);
    if (historyIndex >= 0) setMonthIndex(historyIndex);

    setActiveSection("overview");
    showNotice(`Opened saved statistics for ${formatMonthLabel(monthKey)}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteSavedSnapshot(monthKey: string) {
    setSavedSnapshots((items) => items.filter((item) => item.key !== monthKey));
    setSelectedSavedKey((selected) => (selected === monthKey ? null : selected));
    showNotice(`Saved month ${formatMonthLabel(monthKey)} deleted.`);
  }

  function selectLiveMonth(nextIndex: number) {
    setSelectedSavedKey(null);
    setMonthIndex(nextIndex);
  }

  async function exportCurrentReportXlsx() {
    try {
      showNotice("Building Excel report...");

      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "SupportOS";
      workbook.company = "SportBet";
      workbook.subject = "SportBet Monthly Support Report";
      workbook.title = `SportBet Monthly Report — ${formatMonthLabel(displayCurrent.key)}`;
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("Monthly Report", {
        views: [{ state: "frozen", ySplit: 4 }],
        properties: { defaultRowHeight: 20 },
        pageSetup: {
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: {
            left: 0.35,
            right: 0.35,
            top: 0.5,
            bottom: 0.5,
            header: 0.2,
            footer: 0.2,
          },
        },
      });

      // SportBet-inspired palette
      const C = {
        navy: "0D1A2D",
        navy2: "122139",
        navy3: "182A42",
        border: "29405F",
        green: "6EF29A",
        greenDark: "153A2B",
        white: "FFFFFF",
        text: "DDE7F3",
        muted: "8FA2B8",
        good: "8CF0B1",
        bad: "FF9CA7",
        amber: "F6D67A",
        cyan: "79E6FF",
      };

      const thinBorder = {
        top: { style: "thin" as const, color: { argb: C.border } },
        left: { style: "thin" as const, color: { argb: C.border } },
        bottom: { style: "thin" as const, color: { argb: C.border } },
        right: { style: "thin" as const, color: { argb: C.border } },
      };

      const sectionTitle = (row: number, title: string) => {
        sheet.mergeCells(`A${row}:E${row}`);
        const cell = sheet.getCell(`A${row}`);
        cell.value = title;
        cell.font = { bold: true, size: 13, color: { argb: C.green } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy2 } };
        cell.alignment = { vertical: "middle" };
        cell.border = thinBorder;
        sheet.getRow(row).height = 26;
      };

      const headerRow = (row: number, values: string[]) => {
        values.forEach((value, index) => {
          const cell = sheet.getCell(row, index + 1);
          cell.value = value;
          cell.font = { bold: true, color: { argb: C.white } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy3 } };
          cell.alignment = { horizontal: index === 0 ? "left" : "center", vertical: "middle" };
          cell.border = thinBorder;
        });
        sheet.getRow(row).height = 24;
      };

      const bodyRow = (
        row: number,
        values: (string | number)[],
        options?: { changeColumn?: number; goodChange?: boolean }
      ) => {
        values.forEach((value, index) => {
          const cell = sheet.getCell(row, index + 1);
          cell.value = value;
          cell.font = {
            color: {
              argb:
                options?.changeColumn === index + 1
                  ? options.goodChange
                    ? C.good
                    : C.bad
                  : C.text,
            },
            bold: index === 0 || index === 2,
          };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
          cell.alignment = {
            horizontal: index === 0 ? "left" : "center",
            vertical: "middle",
          };
          cell.border = thinBorder;
        });
      };

      // Title area
      sheet.mergeCells("A1:E1");
      const titleCell = sheet.getCell("A1");
      titleCell.value = `SPORTBET MONTHLY REPORT — ${formatMonthLabel(displayCurrent.key).toUpperCase()}`;
      titleCell.font = { bold: true, size: 18, color: { argb: C.white } };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
      titleCell.alignment = { horizontal: "left", vertical: "middle" };
      titleCell.border = thinBorder;
      sheet.getRow(1).height = 34;

      sheet.mergeCells("A2:E2");
      const subCell = sheet.getCell("A2");
      subCell.value = selectedSavedSnapshot
        ? "Source: Saved monthly snapshot"
        : "Source: Current monthly report";
      subCell.font = { italic: true, color: { argb: C.muted } };
      subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy2 } };
      subCell.border = thinBorder;

      // KPI cards row
      const cards = [
        ["Total Chats", formatNumber(displayCurrent.chats)],
        ["FRT", formatTime(displayCurrent.frt)],
        ["ART", formatTime(displayCurrent.art)],
        ["Chat Duration", formatTime(displayCurrent.duration)],
        ["CSAT", `${displayCurrent.csat.toFixed(1)}%`],
      ];

      cards.forEach(([label, value], index) => {
        const col = index + 1;
        const labelCell = sheet.getCell(4, col);
        labelCell.value = label;
        labelCell.font = { bold: true, size: 9, color: { argb: C.muted } };
        labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy2 } };
        labelCell.alignment = { horizontal: "center" };
        labelCell.border = thinBorder;

        const valueCell = sheet.getCell(5, col);
        valueCell.value = value;
        valueCell.font = { bold: true, size: 16, color: { argb: C.white } };
        valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
        valueCell.alignment = { horizontal: "center", vertical: "middle" };
        valueCell.border = thinBorder;
      });
      sheet.getRow(5).height = 30;

      // Overview
      sectionTitle(7, "OVERVIEW — CURRENT VS PREVIOUS MONTH");
      headerRow(8, ["Metric", "Previous", "Current", "Change", "Direction"]);

      const overviewKeys = Object.keys(metricMeta) as MetricKey[];
      let row = 9;

      overviewKeys.forEach((key) => {
        const currentValue = displayCurrent[key] as number;
        const previousValue = displayPrevious[key] as number;
        const lowerIsBetter = Boolean(metricMeta[key].lowerIsBetter);

        const rawDelta =
          key === "csat"
            ? currentValue - previousValue
            : changePercent(currentValue, previousValue);

        const good =
          key === "csat"
            ? rawDelta >= 0
            : lowerIsBetter
              ? rawDelta <= 0
              : rawDelta >= 0;

        const change =
          key === "csat"
            ? `${rawDelta >= 0 ? "+" : ""}${rawDelta.toFixed(1)} pp`
            : `${rawDelta >= 0 ? "+" : ""}${rawDelta.toFixed(1)}%`;

        bodyRow(
          row,
          [
            metricMeta[key].label,
            formatMetric(key, previousValue),
            formatMetric(key, currentValue),
            change,
            good ? "Improved" : "Declined",
          ],
          { changeColumn: 4, goodChange: good }
        );

        const directionCell = sheet.getCell(row, 5);
        directionCell.font = { bold: true, color: { argb: good ? C.good : C.bad } };
        row += 1;
      });

      row += 1;

      // Chat tags
      sectionTitle(row, "CHAT TAGS");
      row += 1;
      headerRow(row, ["Tag", "Previous", "Current", "Share", "Change"]);
      row += 1;

      tags.forEach((item) => {
        const delta = changePercent(item.total, item.prev);
        bodyRow(
          row,
          [
            item.name,
            item.prev,
            item.total,
            `${((item.total / Math.max(displayCurrent.chats, 1)) * 100).toFixed(1)}%`,
            `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
          ],
          { changeColumn: 5, goodChange: delta >= 0 }
        );
        row += 1;
      });

      row += 1;

      // Pre-chat
      sectionTitle(row, "PRE-CHAT FORMS");
      row += 1;
      headerRow(row, ["Answer", "Responses", "Share", "Previous Share", "Change"]);
      row += 1;

      preChat.forEach((item) => {
        const delta = item.share - item.prevShare;
        bodyRow(
          row,
          [
            item.value,
            item.count,
            `${item.share.toFixed(2)}%`,
            `${item.prevShare.toFixed(2)}%`,
            `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} pp`,
          ],
          { changeColumn: 5, goodChange: delta >= 0 }
        );
        row += 1;
      });

      bodyRow(row, ["Filled out", preChatFilled, "", "", ""]);
      row += 1;
      bodyRow(row, ["Group", "SportBet Support", "", "", ""]);
      row += 2;

      // Email tags
      sectionTitle(row, "EMAIL TAGS");
      row += 1;
      headerRow(row, ["Tag", "Previous", "Current", "Change", ""]);
      row += 1;

      emailTags.forEach((item) => {
        const delta = changePercent(item.total, item.prev);
        bodyRow(
          row,
          [
            item.name,
            item.prev,
            item.total,
            `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
            "",
          ],
          { changeColumn: 4, goodChange: delta >= 0 }
        );
        row += 1;
      });

      // Global sheet styling
      sheet.columns = [
        { width: 29 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
      ];

      sheet.eachRow((excelRow) => {
        excelRow.eachCell((cell) => {
          cell.alignment = {
            ...cell.alignment,
            vertical: "middle",
            wrapText: true,
          };
        });
      });

      sheet.autoFilter = {
        from: { row: 8, column: 1 },
        to: { row: 8, column: 5 },
      };

      sheet.headerFooter.oddFooter =
        `&LSupportOS · SportBet&C${formatMonthLabel(displayCurrent.key)}&RPage &P of &N`;

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SportBet_Monthly_Report_${displayCurrent.key}.xlsx`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotice(`${formatMonthLabel(displayCurrent.key)} Excel report exported.`);
    } catch (error) {
      console.error("[reports] XLSX export failed", error);
      showNotice(
        error instanceof Error
          ? `Export error: ${error.message}`
          : "Excel export failed."
      );
    }
  }

  return (
    <div className="mx-auto max-w-[1700px] space-y-6">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-sb-green"><BarChart3 size={15} /> SportBet monthly reporting</div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Reports</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/45">One monthly report with month-over-month comparison, historical trends and saved monthly reports. Save any month and reopen its exact saved statistics from the Saved Months section below.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveCurrentMonthDemo} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-white/65 transition hover:bg-white/[0.06] hover:text-white"><Save size={16} /> Save month</button>
          <button type="button" onClick={exportCurrentReportXlsx} className="inline-flex h-11 items-center gap-2 rounded-xl bg-sb-green px-4 text-sm font-bold text-slate-950 transition hover:bg-sb-green"><Download size={16} /> Export report</button>
        </div>
      </header>

      {notice ? <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] px-4 py-3 text-sm text-emerald-100">{notice}</div> : null}

      <section className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <button type="button" disabled={monthIndex === 0} onClick={() => selectLiveMonth(Math.max(0, monthIndex - 1))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/60 transition hover:text-white disabled:opacity-25"><ChevronLeft size={17} /></button>
            <div className="flex h-10 min-w-56 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-white"><CalendarDays size={16} className="text-sb-green" />{currentMonthTitle}{selectedSavedSnapshot ? <span className="rounded-full border border-sb-green/20 bg-sb-green/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-sb-green">Saved</span> : null}</div>
            <button type="button" disabled={monthIndex === history.length - 1} onClick={() => selectLiveMonth(Math.min(history.length - 1, monthIndex + 1))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/60 transition hover:text-white disabled:opacity-25"><ChevronRight size={17} /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {sections.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setActiveSection(key)} className={`h-10 rounded-xl border px-3.5 text-xs font-semibold transition ${activeSection === key ? "border-sb-green/25 bg-sb-green/10 text-sb-green" : "border-white/10 bg-white/[0.02] text-white/40 hover:text-white/70"}`}>{label}</button>
            ))}
          </div>
        </div>
      </section>

      {activeSection === "overview" ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Total Chats" value={formatNumber(displayCurrent.chats)} current={displayCurrent.chats} previous={displayPrevious.chats} icon={MessageSquare} />
            <StatCard title="First Response Time" value={formatTime(displayCurrent.frt)} current={displayCurrent.frt} previous={displayPrevious.frt} icon={Clock3} lowerIsBetter />
            <StatCard title="ART" value={formatTime(displayCurrent.art)} current={displayCurrent.art} previous={displayPrevious.art} icon={Clock3} lowerIsBetter />
            <StatCard title="Chat Duration" value={formatTime(displayCurrent.duration)} current={displayCurrent.duration} previous={displayPrevious.duration} icon={MessageSquare} lowerIsBetter />
            <StatCard title="CSAT" value={`${displayCurrent.csat.toFixed(1)}%`} current={displayCurrent.csat} previous={displayPrevious.csat} icon={UsersRound} percentagePoints />
          </section>
          <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <div className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-5">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-xs font-semibold uppercase tracking-[0.17em] text-white/35">Month comparison</p><h2 className="mt-1 text-xl font-semibold text-white">Current vs previous month</h2></div>
                <span className="rounded-full border border-sb-green/15 bg-sb-green/[0.06] px-3 py-1 text-xs text-sb-green">{displayPrevious.label} → {displayCurrent.label}</span>
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-white/30"><tr><th className="pb-3 font-semibold">Metric</th><th className="pb-3 font-semibold">Previous</th><th className="pb-3 font-semibold">Current</th><th className="pb-3 font-semibold">Change</th></tr></thead>
                  <tbody className="divide-y divide-white/7">
                    {(Object.keys(metricMeta) as MetricKey[]).slice(0, 5).map((key) => (
                      <tr key={key}><td className="py-3.5 font-medium text-white/75">{metricMeta[key].label}</td><td className="py-3.5 text-white/45">{formatMetric(key, previous[key] as number)}</td><td className="py-3.5 font-semibold text-white">{formatMetric(key, current[key] as number)}</td><td className="py-3.5"><Delta current={current[key] as number} previous={previous[key] as number} lowerIsBetter={metricMeta[key].lowerIsBetter} percentagePoints={key === "csat"} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-white/35">Email snapshot</p>
              <h2 className="mt-1 text-xl font-semibold text-white">Email performance</h2>
              <div className="mt-5 space-y-3">
                {(["emails", "emailFrt", "openMedian"] as MetricKey[]).map((key) => (
                  <div key={key} className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4"><div><p className="text-xs text-white/35">{metricMeta[key].label}</p><p className="mt-1 text-xl font-semibold text-white">{formatMetric(key, current[key] as number)}</p></div><Delta current={current[key] as number} previous={previous[key] as number} lowerIsBetter={metricMeta[key].lowerIsBetter} /></div>
                ))}
              </div>
            </div>
          </section>
          <section className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div><p className="text-xs font-semibold uppercase tracking-[0.17em] text-white/35">Historical trend</p><h2 className="mt-1 text-xl font-semibold text-white">6-month performance</h2><p className="mt-1 text-sm text-white/35">Saved month snapshots are kept in the report history. Select any metric to see how it changed.</p></div>
              <select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)} className="h-10 rounded-xl border border-white/10 bg-[#101f34] px-3 text-sm text-white outline-none focus:border-sb-green/30">{(Object.keys(metricMeta) as MetricKey[]).map((key) => <option key={key} value={key}>{metricMeta[key].label}</option>)}</select>
            </div>
            <div className="mt-5 rounded-2xl border border-white/8 bg-black/10 p-3"><TrendChart metric={metric} /></div>
          </section>
        </>
      ) : null}

      {activeSection === "tags" ? (
        <section className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-5">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-sb-green/[0.07] text-sb-green"><Tags size={18} /></div><div><h2 className="text-xl font-semibold text-white">Chat Tags</h2><p className="text-sm text-white/35">Distribution and month-over-month change.</p></div></div>
          <div className="mt-5 grid gap-6 xl:grid-cols-[0.8fr_1.4fr]">
            <div className="rounded-2xl border border-white/8 bg-black/10 p-4"><p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/30">Tag distribution</p><BarRows rows={tags} total={displayCurrent.chats} /></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs uppercase tracking-[0.14em] text-white/30"><tr><th className="pb-3">Tag</th><th className="pb-3">Previous</th><th className="pb-3">Current</th><th className="pb-3">Share</th><th className="pb-3">Change</th></tr></thead><tbody className="divide-y divide-white/7">{tags.map((row) => <tr key={row.name}><td className="py-4 font-medium text-white/80">{row.name}</td><td className="py-4 text-white/45">{formatNumber(row.prev)}</td><td className="py-4 font-semibold text-white">{formatNumber(row.total)}</td><td className="py-4 text-white/55">{((row.total/displayCurrent.chats)*100).toFixed(1)}%</td><td className="py-4"><Delta current={row.total} previous={row.prev} /></td></tr>)}</tbody></table></div>
          </div>
        </section>
      ) : null}

      {activeSection === "prechat" ? (
        <section className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-sb-green/[0.07] text-sb-green"><FileText size={18} /></div>
              <div>
                <h2 className="text-xl font-semibold text-white">Pre-chat Forms</h2>
                <p className="text-sm text-white/35">Choose your request 👇 · dropdown answers collected before chat starts.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-white/45">Filled out: <b className="text-white">{formatNumber(preChatFilled)} times</b></span>
              <span className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-white/45">Group: <b className="text-white">SportBet Support</b></span>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-white/8 bg-black/10">
            <div className="grid grid-cols-[minmax(180px,1fr)_110px_110px_130px] gap-4 border-b border-white/8 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/30">
              <span>Answer</span><span className="text-right">Responses</span><span className="text-right">Share</span><span className="text-right">vs previous</span>
            </div>
            <div className="divide-y divide-white/7">
              {preChat.map((row) => {
                const delta = row.share - row.prevShare;
                const maxShare = Math.max(...preChat.map((item) => item.share));
                return (
                  <div key={row.value} className="px-4 py-4">
                    <div className="grid grid-cols-[minmax(180px,1fr)_110px_110px_130px] items-center gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white/85">{row.value}</p>
                        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
                          <div className="h-full rounded-full bg-sb-green" style={{ width: `${(row.share / maxShare) * 100}%` }} />
                        </div>
                      </div>
                      <p className="text-right text-sm font-semibold text-white">{formatNumber(row.count)}</p>
                      <p className="text-right text-sm font-semibold text-sb-green">{row.share.toFixed(2)}%</p>
                      <p className={`text-right text-xs font-semibold ${delta >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)} pp</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {activeSection === "emails" ? (
        <section className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard title="Total Emails" value={formatNumber(displayCurrent.emails)} current={displayCurrent.emails} previous={displayPrevious.emails} icon={Mail} />
            <StatCard title="Email FRT" value={formatTime(displayCurrent.emailFrt)} current={displayCurrent.emailFrt} previous={displayPrevious.emailFrt} icon={Clock3} lowerIsBetter />
            <StatCard title="Handling Time · Open median" value={formatTime(displayCurrent.openMedian)} current={displayCurrent.openMedian} previous={displayPrevious.openMedian} icon={Clock3} lowerIsBetter />
          </div>
          <div className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-5">
            <h2 className="text-xl font-semibold text-white">Email Tags</h2><p className="mt-1 text-sm text-white/35">Tag volume and previous-month comparison.</p>
            <div className="mt-5 grid gap-6 xl:grid-cols-[0.8fr_1.4fr]"><div className="rounded-2xl border border-white/8 bg-black/10 p-4"><p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/30">Email tag distribution</p><BarRows rows={emailTags} total={displayCurrent.emails} /></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="text-xs uppercase tracking-[0.14em] text-white/30"><tr><th className="pb-3">Tag</th><th className="pb-3">Previous</th><th className="pb-3">Current</th><th className="pb-3">Change</th></tr></thead><tbody className="divide-y divide-white/7">{emailTags.map((row) => <tr key={row.name}><td className="py-4 font-medium text-white/80">{row.name}</td><td className="py-4 text-white/45">{formatNumber(row.prev)}</td><td className="py-4 font-semibold text-white">{formatNumber(row.total)}</td><td className="py-4"><Delta current={row.total} previous={row.prev} /></td></tr>)}</tbody></table></div></div>
          </div>
        </section>
      ) : null}

      {activeSection === "history" ? (
        <section className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-[0.17em] text-white/35">Historical Trends</p><h2 className="mt-1 text-xl font-semibold text-white">6-month performance history</h2><p className="mt-1 text-sm text-white/35">Previous monthly snapshots stay available, so only the new month needs to be loaded later.</p></div>
            <select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)} className="h-10 rounded-xl border border-white/10 bg-[#101f34] px-3 text-sm text-white outline-none focus:border-sb-green/30">{(Object.keys(metricMeta) as MetricKey[]).map((key) => <option key={key} value={key}>{metricMeta[key].label}</option>)}</select>
          </div>
          <div className="mt-6 rounded-2xl border border-white/8 bg-black/10 p-3"><TrendChart metric={metric} /></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{history.map((month) => <button key={month.key} type="button" onClick={() => selectLiveMonth(history.findIndex((item) => item.key === month.key))} className={`rounded-2xl border p-4 text-left transition ${displayCurrent.key === month.key ? "border-sb-green/25 bg-sb-green/[0.07]" : "border-white/8 bg-white/[0.02] hover:border-white/15"}`}><p className="text-xs uppercase tracking-[0.14em] text-white/30">{month.label}</p><p className="mt-2 text-lg font-semibold text-white">{formatMetric(metric, month[metric] as number)}</p></button>)}</div>

        </section>
      ) : null}

      <section className="rounded-[24px] border border-white/10 bg-[#0d1a2d] p-5 sm:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.17em] text-white/35">Saved Months</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Saved monthly reports</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/35">
              Every time you press Save month, that month appears here. You can keep many months.
              Click any saved month to open exactly the statistics that were saved for it in the report above.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-xs text-white/40">
            {savedSnapshots.length} saved {savedSnapshots.length === 1 ? "month" : "months"}
          </div>
        </div>

        {savedSnapshots.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-white/35">
            No saved months yet. Select a month above and press Save month.
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {savedSnapshots
              .slice()
              .sort((a, b) => b.key.localeCompare(a.key))
              .map((snapshot) => {
                const selected = selectedSavedKey === snapshot.key;

                return (
                  <div
                    key={snapshot.key}
                    className={`rounded-2xl border p-4 transition ${
                      selected
                        ? "border-sb-green/30 bg-sb-green/[0.07]"
                        : "border-white/10 bg-white/[0.025] hover:border-white/20"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openSavedSnapshot(snapshot.key)}
                      className="block w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-white/30">
                            Saved report
                          </p>
                          <p className="mt-1 text-lg font-semibold text-white">
                            {formatMonthLabel(snapshot.key)}
                          </p>
                        </div>
                        {selected ? (
                          <span className="rounded-full border border-sb-green/20 bg-sb-green/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-sb-green">
                            Open
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-[0.1em] text-white/25">Chats</p>
                          <p className="mt-1 text-sm font-semibold text-white/80">{formatNumber(snapshot.chats)}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-[0.1em] text-white/25">CSAT</p>
                          <p className="mt-1 text-sm font-semibold text-white/80">{snapshot.csat.toFixed(1)}%</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-[0.1em] text-white/25">FRT</p>
                          <p className="mt-1 text-sm font-semibold text-white/80">{formatTime(snapshot.frt)}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-[0.1em] text-white/25">Emails</p>
                          <p className="mt-1 text-sm font-semibold text-white/80">{formatNumber(snapshot.emails)}</p>
                        </div>
                      </div>

                      <p className="mt-3 text-xs font-semibold text-sb-green">
                        Click to open saved statistics ↑
                      </p>
                    </button>

                    <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3">
                      <span className="text-[11px] text-white/25">
                        {new Date(snapshot.savedAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>

                      <button
                        type="button"
                        onClick={() => deleteSavedSnapshot(snapshot.key)}
                        className="grid h-9 w-9 place-items-center rounded-xl border border-rose-300/15 bg-rose-300/[0.06] text-rose-200 transition hover:bg-rose-300/10"
                        aria-label={`Delete ${formatMonthLabel(snapshot.key)} saved report`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </div>
  );
}
