"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import {
  deleteAgentMapping,
  getAgentMappings,
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
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(true);

  const mappingMap = useMemo(
    () => new Map(mappings.map((item) => [item.schedule_name, item.email])),
    [mappings]
  );

  const allNames = useMemo(() => {
    return Array.from(new Set([...scheduleAgents, ...mappings.map((item) => item.schedule_name)])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [scheduleAgents, mappings]);

  const unmapped = scheduleAgents.filter((name) => !mappingMap.get(name));

  async function loadMappings() {
    const { data, error } = await getAgentMappings();
    if (error) {
      setStatus(`Mapping load error: ${error.message}`);
      return;
    }
    const rows = (data ?? []) as AgentScheduleMapping[];
    setMappings(rows);
    setDrafts(Object.fromEntries(rows.map((row) => [row.schedule_name, row.email])));
  }

  async function loadScheduleAgents() {
    const month = currentMonthKey();
    const response = await fetch(`/api/google-sheets/schedule?month=${month}`, { cache: "no-store" });
    const json = (await response.json()) as ScheduleApiResponse;

    if (json.ok) {
      setScheduleAgents(json.agents ?? []);
      return;
    }

    const fallback = json.availableMonths?.[0]?.monthKey;
    if (!fallback) throw new Error(json.error || "No schedule tabs found");

    const fallbackResponse = await fetch(`/api/google-sheets/schedule?month=${fallback}`, { cache: "no-store" });
    const fallbackJson = (await fallbackResponse.json()) as ScheduleApiResponse;
    if (!fallbackJson.ok) throw new Error(fallbackJson.error || "Failed to load schedule agents");
    setScheduleAgents(fallbackJson.agents ?? []);
  }

  async function refresh() {
    setLoading(true);
    setStatus("Refreshing...");
    try {
      await Promise.all([loadMappings(), loadScheduleAgents()]);
      setStatus("Synced with Google Schedule");
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

  async function addManual() {
    if (!newName.trim() || !newEmail.trim()) {
      setStatus("Name and email are required");
      return;
    }
    const { error } = await upsertAgentMapping(newName, newEmail);
    if (error) {
      setStatus(`Add error: ${error.message}`);
      return;
    }
    setNewName("");
    setNewEmail("");
    await loadMappings();
    setStatus("Agent added");
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
          description="Link the short names used in Google Schedule to LiveChat emails. Schedule names stay human-readable; email remains the internal identity used by KPI and salary."
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
            className="flex h-11 items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-4 font-semibold text-cyan-200 disabled:opacity-50"
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

        {allNames.map((name) => {
          const isInSchedule = scheduleAgents.includes(name);
          const mappedEmail = mappingMap.get(name) ?? "";
          const draft = drafts[name] ?? mappedEmail;
          const mapped = Boolean(mappedEmail);

          return (
            <div key={name} className="grid grid-cols-[minmax(180px,1fr)_minmax(280px,1.4fr)_140px_130px] items-center gap-3 border-b border-white/10 px-5 py-3 last:border-b-0">
              <div>
                <div className="font-semibold text-white">{name}</div>
                <div className="mt-1 text-[11px] text-white/35">{isInSchedule ? "Found in current schedule" : "Saved mapping"}</div>
              </div>
              <input
                value={draft}
                onChange={(event) => setDrafts((current) => ({ ...current, [name]: event.target.value }))}
                placeholder="agent@company.com"
                className="h-10 rounded-xl border border-white/10 bg-[#080B12] px-3 text-sm text-white outline-none focus:border-cyan-400/40"
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
        })}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Plus size={18} className="text-cyan-300" />
          <h2 className="text-lg font-bold text-white">Add agent manually</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Name exactly as in schedule"
            className="h-11 rounded-xl border border-white/10 bg-[#080B12] px-4 text-white outline-none focus:border-cyan-400/40"
          />
          <input
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="LiveChat email"
            className="h-11 rounded-xl border border-white/10 bg-[#080B12] px-4 text-white outline-none focus:border-cyan-400/40"
          />
          <button
            onClick={addManual}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-5 font-semibold text-cyan-200"
          >
            <Link2 size={16} /> Add mapping
          </button>
        </div>
      </Card>
    </div>
  );
}
