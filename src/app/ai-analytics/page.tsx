"use client";

import {
  AlertTriangle,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type ProblemStatus = "important" | "growing" | "decreasing" | "new" | "disappeared";
type Problem = {
  title: string;
  description: string;
  status: ProblemStatus;
  currentCount: number;
  previousCount: number;
  percentChange: number | null;
  chatIds: string[];
  relatedTags: string[];
};
type AnalysisResponse = {
  ok: boolean;
  error?: string;
  period?: { from: string; to: string };
  previousPeriod?: { from: string; to: string };
  stats?: {
    currentChatsAnalyzed: number;
    previousChatsAnalyzed: number;
  };
  analysis?: { summary: string; problems: Problem[]; notes: string[] };
};

const PROJECT = "SportBet";

function isoDate(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 6);
  return { from: isoDate(from), to: isoDate(to) };
}

function MultiSelect({
  label,
  allLabel,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  allLabel: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const text = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-full items-center justify-between rounded-xl border border-white/10 bg-[#101f34] px-4 text-left text-sm text-slate-200 outline-none transition hover:border-sb-green/30 disabled:opacity-50"
      >
        <span className="truncate">{text}</span>
        <ChevronDown size={16} className={`text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-white/10 bg-[#0e1b2e] p-2 shadow-2xl shadow-black/50">
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/5"
          >
            <span className={`grid h-5 w-5 place-items-center rounded-md border ${selected.length === 0 ? "border-sb-green bg-sb-green text-slate-950" : "border-white/15"}`}>
              {selected.length === 0 ? <Check size={13} /> : null}
            </span>
            {allLabel}
          </button>
          {options.map((option) => {
            const checked = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(checked ? selected.filter((item) => item !== option) : [...selected, option])}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/5"
              >
                <span className={`grid h-5 w-5 place-items-center rounded-md border ${checked ? "border-sb-green bg-sb-green text-slate-950" : "border-white/15"}`}>
                  {checked ? <Check size={13} /> : null}
                </span>
                <span className="truncate">{option}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const statusMeta: Record<ProblemStatus, { label: string; icon: typeof AlertTriangle; className: string }> = {
  growing: { label: "Growing", icon: TrendingUp, className: "border-rose-400/25 bg-rose-400/10 text-rose-200" },
  new: { label: "New issue", icon: CircleAlert, className: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  important: { label: "Important", icon: AlertTriangle, className: "border-orange-300/25 bg-orange-300/10 text-orange-100" },
  decreasing: { label: "Decreasing", icon: TrendingDown, className: "border-sb-green/25 bg-sb-green/10 text-sb-green" },
  disappeared: { label: "No longer observed", icon: Check, className: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" },
};

export default function AiAnalyticsPage() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState("");

  async function loadOptions() {
    setLoadingOptions(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to, project: PROJECT });
      const response = await fetch(`/api/livechat/tag-report?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Unable to load tags");
      const raw = data.tags || data.topTags || data.rows || data.data || [];
      const namesFromTags = Array.isArray(raw)
        ? raw.map((item) => String(item?.name || item?.tag || item?.title || "").trim()).filter(Boolean)
        : [];
      setTags([...new Set(namesFromTags)].sort((a, b) => a.localeCompare(b)) as string[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load filters");
    } finally {
      setLoadingOptions(false);
    }
  }

  useEffect(() => {
    void loadOptions();
    // Load once on entry; dates can still be changed before analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function analyze() {
    if (from > to) {
      setError("The start date cannot be later than the end date.");
      return;
    }
    setAnalyzing(true);
    setError("");
    setResult(null);
    try {
      const params = new URLSearchParams({ from, to, project: PROJECT });
      if (selectedTags.length) params.set("tags", selectedTags.join(","));
      const response = await fetch(`/api/ai/chat-problems?${params}`, { cache: "no-store" });
      const data = (await response.json()) as AnalysisResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "AI analysis failed");
      setResult(data);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "AI analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main className="min-h-full bg-[radial-gradient(circle_at_45%_-20%,rgba(34,211,238,0.08),transparent_38%)] px-5 py-7 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1500px] space-y-7">
        <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.26em] text-sb-green">
              <Sparkles size={15} /> AI Operations Intelligence
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">AI Analytics</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              Analyze SportBet player conversations, detect meaningful operational issues, and compare them with the previous identical period.
            </p>
          </div>
          <div className="rounded-xl border border-sb-green/15 bg-sb-green/[0.05] px-4 py-3 text-sm">
            <span className="text-slate-500">Project</span>
            <strong className="ml-2 text-sb-green">SportBet</strong>
          </div>
        </header>

        <section className="rounded-[28px] border border-white/10 bg-[#0c192b]/90 p-5 shadow-2xl shadow-black/20 sm:p-6">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-sb-green/20 bg-sb-green/10 text-sb-green"><Bot size={20} /></span>
            <div>
              <h2 className="font-semibold text-white">Analysis scope</h2>
              <p className="text-xs text-slate-500">SportBet is fixed as the project. Leave tags empty to analyze all tags.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period from</label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-12 w-full rounded-xl border border-white/10 bg-[#101f34] pl-11 pr-3 text-sm text-slate-200 outline-none focus:border-sb-green/40" />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period to</label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-12 w-full rounded-xl border border-white/10 bg-[#101f34] pl-11 pr-3 text-sm text-slate-200 outline-none focus:border-sb-green/40" />
              </div>
            </div>
            <MultiSelect label="Tags" allLabel="All tags" options={tags} selected={selectedTags} onChange={setSelectedTags} disabled={loadingOptions} />
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-white/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Comparison: the immediately preceding period of the same length. Spam, test chats, and empty conversations are excluded.
            </p>
            <button
              type="button"
              disabled={analyzing || loadingOptions}
              onClick={() => void analyze()}
              className="inline-flex h-12 min-w-44 items-center justify-center gap-2 rounded-xl bg-sb-green px-6 text-sm font-bold text-slate-950 transition hover:bg-sb-green disabled:cursor-not-allowed disabled:opacity-60"
            >
              {analyzing ? <LoaderCircle size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {analyzing ? "Analyzing chats…" : "Analyze"}
            </button>
          </div>
        </section>

        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
            <CircleAlert className="mt-0.5 shrink-0" size={18} /><span>{error}</span>
          </div>
        ) : null}

        {analyzing ? (
          <section className="rounded-[28px] border border-sb-green/15 bg-sb-green/[0.04] px-6 py-12 text-center">
            <LoaderCircle className="mx-auto animate-spin text-sb-green" size={34} />
            <h2 className="mt-5 text-lg font-semibold text-white">AI is reading the conversations</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">It is separating real operational problems from ordinary questions and comparing both periods semantically.</p>
          </section>
        ) : null}

        {result?.analysis ? (
          <section className="space-y-5">
            <div className="rounded-[28px] border border-sb-green/20 bg-gradient-to-br from-sb-green/10 to-transparent p-6">
              <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-sb-green"><Sparkles size={14} /> Executive summary</div>
                  <p className="mt-4 max-w-4xl text-base leading-7 text-slate-200">{result.analysis.summary}</p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"><strong className="block text-lg text-white">{result.stats?.currentChatsAnalyzed ?? 0}</strong><span className="text-slate-500">Current chats</span></div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"><strong className="block text-lg text-white">{result.stats?.previousChatsAnalyzed ?? 0}</strong><span className="text-slate-500">Previous chats</span></div>
                </div>
              </div>
            </div>

            {result.analysis.problems.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {result.analysis.problems.map((problem, index) => {
                  const meta = statusMeta[problem.status];
                  const Icon = meta.icon;
                  return (
                    <article key={`${problem.title}-${index}`} className="rounded-[24px] border border-white/10 bg-[#0c192b]/90 p-5 transition hover:border-white/15">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${meta.className}`}><Icon size={13} /> {meta.label}</span>
                          <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">{problem.title}</h3>
                        </div>
                        {problem.percentChange !== null ? (
                          <span className={`shrink-0 rounded-xl px-3 py-2 text-sm font-bold ${problem.percentChange > 0 ? "bg-rose-400/10 text-rose-200" : "bg-emerald-400/10 text-emerald-200"}`}>
                            {problem.percentChange > 0 ? "+" : ""}{problem.percentChange.toFixed(1)}%
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-4 text-sm leading-6 text-slate-300">{problem.description}</p>
                      <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-400">
                        <span className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5">Current: {problem.currentCount}</span>
                        <span className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5">Previous: {problem.previousCount}</span>
                        {problem.relatedTags.map((tag) => <span key={tag} className="rounded-lg border border-sb-green/10 bg-sb-green/5 px-2.5 py-1.5 text-sb-green">{tag}</span>)}
                      </div>
                      {problem.chatIds.length ? (
                        <div className="mt-5 border-t border-white/5 pt-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">Supporting chat IDs</p>
                          <div className="mt-2 flex flex-wrap gap-2">{problem.chatIds.slice(0, 3).map((id) => <code key={id} className="rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-slate-300">{id}</code>)}</div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[28px] border border-emerald-300/20 bg-emerald-300/8 p-10 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-300/15 text-emerald-200"><Check size={24} /></span>
                <h2 className="mt-4 text-xl font-semibold text-white">No important issues found</h2>
                <p className="mt-2 text-sm text-slate-400">The AI did not detect a recurring, growing, new, or recently disappeared operational problem for these filters.</p>
              </div>
            )}
          </section>
        ) : !analyzing ? (
          <section className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.015] px-6 py-16 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-500"><Bot size={27} /></span>
            <h2 className="mt-5 text-lg font-semibold text-slate-200">Ready for analysis</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">Choose the period and tags. SportBet is already selected as the only project.</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
