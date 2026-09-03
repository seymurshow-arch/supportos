"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SPORTBET_PROJECT } from "@/data/supportProjects";

type TagOption = {
  tag: string;
  label: string;
  total: number;
};

type AiProblem = {
  title: string;
  count: number;
  severity: "low" | "medium" | "high";
  examples: string[];
  whatPlayersSay: string;
  likelyReason: string;
  recommendedAction: string;
  relatedTags: string[];
};

type AiComparisonItem = {
  title: string;
  currentCount: number;
  previousCount: number;
  explanation: string;
  examples: string[];
};

type AiResponse = {
  ok: boolean;
  period?: {
    from: string;
    to: string;
  };
  previousPeriod?: {
    from: string;
    to: string;
  };
  filters?: {
    projects: string[];
    tags: string[];
  };
  stats?: {
    currentArchivesLoaded: number;
    previousArchivesLoaded: number;
    currentChatsAnalyzed: number;
    previousChatsAnalyzed: number;
  };
  analysis?: {
    currentProblems: AiProblem[];
    comparison: {
      resolvedOrReduced: AiComparisonItem[];
      stillActive: AiComparisonItem[];
      newProblems: AiComparisonItem[];
    };
    summary: string;
    notes: string[];
  };
  debug?: {
    aiEnabled: boolean;
    model: string;
    limit: number;
  };
  error?: string;
};


function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function defaultFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return dateInputValue(date);
}

function severityClasses(severity: AiProblem["severity"]) {
  if (severity === "high") {
    return {
      card: "border-rose-300/25 bg-rose-300/10",
      badge: "border-rose-300/30 bg-rose-300/15 text-rose-100",
      text: "text-rose-200",
    };
  }

  if (severity === "medium") {
    return {
      card: "border-amber-300/25 bg-amber-300/10",
      badge: "border-amber-300/30 bg-amber-300/15 text-amber-100",
      text: "text-amber-200",
    };
  }

  return {
    card: "border-cyan-300/25 bg-cyan-300/10",
    badge: "border-cyan-300/30 bg-cyan-300/15 text-cyan-100",
    text: "text-cyan-200",
  };
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

function uniqueToggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

async function readJsonResponse(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    const shortText = text.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      `API returned non-JSON response. Status ${response.status}. ${shortText || "Empty response"}`,
    );
  }
}

function isValidDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}


function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-300">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
    </div>
  );
}

function ComparisonCard({
  item,
  tone,
}: {
  item: AiComparisonItem;
  tone: "emerald" | "amber" | "cyan";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-300/25 bg-emerald-300/10"
      : tone === "amber"
        ? "border-amber-300/25 bg-amber-300/10"
        : "border-cyan-300/25 bg-cyan-300/10";

  return (
    <div className={`rounded-2xl border ${toneClass} p-4`}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-lg font-semibold text-white">{item.title}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{item.explanation}</p>
        </div>

        <div className="flex shrink-0 gap-2">
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-200">
            Now {formatNumber(item.currentCount)}
          </span>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-200">
            Prev {formatNumber(item.previousCount)}
          </span>
        </div>
      </div>

      {item.examples?.length ? (
        <div className="mt-4 space-y-2">
          {item.examples.slice(0, 3).map((example) => (
            <p key={example} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-6 text-slate-200">
              “{example}”
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AiIssuesPage() {
  const [from, setFrom] = useState(defaultFromDate);
  const [to, setTo] = useState(() => dateInputValue(new Date()));
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [limit, setLimit] = useState(120);
  const [loadingTags, setLoadingTags] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTags() {
    setLoadingTags(true);

    try {
      const params = new URLSearchParams({
        mode: "list",
        from,
        to,
      });

      params.set("project", SPORTBET_PROJECT);

      const response = await fetch(`/api/livechat/tag-report?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const json = await readJsonResponse(response);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to load LiveChat tags. Status ${response.status}`);
      }

      setTags(Array.isArray(json.tags) ? json.tags : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load tags");
      setTags([]);
    } finally {
      setLoadingTags(false);
    }
  }

  async function runAnalysis() {
    setAnalyzing(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        from,
        to,
        limit: String(limit),
      });

      params.set("project", SPORTBET_PROJECT);

      if (selectedTags.length) {
        params.set("tags", selectedTags.join(","));
      }

      if (!isValidDateInput(from) || !isValidDateInput(to)) {
        throw new Error("Date must be in YYYY-MM-DD format, for example 2026-07-03.");
      }

      const response = await fetch(`/api/ai/chat-problems?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const json = await readJsonResponse(response);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `AI analysis failed. Status ${response.status}`);
      }

      setResult(json);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "AI analysis failed");
      setResult(null);
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    void loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTags = useMemo(() => {
    const query = tagSearch.trim().toLowerCase();

    if (!query) return tags.slice(0, 60);

    return tags
      .filter((tag) => {
        return (
          tag.tag.toLowerCase().includes(query) ||
          tag.label.toLowerCase().includes(query)
        );
      })
      .slice(0, 60);
  }, [tagSearch, tags]);

  const currentProblems = result?.analysis?.currentProblems || [];
  const comparison = result?.analysis?.comparison;

  const highCount = currentProblems.filter((item) => item.severity === "high").length;
  const mediumCount = currentProblems.filter((item) => item.severity === "medium").length;
  const lowCount = currentProblems.filter((item) => item.severity === "low").length;

  return (
    <main className="min-h-screen bg-[#050811] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-20%] top-[-10%] h-[520px] w-[520px] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute right-[-10%] top-[20%] h-[520px] w-[520px] rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">SupportOS AI</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                AI Issues
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                AI scans real LiveChat player messages, finds repeated current problems, and compares them with the previous same-length period.
              </p>
            </div>

            <Link
              href="/"
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Back to Command Center
            </Link>
          </div>
        </header>

        <Panel title="Filters">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">From</span>
              <input
                type="text"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder="YYYY-MM-DD"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/50"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">To</span>
              <input
                type="text"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="YYYY-MM-DD"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/50"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Chats limit</span>
              <select
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
              >
                <option value={80}>80 chats</option>
                <option value={120}>120 chats</option>
                <option value={200}>200 chats</option>
                <option value={300}>300 chats</option>
              </select>
            </label>

            <button
              onClick={() => void loadTags()}
              disabled={loadingTags}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingTags ? "Loading tags..." : "Reload tags"}
            </button>

            <button
              onClick={() => void runAnalysis()}
              disabled={analyzing}
              className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzing ? "Analyzing..." : "Analyze"}
            </button>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Project</p>
              <p className="mt-2 text-sm font-semibold text-cyan-100">SportBet</p>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">LiveChat Tags</p>
                <button
                  onClick={() => setSelectedTags([])}
                  className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                >
                  All tags
                </button>
              </div>

              <input
                value={tagSearch}
                onChange={(event) => setTagSearch(event.target.value)}
                placeholder="Search tags..."
                className="mb-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/50"
              />

              <div className="max-h-56 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-3">
                {filteredTags.length ? (
                  <div className="flex flex-wrap gap-2">
                    {filteredTags.map((tag) => {
                      const active = selectedTags.includes(tag.tag);

                      return (
                        <button
                          key={tag.tag}
                          onClick={() => setSelectedTags((prev) => uniqueToggle(prev, tag.tag))}
                          className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                            active
                              ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100"
                              : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"
                          }`}
                          title={tag.tag}
                        >
                          {tag.label} · {tag.total}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="p-3 text-sm text-slate-500">
                    {loadingTags ? "Loading tags..." : "No tags found."}
                  </p>
                )}
              </div>

              <p className="mt-3 text-xs text-slate-500">
                If no tag is selected, AI analyzes all tags.
              </p>
            </div>
          </div>
        </Panel>

        {error ? (
          <section className="rounded-3xl border border-rose-300/20 bg-rose-300/10 p-5 text-rose-100">
            <p className="font-semibold">Error</p>
            <p className="mt-2 text-sm opacity-80">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/70">Current chats</p>
            <p className="mt-3 text-3xl font-semibold text-white">{formatNumber(result?.stats?.currentChatsAnalyzed)}</p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Previous chats</p>
            <p className="mt-3 text-3xl font-semibold text-white">{formatNumber(result?.stats?.previousChatsAnalyzed)}</p>
          </div>

          <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-100/70">High</p>
            <p className="mt-3 text-3xl font-semibold text-white">{highCount}</p>
          </div>

          <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-100/70">Medium</p>
            <p className="mt-3 text-3xl font-semibold text-white">{mediumCount}</p>
          </div>

          <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100/70">Low</p>
            <p className="mt-3 text-3xl font-semibold text-white">{lowCount}</p>
          </div>
        </section>

        {result?.analysis?.summary ? (
          <section className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-100/70">AI Summary</p>
            <p className="mt-3 text-lg leading-8 text-white">{result.analysis.summary}</p>
            <p className="mt-3 text-xs text-cyan-100/60">
              Current: {result.period?.from} — {result.period?.to} · Previous: {result.previousPeriod?.from} — {result.previousPeriod?.to}
            </p>
          </section>
        ) : null}

        <Panel title="Current Repeating Player Problems">
          {currentProblems.length ? (
            <div className="grid gap-5">
              {currentProblems.map((problem, index) => {
                const classes = severityClasses(problem.severity);

                return (
                  <article key={`${problem.title}-${index}`} className={`rounded-3xl border ${classes.card} p-5`}>
                    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${classes.badge}`}>
                            {problem.severity.toUpperCase()}
                          </span>
                          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-200">
                            {formatNumber(problem.count)} chats
                          </span>
                        </div>

                        <h2 className="mt-4 text-2xl font-semibold text-white">{problem.title}</h2>
                        <p className="mt-3 text-sm leading-6 text-slate-300">{problem.whatPlayersSay}</p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Player examples</p>
                        <div className="mt-3 space-y-2">
                          {problem.examples?.length ? (
                            problem.examples.slice(0, 4).map((example) => (
                              <p key={example} className="rounded-xl bg-white/[0.04] p-3 text-sm leading-6 text-white/90">
                                “{example}”
                              </p>
                            ))
                          ) : (
                            <p className="text-sm text-slate-500">No examples returned.</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Likely reason</p>
                        <p className="mt-3 text-sm leading-6 text-white/90">{problem.likelyReason}</p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Recommended action</p>
                        <p className="mt-3 text-sm leading-6 text-white/90">{problem.recommendedAction}</p>

                        {problem.relatedTags?.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {problem.relatedTags.map((tag) => (
                              <span key={tag} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-slate-200">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No analysis yet"
              text="Select filters and click Analyze. AI will read player messages and group repeated problems."
            />
          )}
        </Panel>

        <section className="grid gap-6 xl:grid-cols-3">
          <Panel title="Resolved / Reduced">
            {comparison?.resolvedOrReduced?.length ? (
              <div className="space-y-3">
                {comparison.resolvedOrReduced.map((item) => (
                  <ComparisonCard key={item.title} item={item} tone="emerald" />
                ))}
              </div>
            ) : (
              <EmptyState title="No reduced issues" text="Nothing reduced or resolved was detected yet." />
            )}
          </Panel>

          <Panel title="Still Active">
            {comparison?.stillActive?.length ? (
              <div className="space-y-3">
                {comparison.stillActive.map((item) => (
                  <ComparisonCard key={item.title} item={item} tone="amber" />
                ))}
              </div>
            ) : (
              <EmptyState title="No still-active issues" text="No repeated issue was detected in both periods yet." />
            )}
          </Panel>

          <Panel title="New Problems">
            {comparison?.newProblems?.length ? (
              <div className="space-y-3">
                {comparison.newProblems.map((item) => (
                  <ComparisonCard key={item.title} item={item} tone="cyan" />
                ))}
              </div>
            ) : (
              <EmptyState title="No new problems" text="AI did not detect new repeated issues compared with previous same period." />
            )}
          </Panel>
        </section>

        {result?.analysis?.notes?.length ? (
          <Panel title="Notes">
            <div className="space-y-3">
              {result.analysis.notes.map((note) => (
                <p key={note} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
                  {note}
                </p>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
    </main>
  );
}
