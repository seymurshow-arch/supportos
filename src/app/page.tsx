"use client";

import {
  AlertTriangle,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  FolderCog,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SUPPORT_PROJECTS } from "@/data/supportProjects";

type Project = { name: string; groupIds: number[]; groupNames?: string[] };
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

const PROJECT_STORAGE_KEY = "supportos-command-projects-v1";
const DEFAULT_PROJECTS = [...SUPPORT_PROJECTS];

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
        className="flex h-12 w-full items-center justify-between rounded-xl border border-white/10 bg-[#0d121d] px-4 text-left text-sm text-slate-200 outline-none transition hover:border-cyan-400/30 disabled:opacity-50"
      >
        <span className="truncate">{text}</span>
        <ChevronDown size={16} className={`text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-white/10 bg-[#0b1019] p-2 shadow-2xl shadow-black/50">
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/5"
          >
            <span className={`grid h-5 w-5 place-items-center rounded-md border ${selected.length === 0 ? "border-cyan-300 bg-cyan-300 text-slate-950" : "border-white/15"}`}>
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
                <span className={`grid h-5 w-5 place-items-center rounded-md border ${checked ? "border-cyan-300 bg-cyan-300 text-slate-950" : "border-white/15"}`}>
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
  decreasing: { label: "Decreasing", icon: TrendingDown, className: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" },
  disappeared: { label: "No longer observed", icon: Check, className: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" },
};

export default function CommandCenterPage() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [projectNames, setProjectNames] = useState<string[]>(DEFAULT_PROJECTS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState("");

  async function syncProjects(names: string[]) {
    const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    const params = new URLSearchParams();
    if (clean.length) params.set("names", clean.join(","));
    const response = await fetch(`/api/livechat/projects?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load projects");
    const matched = (data.projects || []) as Project[];
    const matchedNames = matched.map((project) => project.name);
    setProjectNames(matchedNames);
    setProjects(matched);
    setSelectedProjects((current) => current.filter((name) => matchedNames.includes(name)));
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(matchedNames));
    return matched;
  }

  async function loadOptions() {
    setLoadingOptions(true);
    setError("");
    try {
      const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
      const storedNames = stored ? (JSON.parse(stored) as string[]) : [];
      const names = [...new Set([...DEFAULT_PROJECTS, ...storedNames])];
      await syncProjects(names);

      const params = new URLSearchParams({ from, to });
      const response = await fetch(`/api/livechat/tag-report?${params}`, { cache: "no-store" });
      const data = await response.json();
      const raw = data.tags || data.topTags || data.rows || data.data || [];
      const namesFromTags = Array.isArray(raw)
        ? raw.map((item) => String(item?.name || item?.tag || item?.title || "").trim()).filter(Boolean)
        : [];
      setTags([...new Set(namesFromTags)].sort((a, b) => a.localeCompare(b)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load filters");
    } finally {
      setLoadingOptions(false);
    }
  }

  useEffect(() => { void loadOptions(); }, []);

  async function addProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setError("");
    try {
      const matched = await syncProjects([...projectNames, name]);
      if (!matched.some((project) => project.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`No LiveChat groups contain “${name}”. The project was not added.`);
      }
      setNewProjectName("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Unable to add project");
    }
  }

  function removeProject(name: string) {
    void syncProjects(projectNames.filter((project) => project !== name));
  }

  async function analyze() {
    if (from > to) {
      setError("The start date cannot be later than the end date.");
      return;
    }
    setAnalyzing(true);
    setError("");
    setResult(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (selectedProjects.length) params.set("project", selectedProjects.join(","));
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
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.26em] text-cyan-300">
              <Sparkles size={15} /> AI Operations Intelligence
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">AI Command Center</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              Analyze real player conversations, detect meaningful operational issues, and compare them with the previous identical period.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/5"
          >
            <FolderCog size={17} /> Manage projects
          </button>
        </header>

        <section className="rounded-[28px] border border-white/10 bg-[#090e17]/90 p-5 shadow-2xl shadow-black/20 sm:p-6">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Bot size={20} /></span>
            <div>
              <h2 className="font-semibold text-white">Analysis scope</h2>
              <p className="text-xs text-slate-500">Empty selections automatically mean all projects and all tags.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period from</label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-12 w-full rounded-xl border border-white/10 bg-[#0d121d] pl-11 pr-3 text-sm text-slate-200 outline-none focus:border-cyan-300/40" />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period to</label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-12 w-full rounded-xl border border-white/10 bg-[#0d121d] pl-11 pr-3 text-sm text-slate-200 outline-none focus:border-cyan-300/40" />
              </div>
            </div>
            <MultiSelect label="Projects" allLabel="All projects" options={projects.map((project) => project.name)} selected={selectedProjects} onChange={setSelectedProjects} disabled={loadingOptions} />
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
              className="inline-flex h-12 min-w-44 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-6 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
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
          <section className="rounded-[28px] border border-cyan-300/15 bg-cyan-300/[0.04] px-6 py-12 text-center">
            <LoaderCircle className="mx-auto animate-spin text-cyan-300" size={34} />
            <h2 className="mt-5 text-lg font-semibold text-white">AI is reading the conversations</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">It is separating real operational problems from ordinary questions and comparing both periods semantically.</p>
          </section>
        ) : null}

        {result?.analysis ? (
          <section className="space-y-5">
            <div className="rounded-[28px] border border-cyan-300/20 bg-gradient-to-br from-cyan-300/10 to-transparent p-6">
              <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200"><Sparkles size={14} /> Executive summary</div>
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
                    <article key={`${problem.title}-${index}`} className="rounded-[24px] border border-white/10 bg-[#090e17]/90 p-5 transition hover:border-white/15">
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
                        {problem.relatedTags.map((tag) => <span key={tag} className="rounded-lg border border-cyan-300/10 bg-cyan-300/5 px-2.5 py-1.5 text-cyan-200">{tag}</span>)}
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
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">Choose the period, projects, and tags. Leave projects or tags empty to analyze all of them.</p>
          </section>
        ) : null}
      </div>

      {managerOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-[#0a0f18] p-6 shadow-2xl shadow-black">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="text-xl font-semibold text-white">Manage projects</h2><p className="mt-2 text-sm leading-6 text-slate-500">Enter a project name. Every LiveChat group containing that name will be connected automatically.</p></div>
              <button type="button" onClick={() => setManagerOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"><X size={17} /></button>
            </div>
            <div className="mt-6 flex gap-2">
              <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addProject(); }} placeholder="Project name, e.g. Roostino" className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0d121d] px-4 text-sm text-white outline-none focus:border-cyan-300/40" />
              <button type="button" onClick={() => void addProject()} className="inline-flex h-12 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-slate-950"><Plus size={17} /> Add</button>
            </div>
            <div className="mt-5 max-h-80 space-y-2 overflow-auto pr-1">
              {projects.map((project) => (
                <div key={project.name} className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-4">
                  <div className="min-w-0"><p className="font-semibold text-slate-200">{project.name}</p><p className="mt-1 truncate text-xs text-slate-500">{project.groupNames?.length || project.groupIds.length} matched LiveChat group{project.groupIds.length === 1 ? "" : "s"}</p></div>
                  <button type="button" onClick={() => removeProject(project.name)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-rose-400/15 text-rose-300 hover:bg-rose-400/10" aria-label={`Remove ${project.name}`}><Trash2 size={16} /></button>
                </div>
              ))}
              {!projects.length ? <p className="py-8 text-center text-sm text-slate-500">No matching projects.</p> : null}
            </div>
            <button type="button" onClick={() => void loadOptions()} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-cyan-200"><RefreshCw size={14} /> Resync with LiveChat groups</button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
