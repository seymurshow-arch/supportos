"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  XCircle,
} from "lucide-react";

type Agent = { id: string; name: string; email: string };
type Review = {
  chatId: string;
  agent: string;
  date: string;
  score: number;
  result: "Passed" | "Issue";
  issue: string;
  rule: string;
  finding: string;
  recommendedAction: string;
};

type Mode = "agent" | "chat";

export default function KnowledgePage() {
  const [mode, setMode] = useState<Mode>("agent");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [scheduleMonth, setScheduleMonth] = useState("2026-08");
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentsStatus, setAgentsStatus] = useState("Loading agents from Schedule...");
  const [from, setFrom] = useState("2026-08-20");
  const [to, setTo] = useState("2026-08-21");
  const [chatId, setChatId] = useState("");
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState("");
  const [completed, setCompleted] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewResults, setReviewResults] = useState<Review[]>([]);
  const [reviewError, setReviewError] = useState("");
  const [reviewMeta, setReviewMeta] = useState<{
    chatsLoaded: number;
    chatsMatched: number;
    model: string;
    knowledgeMode: string;
  } | null>(null);

  async function loadAgentsFromSchedule(monthKey: string) {
    setLoadingAgents(true);
    setAgentsStatus("Loading agents from Schedule...");
    try {
      const response = await fetch(
        `/api/google-sheets/schedule?month=${encodeURIComponent(monthKey)}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Failed to load schedule");

      const scheduleAgents = Array.isArray(data.agents) ? data.agents : [];
      const nextAgents: Agent[] = scheduleAgents.map((name: string) => ({
        id: name,
        name,
        email: typeof data.agentEmails?.[name] === "string" ? data.agentEmails[name] : "",
      }));

      setAgents(nextAgents);
      setAgentId((current) =>
        current && nextAgents.some((item) => item.id === current)
          ? current
          : nextAgents[0]?.id ?? ""
      );
      setAgentsStatus(
        nextAgents.length
          ? `${nextAgents.length} agents loaded from Schedule`
          : "No agents found in Schedule"
      );
    } catch (error) {
      setAgents([]);
      setAgentId("");
      setAgentsStatus(error instanceof Error ? error.message : "Schedule agents load error");
    } finally {
      setLoadingAgents(false);
    }
  }

  useEffect(() => {
    void loadAgentsFromSchedule(scheduleMonth);
  }, [scheduleMonth]);

  useEffect(() => {
    setReviewResults([]);
    setReviewMeta(null);
    setReviewError("");
    setCompleted(false);
  }, [agentId, from, to, chatId, mode]);

  const agent = agents.find((item) => item.id === agentId) ?? agents[0] ?? null;

  const reviews = useMemo(
    () =>
      reviewResults.filter((item) =>
        `${item.chatId} ${item.agent} ${item.issue} ${item.rule} ${item.finding} ${item.recommendedAction}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [reviewResults, query]
  );

  const avg = Math.round(
    reviews.reduce((sum, item) => sum + item.score, 0) /
      Math.max(reviews.length, 1)
  );
  const issues = reviews.filter((item) => item.result === "Issue").length;

  async function runReview() {
    if (mode === "agent" && !agent) return;
    if (mode === "chat" && !chatId.trim()) {
      setReviewError("Встав LiveChat Chat ID.");
      return;
    }

    setRunning(true);
    setCompleted(false);
    setReviewError("");
    setReviewResults([]);
    setReviewMeta(null);

    try {
      const body =
        mode === "chat"
          ? { mode: "chat", chatId: chatId.trim() }
          : {
              mode: "agent",
              agentName: agent!.name,
              agentEmail: agent!.email || null,
              from,
              to,
              maxChats: 30,
            };

      const response = await fetch("/api/knowledge/qa-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "AI QA review failed");

      setReviewResults(Array.isArray(data.reviews) ? data.reviews : []);
      setReviewMeta({
        chatsLoaded: Number(data.chatsLoaded || 0),
        chatsMatched: Number(data.chatsMatched || 0),
        model: String(data.model || ""),
        knowledgeMode: String(data.knowledgeMode || ""),
      });
      setCompleted(true);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "AI QA review failed");
    } finally {
      setRunning(false);
    }
  }

  async function refreshKnowledge() {
    setRefreshing(true);
    setRefreshStatus("");
    try {
      const response = await fetch("/api/knowledge/cache", {
        method: "POST",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Knowledge refresh failed");
      setRefreshStatus("Knowledge оновлено");
    } catch (error) {
      setRefreshStatus(error instanceof Error ? error.message : "Knowledge refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1700px] space-y-6">
      <header className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-sb-green">
              <ShieldCheck size={15}/> SportBet quality assurance
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Knowledge / QA</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">
              Перевіряй чати агента за період або встав конкретний LiveChat Chat ID. QA використовує ту саму базу знань, що й Knowledge Assistant.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-sb-green/15 bg-sb-green/[0.06] px-4 py-3 text-sm text-sb-green">
              <span className="font-semibold">Knowledge:</span> Notion + Static SportBet Terms
            </div>
            <button
              onClick={refreshKnowledge}
              disabled={refreshing}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-[#101f34] px-4 text-sm font-semibold text-white/70 transition hover:border-sb-green/30 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""}/>
              {refreshing ? "Refreshing…" : "Refresh Knowledge"}
            </button>
          </div>
        </div>
        {refreshStatus ? <p className="mt-3 text-xs text-sb-green">{refreshStatus}</p> : null}
      </header>

      <section className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-5">
        <div className="mb-5 inline-flex rounded-xl border border-white/10 bg-black/10 p-1">
          <button
            onClick={() => setMode("agent")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              mode === "agent" ? "bg-sb-green text-slate-950" : "text-white/45 hover:text-white"
            }`}
          >
            Agent QA
          </button>
          <button
            onClick={() => setMode("chat")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              mode === "chat" ? "bg-sb-green text-slate-950" : "text-white/45 hover:text-white"
            }`}
          >
            Chat ID
          </button>
        </div>

        {mode === "agent" ? (
          <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr_1fr_auto] xl:items-end">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-white/35">Agent</span>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-3.5 text-white/30" size={17}/>
                <select value={agentId} onChange={(e)=>setAgentId(e.target.value)} disabled={loadingAgents || agents.length===0} className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#101f34] pl-10 pr-9 text-sm text-white outline-none focus:border-sb-green/30 disabled:opacity-50">
                  {agents.length === 0 ? <option value="">No agents</option> : agents.map((a)=><option key={a.id} value={a.id}>{a.email ? `${a.name} · ${a.email}` : a.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-white/30" size={16}/>
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-white/35">Schedule month</span>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-3.5 text-white/30" size={17}/>
                <input type="month" value={scheduleMonth} onChange={(e)=>setScheduleMonth(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-[#101f34] pl-10 pr-3 text-sm text-white outline-none focus:border-sb-green/30"/>
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-white/35">From</span>
              <input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-[#101f34] px-3 text-sm text-white outline-none focus:border-sb-green/30"/>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-white/35">To</span>
              <input type="date" value={to} onChange={(e)=>setTo(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-[#101f34] px-3 text-sm text-white outline-none focus:border-sb-green/30"/>
            </label>

            <button onClick={runReview} disabled={running || !agent} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-sb-green px-5 text-sm font-bold text-slate-950 transition disabled:opacity-60">
              {running ? <Loader2 className="animate-spin" size={17}/> : <Sparkles size={17}/>}
              {running ? "Analyzing…" : "Run AI review"}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-end">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-white/35">LiveChat Chat ID</span>
              <div className="relative">
                <MessageSquareText className="pointer-events-none absolute left-3 top-3.5 text-white/30" size={17}/>
                <input
                  value={chatId}
                  onChange={(e)=>setChatId(e.target.value)}
                  onKeyDown={(e)=>{ if (e.key === "Enter" && !running) void runReview(); }}
                  placeholder="Встав ID конкретного чату…"
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#101f34] pl-10 pr-3 text-sm text-white outline-none focus:border-sb-green/30"
                />
              </div>
            </label>
            <button onClick={runReview} disabled={running || !chatId.trim()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-sb-green px-6 text-sm font-bold text-slate-950 transition disabled:opacity-60">
              {running ? <Loader2 className="animate-spin" size={17}/> : <Sparkles size={17}/>}
              {running ? "Checking chat…" : "Check Chat"}
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-white/35">
          <span>Project: <b className="text-white/70">SportBet</b></span>
          <span>•</span>
          <span>Knowledge: <b className="text-emerald-300">Notion + Static Terms</b></span>
          {mode === "agent" ? <><span>•</span><span>Schedule: <b className={loadingAgents ? "text-amber-200" : "text-emerald-300"}>{agentsStatus}</b></span></> : null}
          {completed ? <><span>•</span><span className="text-sb-green">Analysis completed</span></> : null}
        </div>
      </section>

      {reviewError ? <div className="rounded-xl border border-rose-300/20 bg-rose-300/[0.07] px-4 py-3 text-sm text-rose-100">{reviewError}</div> : null}

      {reviewMeta ? (
        <div className="flex flex-wrap gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-xs text-white/40">
          <span>LiveChat loaded: <b className="text-white/70">{reviewMeta.chatsLoaded}</b></span><span>•</span>
          <span>Matched: <b className="text-white/70">{reviewMeta.chatsMatched}</b></span><span>•</span>
          <span>Model: <b className="text-white/70">{reviewMeta.model}</b></span><span>•</span>
          <span>Knowledge: <b className="text-white/70">{reviewMeta.knowledgeMode}</b></span>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[22px] border border-white/10 bg-[#0d1a2d] p-5"><p className="text-xs uppercase tracking-[0.16em] text-white/30">Chats reviewed</p><p className="mt-3 text-3xl font-semibold">{reviews.length}</p></div>
        <div className="rounded-[22px] border border-white/10 bg-[#0d1a2d] p-5"><p className="text-xs uppercase tracking-[0.16em] text-white/30">QA score</p><p className="mt-3 text-3xl font-semibold">{avg}%</p></div>
        <div className="rounded-[22px] border border-white/10 bg-[#0d1a2d] p-5"><p className="text-xs uppercase tracking-[0.16em] text-white/30">Issues found</p><p className="mt-3 text-3xl font-semibold text-amber-200">{issues}</p></div>
        <div className="rounded-[22px] border border-white/10 bg-[#0d1a2d] p-5"><p className="text-xs uppercase tracking-[0.16em] text-white/30">Passed</p><p className="mt-3 text-3xl font-semibold text-emerald-200">{reviews.length-issues}</p></div>
      </section>

      <section className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><FileSearch className="text-sb-green" size={18}/><h2 className="text-xl font-semibold">AI review results</h2></div>
            <p className="mt-1 text-sm text-white/35">Кожен результат показує, що AI знайшов і на яке правило він спирався.</p>
          </div>
          <div className="relative w-full lg:w-80"><Search className="absolute left-3 top-3 text-white/30" size={16}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search results…" className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.025] pl-9 pr-3 text-sm outline-none focus:border-sb-green/30"/></div>
        </div>

        <div className="mt-5 space-y-3">
          {!running && completed && reviews.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40">No QA result was returned for this selection.</div> : null}

          {reviews.map((row)=>(
            <div key={row.chatId} className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02]">
              <button onClick={()=>setExpanded(expanded===row.chatId?null:row.chatId)} className="grid w-full gap-4 p-4 text-left md:grid-cols-[150px_160px_100px_1fr_34px] md:items-center">
                <div><p className="text-xs text-white/30">Chat</p><p className="mt-1 font-semibold text-white">{row.chatId}</p></div>
                <div><p className="text-xs text-white/30">Agent / date</p><p className="mt-1 text-sm text-white/70">{row.agent}</p><p className="text-xs text-white/30">{row.date}</p></div>
                <div><p className="text-xs text-white/30">QA score</p><p className={`mt-1 text-lg font-semibold ${row.score>=90?"text-emerald-200":"text-amber-200"}`}>{row.score}%</p></div>
                <div className="flex items-start gap-3">
                  {row.result==="Passed"?<CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={18}/>:<XCircle className="mt-0.5 shrink-0 text-amber-300" size={18}/>}
                  <div><p className="text-sm font-medium text-white/80">{row.issue}</p><p className="mt-1 text-xs text-white/35">{row.rule}</p></div>
                </div>
                <ChevronDown size={17} className={`text-white/30 transition ${expanded===row.chatId?"rotate-180":""}`}/>
              </button>

              {expanded===row.chatId ? (
                <div className="border-t border-white/8 px-4 py-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-white/8 bg-black/10 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText size={16} className="text-sb-green"/>AI finding</div><p className="mt-2 text-sm leading-6 text-white/55">{row.finding}</p></div>
                    <div className="rounded-xl border border-white/8 bg-black/10 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Bot size={16} className="text-sb-green"/>Recommended action</div><p className="mt-2 text-sm leading-6 text-white/55">{row.recommendedAction}</p></div>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
