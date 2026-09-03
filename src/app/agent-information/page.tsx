"use client";

import { useMemo, useState } from "react";
import {
  Cake,
  Check,
  Copy,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

type Agent = {
  id: number;
  name: string;
  managerEmail: string;
  email: string;
  emailPassword: string;
  wallet: string;
  birthday: string;
  phone: string;
  backupPhone: string;
  city: string;
  status: "Active" | "Inactive";
};

const DEMO_PASSWORD = "sportbet";

const initialAgents: Agent[] = [];

const emptyAgent: Agent = {
  id: 0,
  name: "",
  managerEmail: "",
  email: "",
  emailPassword: "",
  wallet: "",
  birthday: "",
  phone: "",
  backupPhone: "",
  city: "",
  status: "Active",
};

function mask(value: string) {
  if (!value) return "—";
  return "•".repeat(Math.min(Math.max(value.length, 8), 14));
}

function DetailRow({
  icon: Icon,
  label,
  value,
  sensitive = false,
  revealed = false,
  onToggle,
  onCopy,
  copied = false,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  sensitive?: boolean;
  revealed?: boolean;
  onToggle?: () => void;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex min-h-20 items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-sb-green/15 bg-sb-green/[0.06] text-sb-green">
          <Icon size={17} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.17em] text-white/35">{label}</div>
          <div className="mt-1 truncate text-sm font-medium text-white/85">{sensitive && !revealed ? mask(value) : value || "—"}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {sensitive ? (
          <button
            type="button"
            onClick={onToggle}
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/45 transition hover:border-sb-green/25 hover:text-sb-green"
            aria-label={revealed ? "Hide value" : "Show value"}
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCopy}
          disabled={!value}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white/45 transition hover:border-sb-green/25 hover:text-sb-green disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function AgentInformationPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | Agent["status"]>("All");
  const [selectedId, setSelectedId] = useState<number>(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Agent>(emptyAgent);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [copiedField, setCopiedField] = useState("");

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((agent) => {
      const matchesFilter = filter === "All" || agent.status === filter;
      const matchesSearch = !q || [agent.name, agent.email, agent.city].some((value) => value.toLowerCase().includes(q));
      return matchesFilter && matchesSearch;
    });
  }, [agents, filter, search]);

  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0] ?? null;

  async function copyValue(field: string, value: string) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((current) => (current === field ? "" : current));
      }, 1400);
    } catch {
      setNotice("Could not copy value.");
    }
  }

  function unlock() {
    if (password === DEMO_PASSWORD) {
      setUnlocked(true);
      setPassword("");
      setPasswordError("");
      return;
    }
    setPasswordError("Incorrect password");
  }

  function selectAgent(agent: Agent) {
    setSelectedId(agent.id);
    setDraft(agent);
    setEditing(false);
    setRevealed({});
    setNotice("");
    setCopiedField("");
  }

  function startEdit() {
    if (!selected) return;
    setDraft(selected);
    setEditing(true);
    setNotice("");
  }

  function addAgent() {
    const nextId = Math.max(0, ...agents.map((agent) => agent.id)) + 1;
    setDraft({ ...emptyAgent, id: nextId });
    setSelectedId(nextId);
    setEditing(true);
    setRevealed({});
    setNotice("");
    setCopiedField("");
  }

  function cancelEdit() {
    if (selected) setDraft(selected);
    else if (agents[0]) setSelectedId(agents[0].id);
    setEditing(false);
  }

  function saveAgent() {
    if (!draft.name.trim() || !draft.email.trim()) {
      setNotice("Name and agent email are required.");
      return;
    }

    setAgents((current) => {
      const exists = current.some((agent) => agent.id === draft.id);
      return exists ? current.map((agent) => (agent.id === draft.id ? draft : agent)) : [...current, draft];
    });
    setSelectedId(draft.id);
    setEditing(false);
    setNotice("Agent information saved.");
  }

  function updateDraft<K extends keyof Agent>(key: K, value: Agent[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  if (!unlocked) {
    return (
      <div className="mx-auto flex min-h-[72vh] max-w-xl items-center justify-center px-4">
        <div className="w-full rounded-[30px] border border-white/10 bg-[#0d1a2d] p-7 shadow-2xl shadow-black/30 sm:p-9">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-sb-green/20 bg-sb-green/10 text-sb-green">
            <LockKeyhole size={28} />
          </div>
          <div className="mt-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sb-green">Restricted area</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Agent Information</h1>
            <p className="mt-3 text-sm leading-6 text-white/45">This section contains private agent information and is protected by a separate password.</p>
          </div>

          <div className="mt-7">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-white/35">Access password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") unlock();
              }}
              placeholder="Enter password"
              className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-sb-green/35"
            />
            {passwordError ? <p className="mt-2 text-sm text-rose-300">{passwordError}</p> : null}
          </div>

          <button
            type="button"
            onClick={unlock}
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-sb-green px-5 text-sm font-bold text-slate-950 transition hover:bg-sb-green"
          >
            <ShieldCheck size={17} /> Unlock page
          </button>


        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-sb-green">
            <ShieldCheck size={15} /> Protected personnel data
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Agent Information</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/45">Manage private SportBet agent details.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setUnlocked(false);
              setEditing(false);
              setRevealed({});
            }}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-white/65 transition hover:bg-white/[0.06] hover:text-white"
          >
            <LockKeyhole size={16} /> Lock page
          </button>
          <button
            type="button"
            onClick={addAgent}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-sb-green px-4 text-sm font-bold text-slate-950 transition hover:bg-sb-green"
          >
            <Plus size={17} /> Add agent
          </button>
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search agent, email or city"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-sb-green/30"
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["All", "Active", "Inactive"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`h-9 rounded-xl border text-xs font-semibold transition ${filter === item ? "border-sb-green/30 bg-sb-green/10 text-sb-green" : "border-white/10 bg-white/[0.025] text-white/40 hover:text-white/70"}`}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {filteredAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => selectAgent(agent)}
                className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === agent.id ? "border-sb-green/25 bg-sb-green/[0.07]" : "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/65"><UserRound size={18} /></div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{agent.name}</div>
                      <div className="mt-1 truncate text-xs text-white/35">{agent.email}</div>
                    </div>
                  </div>
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${agent.status === "Active" ? "bg-emerald-300" : "bg-white/20"}`} />
                </div>
              </button>
            ))}
            {!filteredAgents.length ? <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/35">No agents found.</div> : null}
          </div>
        </div>

        <div className="rounded-[26px] border border-white/10 bg-[#0d1a2d] p-5 sm:p-6">
          {editing ? (
            <>
              <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sb-green">{agents.some((agent) => agent.id === draft.id) ? "Edit agent" : "New agent"}</div>
                  <h2 className="mt-1 text-2xl font-semibold text-white">{draft.name || "New agent profile"}</h2>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={cancelEdit} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/55 transition hover:bg-white/[0.04] hover:text-white"><X size={16} /> Cancel</button>
                  <button type="button" onClick={saveAgent} className="inline-flex h-10 items-center gap-2 rounded-xl bg-sb-green px-4 text-sm font-bold text-slate-950 transition hover:bg-sb-green"><Check size={16} /> Save</button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {([
                  ["name", "Agent name", "text"],
                  ["managerEmail", "Manager email", "email"],
                  ["email", "Agent email", "email"],
                  ["emailPassword", "Email password", "text"],
                  ["wallet", "Wallet", "text"],
                  ["birthday", "Birthday", "date"],
                  ["phone", "Phone", "tel"],
                  ["backupPhone", "Backup phone", "tel"],
                  ["city", "City", "text"],
                ] as const).map(([key, label, type]) => (
                  <label key={key} className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-white/35">{label}</span>
                    <input
                      type={type}
                      value={draft[key]}
                      onChange={(event) => updateDraft(key, event.target.value)}
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-white outline-none transition focus:border-sb-green/30"
                    />
                  </label>
                ))}
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-white/35">Status</span>
                  <select
                    value={draft.status}
                    onChange={(event) => updateDraft("status", event.target.value as Agent["status"])}
                    className="h-11 w-full rounded-xl border border-white/10 bg-[#101f34] px-3 text-sm text-white outline-none transition focus:border-sb-green/30"
                  >
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </label>
              </div>
              {notice ? <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">{notice}</div> : null}
            </>
          ) : selected ? (
            <>
              <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="grid h-14 w-14 place-items-center rounded-2xl border border-sb-green/15 bg-sb-green/[0.07] text-sb-green"><UserRound size={23} /></div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-semibold text-white">{selected.name}</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${selected.status === "Active" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : "border-white/10 bg-white/[0.03] text-white/35"}`}>{selected.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-white/35">SportBet support agent</p>
                  </div>
                </div>
                <button type="button" onClick={startEdit} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-sb-green/20 bg-sb-green/[0.07] px-4 text-sm font-semibold text-sb-green transition hover:bg-sb-green/[0.12]"><Pencil size={16} /> Edit information</button>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <DetailRow icon={Mail} label="Manager email" value={selected.managerEmail} onCopy={() => copyValue("managerEmail", selected.managerEmail)} copied={copiedField === "managerEmail"} />
                <DetailRow icon={Mail} label="Agent email" value={selected.email} onCopy={() => copyValue("email", selected.email)} copied={copiedField === "email"} />
                <DetailRow icon={LockKeyhole} label="Email password" value={selected.emailPassword} sensitive revealed={revealed.emailPassword} onToggle={() => setRevealed((current) => ({ ...current, emailPassword: !current.emailPassword }))} onCopy={() => copyValue("emailPassword", selected.emailPassword)} copied={copiedField === "emailPassword"} />
                <DetailRow icon={WalletCards} label="Wallet" value={selected.wallet} sensitive revealed={revealed.wallet} onToggle={() => setRevealed((current) => ({ ...current, wallet: !current.wallet }))} onCopy={() => copyValue("wallet", selected.wallet)} copied={copiedField === "wallet"} />
                <DetailRow icon={Cake} label="Birthday" value={selected.birthday} onCopy={() => copyValue("birthday", selected.birthday)} copied={copiedField === "birthday"} />
                <DetailRow icon={MapPin} label="City" value={selected.city} onCopy={() => copyValue("city", selected.city)} copied={copiedField === "city"} />
                <DetailRow icon={Phone} label="Phone" value={selected.phone} sensitive revealed={revealed.phone} onToggle={() => setRevealed((current) => ({ ...current, phone: !current.phone }))} onCopy={() => copyValue("phone", selected.phone)} copied={copiedField === "phone"} />
                <DetailRow icon={Phone} label="Backup phone" value={selected.backupPhone} sensitive revealed={revealed.backupPhone} onToggle={() => setRevealed((current) => ({ ...current, backupPhone: !current.backupPhone }))} onCopy={() => copyValue("backupPhone", selected.backupPhone)} copied={copiedField === "backupPhone"} />
              </div>
              {notice ? <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] px-4 py-3 text-sm text-emerald-100">{notice}</div> : null}
            </>
          ) : (
            <div className="grid min-h-[400px] place-items-center text-center">
              <div>
                <UserRound className="mx-auto text-white/20" size={34} />
                <p className="mt-3 font-semibold text-white/65">Select an agent</p>
                <p className="mt-1 text-sm text-white/35">Choose an agent from the list or add a new profile.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}