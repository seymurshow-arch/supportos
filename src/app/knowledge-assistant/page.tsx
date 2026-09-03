"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

type Source = {
  id: string;
  sourceType: "notion" | "terms";
  priority: 1 | 2;
  title: string;
  url: string | null;
};

type AskResponse = {
  ok: boolean;
  question?: string;
  answer?: string;
  found?: boolean;
  sources?: Source[];
  error?: string;
  meta?: {
    model: string;
    totalKnowledgeSources: number;
    notionSources: number;
    termsSources: number;
    relevantSourcesSentToAI: number;
    knowledgeLoadMs: number;
    notionError: string | null;
  };
};

type CacheStatus = {
  ok: boolean;
  cached?: boolean;
  updatedAt?: string | null;
  nextRefreshAt?: string | null;
  notionSources?: number;
  refreshed?: boolean;
  error?: string;
};

const examples = [
  "What is the minimum deposit required to claim a deposit bonus?",
  "What should support do if a player asks to close their account?",
  "Can a player cancel a sportsbook bet after it has been placed?",
  "What happens if a soccer match is interrupted and not completed within 12 hours?",
];

function formatDate(value: string | null | undefined) {
  if (!value) return "Not loaded yet";

  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function KnowledgeAssistantPage() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => question.trim().length > 0 && !loading,
    [question, loading]
  );

  async function loadCacheStatus() {
    try {
      const response = await fetch("/api/knowledge/cache", {
        cache: "no-store",
      });

      const data = (await response.json()) as CacheStatus;

      if (response.ok && data.ok) {
        setCacheStatus(data);
      }
    } catch {
      // Status display is non-critical.
    }
  }

  useEffect(() => {
    void loadCacheStatus();
  }, []);

  async function refreshKnowledge() {
    if (refreshing) return;

    setRefreshing(true);
    setRefreshMessage(null);

    try {
      const response = await fetch("/api/knowledge/cache", {
        method: "POST",
        cache: "no-store",
      });

      const data = (await response.json()) as CacheStatus;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Knowledge refresh failed");
      }

      setCacheStatus({
        ok: true,
        cached: true,
        updatedAt: data.updatedAt || null,
        nextRefreshAt: data.nextRefreshAt || null,
        notionSources: data.notionSources || 0,
      });

      setRefreshMessage(
        `Knowledge updated successfully · ${data.notionSources || 0} Notion sources`
      );
    } catch (error) {
      setRefreshMessage(
        error instanceof Error
          ? error.message
          : "Knowledge refresh failed"
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function ask(questionOverride?: string) {
    const value = (questionOverride ?? question).trim();

    if (!value || loading) return;

    setQuestion(value);
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/knowledge/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: value,
        }),
        cache: "no-store",
      });

      const data = (await response.json()) as AskResponse;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || "Knowledge request failed"
        );
      }

      setResult(data);
      void loadCacheStatus();
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Knowledge request failed",
      });
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-6 shadow-2xl shadow-black/10 sm:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
              <Sparkles size={15} />
              SportBet Support
            </div>

            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Knowledge Assistant
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">
              Ask questions against the connected SportBet knowledge base.
              Answers are grounded only in Notion internal procedures and the
              full static SportBet Terms document.
            </p>
          </div>

          <div className="min-w-[320px]">
            <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
              <button
                type="button"
                onClick={() => void refreshKnowledge()}
                disabled={refreshing}
                className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-300/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  size={14}
                  className={refreshing ? "animate-spin" : ""}
                />

                {refreshing
                  ? "Refreshing..."
                  : "Refresh Knowledge"}
              </button>

              <div className="flex items-center gap-2 rounded-full border border-purple-300/15 bg-purple-300/[0.06] px-3 py-2 text-xs text-purple-100">
                <BookOpen size={14} />
                Notion SOP
              </div>

              <div className="flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-100">
                <ShieldCheck size={14} />
                Full Terms
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-[11px] leading-5 text-white/40">
              <div className="flex justify-between gap-4">
                <span>Last update</span>
                <span className="text-right text-white/65">
                  {formatDate(cacheStatus?.updatedAt)}
                </span>
              </div>

              <div className="mt-1 flex justify-between gap-4">
                <span>Next auto refresh</span>
                <span className="text-right text-white/65">
                  {formatDate(cacheStatus?.nextRefreshAt)}
                </span>
              </div>

              <div className="mt-1 flex justify-between gap-4">
                <span>Notion sources</span>
                <span className="text-white/65">
                  {cacheStatus?.notionSources ?? 0}
                </span>
              </div>
            </div>

            {refreshMessage ? (
              <div className="mt-2 text-right text-[11px] text-emerald-200/70">
                {refreshMessage}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-5 sm:p-6">
        <form onSubmit={submit}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Bot
              className="text-emerald-300"
              size={18}
            />
            Ask the knowledge base
          </div>

          <div className="relative">
            <textarea
              value={question}
              onChange={(event) =>
                setQuestion(event.target.value)
              }
              placeholder="Наприклад: Що робити, якщо гравець просить закрити акаунт?"
              rows={5}
              className="w-full resize-none rounded-2xl border border-white/10 bg-[#091626] px-4 py-4 pr-14 text-sm leading-6 text-white outline-none placeholder:text-white/25 focus:border-emerald-300/30"
            />

            <Search
              size={18}
              className="pointer-events-none absolute right-4 top-4 text-white/20"
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-white/35">
              AI must answer only from connected knowledge. If the answer is
              not there, it should say so.
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 text-sm font-bold text-[#06101c] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <>
                  <Loader2
                    className="animate-spin"
                    size={17}
                  />
                  Searching...
                </>
              ) : (
                <>
                  <Send size={17} />
                  Ask AI
                </>
              )}
            </button>
          </div>
        </form>

        <div className="mt-5 border-t border-white/10 pt-5">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-white/30">
            Quick tests
          </div>

          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => void ask(example)}
                disabled={loading}
                className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-xs text-white/55 transition hover:border-white/20 hover:bg-white/[0.05] hover:text-white/80 disabled:opacity-40"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </section>

      {result?.error ? (
        <section className="rounded-[22px] border border-rose-300/20 bg-rose-300/[0.06] p-5">
          <div className="flex items-center gap-2 font-semibold text-rose-100">
            <TriangleAlert size={18} />
            Request failed
          </div>

          <p className="mt-2 text-sm text-rose-100/70">
            {result.error}
          </p>
        </section>
      ) : null}

      {result?.ok ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-lg font-bold">
                <Bot
                  className="text-emerald-300"
                  size={20}
                />
                Answer
              </div>

              <div
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  result.found
                    ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200"
                    : "border-amber-300/20 bg-amber-300/[0.06] text-amber-100"
                }`}
              >
                {result.found ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <TriangleAlert size={14} />
                )}

                {result.found
                  ? "Supported by knowledge"
                  : "Not found in knowledge"}
              </div>
            </div>

            <div className="mt-5 whitespace-pre-wrap text-[15px] leading-7 text-white/75">
              {result.answer}
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-5">
              <div className="mb-4 text-sm font-bold">
                Sources used
              </div>

              {result.sources?.length ? (
                <div className="space-y-3">
                  {result.sources.map((source) => (
                    <div
                      key={source.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
                            source.sourceType === "notion"
                              ? "bg-purple-300/10 text-purple-200"
                              : "bg-emerald-300/10 text-emerald-200"
                          }`}
                        >
                          {source.sourceType}
                        </span>

                        <span className="text-[10px] text-white/25">
                          Priority {source.priority}
                        </span>
                      </div>

                      <div className="text-sm font-semibold text-white/80">
                        {source.title}
                      </div>

                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200"
                        >
                          Open source
                          <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-white/35">
                  No source was cited for this answer.
                </div>
              )}
            </div>

            {result.meta ? (
              <div className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-5">
                <div className="mb-4 text-sm font-bold">
                  Knowledge status
                </div>

                <div className="space-y-3 text-xs text-white/45">
                  <div className="flex justify-between gap-3">
                    <span>Total sources</span>
                    <b className="text-white/75">
                      {result.meta.totalKnowledgeSources}
                    </b>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>Notion</span>
                    <b className="text-purple-200">
                      {result.meta.notionSources}
                    </b>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>Terms chunks</span>
                    <b className="text-emerald-200">
                      {result.meta.termsSources}
                    </b>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>Sent to AI</span>
                    <b className="text-white/75">
                      {result.meta.relevantSourcesSentToAI}
                    </b>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>Knowledge load</span>
                    <b className="text-white/75">
                      {result.meta.knowledgeLoadMs} ms
                    </b>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>Model</span>
                    <b className="max-w-[180px] truncate text-white/75">
                      {result.meta.model}
                    </b>
                  </div>
                </div>

                {result.meta.notionError ? (
                  <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-xs leading-5 text-amber-100/70">
                    Notion warning: {result.meta.notionError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}
    </div>
  );
}
