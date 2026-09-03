"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Save, Trash2 } from "lucide-react";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import {
  deleteAgentMapping,
  getAgentMappings,
  pruneAgentMappings,
  upsertAgentMapping,
  type AgentScheduleMapping,
} from "@/services/agentMappingService";

type ScheduleApiResponse = {
  ok: boolean;
  error?: string;
  agents?: string[];
  availableMonths?: { title: string; monthKey: string }[];
};

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function AgentMappingPage() {
  const [mappings, setMappings] = useState<AgentScheduleMapping[]>([]);
  const [scheduleAgents, setScheduleAgents] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(true);

  const mappingMap = useMemo(
    () => new Map(mappings.map((item) => [item.schedule_name, item.email])),
    [mappings]
  );

  // Agent Mapping is driven only by the current Google Schedule.
  // Old saved mappings that no longer exist in the schedule are pruned on refresh.
  const allNames = useMemo(
    () => [...scheduleAgents].sort((a, b) => a.localeCompare(b)),
    [scheduleAgents]
  );

  const unmapped = scheduleAgents.filter((name) => !mappingMap.get(name));

  async function loadMappings() {
    const { data, error } = await getAgentMappings();
    if (error) throw new Error(`Mapping load error: ${error.message}`);

    const rows = (data ?? []) as AgentScheduleMapping[];
    setMappings(rows);
    setDrafts(Object.fromEntries(rows.map((row) => [row.schedule_name, row.email])));
    return rows;
  }

  async function loadScheduleAgents() {
    const month = currentMonthKey();
    const response = await fetch(`/api/google-sheets/schedule?month=${month}`, { cache: "no-store" });
    const json = (await response.json()) as ScheduleApiResponse;

    if (json.ok) return json.agents ?? [];

    const fallback = json.availableMonths?.[0]?.monthKey;
    if (!fallback) throw new Error(json.error || "No schedule tabs found");

    const fallbackResponse = await fetch(`/api/google-sheets/schedule?month=${fallback}`, { cache: "no-store" });
    const fallbackJson = (await fallbackResponse.json()) as ScheduleApiResponse;
    if (!fallbackJson.ok) throw new Error(fallbackJson.error || "Failed to load schedule agents");
    return fallbackJson.agents ?? [];
  }

  async function refresh() {
    setLoading(true);
    setStatus("Reading Google Schedule...");

    try {
      const agents = await loadScheduleAgents();
      setScheduleAgents(agents);

      // This deletes legacy mappings (old project agents) that are no longer present
      // in the active Google Schedule. It only runs after Google Schedule loaded successfully.
      const { data: pruneResult, error: pruneError } = await pruneAgentMappings(agents);
      if (pruneError) throw new Error(`Mapping cleanup error: ${pruneError.message}`);

      await loadMappings();
      const removed = pruneResult?.removed ?? 0;
      setStatus(
        removed > 0
          ? `Synced with Google Schedule · removed ${removed} old mapping(s)`
          : "Synced with Google Schedule"
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }

  async function save(name: string) {
    const email = (drafts[name] ?? "").trim();
    if (!email) {
      setStatus(`Email is required for ${name}`);
      return;
    }

    setStatus(`Saving ${name}...`);
    const { error } = await upsertAgentMapping(name, email);
    if (error) {
      setStatus(`Save error: ${error.message}`);
      return;
    }

    await loadMappings();
    setStatus(`${name} linked successfully`);
  }

  async function remove(name: string) {
    if (!confirm(`Remove mapping for ${name}?`)) return;

    const { error } = await deleteAgentMapping(name);
    if (error) {
      setStatus(`Delete error: ${error.message}`);
      return;
    }

    setDrafts((current) => ({ ...current, [name]: "" }));
    await loadMappings();
    setStatus(`${name} mapping removed`);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <PageHeader
          eyebrow="Operations"
          title="Agent Mapping"
          description="Agents are loaded automatically from the SportBet Google Schedule. Link each schedule name to the agent's LiveChat email; KPI and Salary use that email as the internal identity."
        />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-white/45">{status}</div>
            <div className="mt-1 text-xs text-white/35">
              {scheduleAgents.length} agent(s) detected in Google Schedule · {unmapped.length} unmapped
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex h-11 items-center gap-2 rounded-xl border border-sb-green/25 bg-sb-green/10 px-4 font-semibold text-sb-green disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh from Google
          </button>
        </div>
      </Card>

      {unmapped.length > 0 && (
        <Card className="border border-red-400/20 bg-red-400/[0.04] p-5">
          <div className="flex gap-3 text-red-200">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Unmapped agents found</div>
              <p className="mt-1 text-sm text-red-200/70">
                KPI and salary must not identify these agents until an email is linked: {unmapped.join(", ")}.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(180px,1fr)_minmax(280px,1.4fr)_140px_130px] gap-3 border-b border-white/10 bg-white/[0.035] px-5 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">
          <div>Schedule name</div>
          <div>LiveChat email</div>
          <div>Status</div>
          <div>Actions</div>
        </div>

        {loading && allNames.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-white/40">Loading agents from Google Schedule...</div>
        ) : allNames.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-white/40">
            No agents loaded. Check Google Schedule credentials and press Refresh from Google.
          </div>
        ) : (
          allNames.map((name) => {
            const mappedEmail = mappingMap.get(name) ?? "";
            const draft = drafts[name] ?? mappedEmail;
            const mapped = Boolean(mappedEmail);

            return (
              <div key={name} className="grid grid-cols-[minmax(180px,1fr)_minmax(280px,1.4fr)_140px_130px] items-center gap-3 border-b border-white/10 px-5 py-3 last:border-b-0">
                <div>
                  <div className="font-semibold text-white">{name}</div>
                  <div className="mt-1 text-[11px] text-sb-green/55">Found in Google Schedule</div>
                </div>
                <input
                  value={draft}
                  onChange={(event) => setDrafts((current) => ({ ...current, [name]: event.target.value }))}
                  placeholder="agent@company.com"
                  className="h-10 rounded-xl border border-white/10 bg-[#091426] px-3 text-sm text-white outline-none focus:border-sb-green/40"
                />
                <div className={`flex items-center gap-2 text-sm ${mapped ? "text-emerald-300" : "text-red-300"}`}>
                  {mapped ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  {mapped ? "Linked" : "Missing"}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    title="Save"
                    onClick={() => save(name)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                  >
                    <Save size={15} />
                  </button>
                  {mapped && (
                    <button
                      title="Delete"
                      onClick={() => remove(name)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-400/20 bg-red-400/10 text-red-300"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
