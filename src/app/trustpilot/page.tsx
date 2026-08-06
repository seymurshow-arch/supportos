"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  MessageSquareReply,
  RefreshCw,
  Search,
  Star,
  Stars,
} from "lucide-react";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { PROJECT_STORAGE_KEY, SUPPORT_PROJECTS } from "@/data/supportProjects";

type BusinessUnit = {
  id: string;
  displayName: string;
  domain: string;
  profileUrl: string | null;
  trustScore: number;
  stars: number;
  totalReviews: number;
  usedForTrustScore: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
};

type ProjectResult = {
  name: string;
  configured: boolean;
  businessUnit: BusinessUnit | null;
  error: string | null;
  reviewsError?: string | null;
};

type Review = {
  id: string;
  project: string;
  stars: number;
  title: string;
  text: string;
  language: string | null;
  createdAt: string | null;
  isVerified: boolean;
  source: string;
  countsTowardsTrustScore: boolean;
  consumer: { displayName: string; displayLocation: string | null };
  companyReply: { text: string; createdAt: string | null } | null;
  reviewUrl: string | null;
};



type PeriodMetrics = {
  from: string;
  to: string;
  totalReviews: number;
  generatedLinkReviews: number;
  organicReviews: number;
  basicLinkReviews: number;
  generatedLinkShare: number;
  trustScore: number | null;
  snapshotDate: string | null;
};

type ComparisonRow = {
  project: string;
  configured: boolean;
  error: string | null;
  period1: PeriodMetrics | null;
  period2: PeriodMetrics | null;
  delta?: {
    trustScore: number | null;
    totalReviews: number;
    generatedLinkReviews: number;
    generatedLinkShare: number;
  };
};

type DashboardResponse = {
  ok: boolean;
  error?: string;
  selectedProject: string;
  allMode: boolean;
  projects: ProjectResult[];
  summary: {
    configuredProjects: number;
    totalProjects: number;
    totalReviews: number;
    trustScore: number;
    stars: number;
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
    unansweredLoaded: number;
    loadedReviews: number;
  };
  reviews: Review[];
  pagination: { page: number; perPage: number; total: number } | null;
  comparison: ComparisonRow[] | null;
  comparisonMeta: { generatedSource: string; note: string } | null;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}


function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function deltaLabel(value: number | null, suffix = "") {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(suffix === "%" ? 1 : 2)}${suffix}`;
}

function StarRow({ value, compact = false }: { value: number; compact?: boolean }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={compact ? 14 : 18}
          className={star <= Math.round(value) ? "fill-amber-300 text-amber-300" : "text-white/20"}
        />
      ))}
    </div>
  );
}

export default function TrustpilotPage() {
  const [projectNames, setProjectNames] = useState<string[]>([...SUPPORT_PROJECTS]);
  const [selectedProject, setSelectedProject] = useState("all");
  const [stars, setStars] = useState("all");
  const [answered, setAnswered] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<DashboardResponse | null>(null);

  const today = new Date();
  const period2ToDefault = dateInputValue(today);
  const period2FromDate = new Date(today);
  period2FromDate.setDate(period2FromDate.getDate() - 6);
  const period1ToDate = new Date(period2FromDate);
  period1ToDate.setDate(period1ToDate.getDate() - 1);
  const period1FromDate = new Date(period1ToDate);
  period1FromDate.setDate(period1FromDate.getDate() - 6);
  const [p1From, setP1From] = useState(dateInputValue(period1FromDate));
  const [p1To, setP1To] = useState(dateInputValue(period1ToDate));
  const [p2From, setP2From] = useState(dateInputValue(period2FromDate));
  const [p2To, setP2To] = useState(period2ToDefault);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) {
          const storedProjects = parsed.map((item) => String(item).trim()).filter(Boolean);
          setProjectNames([...new Set([...SUPPORT_PROJECTS, ...storedProjects])]);
        }
      }
    } catch {
      // Keep defaults.
    }
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        project: selectedProject,
        projects: projectNames.join(","),
        page: String(page),
        perPage: "20",
        stars,
        answered,
        p1From,
        p1To,
        p2From,
        p2To,
      });
      const response = await fetch(`/api/trustpilot/dashboard?${params}`, { cache: "no-store" });
      const result = (await response.json()) as DashboardResponse;
      if (!response.ok || !result.ok) throw new Error(result.error || "Trustpilot API error");
      setData(result);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Unable to load Trustpilot data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [selectedProject, stars, answered, page, projectNames.join("|"), p1From, p1To, p2From, p2To]);

  const filteredReviews = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data?.reviews ?? [];
    return (data?.reviews ?? []).filter((review) =>
      [review.project, review.title, review.text, review.consumer.displayName]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [data, search]);

  const activeProject =
    selectedProject === "all"
      ? null
      : data?.projects.find((project) => project.name === selectedProject) ?? null;

  function chooseProject(project: string) {
    setSelectedProject(project);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-start">
          <PageHeader
            eyebrow="Reputation"
            title="Trustpilot"
            description="Live TrustScore, star distribution and service reviews for every SupportOS project. Each project uses its configured Trustpilot Business Unit ID."
          />
          <button
            onClick={() => void loadDashboard()}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-5 font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-50"
          >
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => chooseProject("all")}
            className={`shrink-0 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
              selectedProject === "all"
                ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
            }`}
          >
            All Projects
          </button>
          {projectNames.map((project) => (
            <button
              key={project}
              onClick={() => chooseProject(project)}
              className={`shrink-0 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                selectedProject === project
                  ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
              }`}
            >
              {project}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70">Period comparison</p>
              <h2 className="mt-2 text-xl font-bold text-white">TrustScore and Generated Link share</h2>
              <p className="mt-1 text-sm text-white/45">Generated Link = reviews with API source InvitationLinkApi.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="text-xs text-white/45">Period 1 from<input type="date" value={p1From} onChange={(e) => setP1From(e.target.value)} className="mt-1 h-10 rounded-xl border border-white/10 bg-[#080B12] px-3 text-white" /></label>
              <label className="text-xs text-white/45">Period 1 to<input type="date" value={p1To} onChange={(e) => setP1To(e.target.value)} className="mt-1 h-10 rounded-xl border border-white/10 bg-[#080B12] px-3 text-white" /></label>
              <label className="text-xs text-white/45">Period 2 from<input type="date" value={p2From} onChange={(e) => setP2From(e.target.value)} className="mt-1 h-10 rounded-xl border border-white/10 bg-[#080B12] px-3 text-white" /></label>
              <label className="text-xs text-white/45">Period 2 to<input type="date" value={p2To} onChange={(e) => setP2To(e.target.value)} className="mt-1 h-10 rounded-xl border border-white/10 bg-[#080B12] px-3 text-white" /></label>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-[1100px] w-full text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-white/40">
                <tr>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">TrustScore P1</th>
                  <th className="px-4 py-3">TrustScore P2</th>
                  <th className="px-4 py-3">Δ TrustScore</th>
                  <th className="px-4 py-3">New reviews P1</th>
                  <th className="px-4 py-3">New reviews P2</th>
                  <th className="px-4 py-3">Generated P1</th>
                  <th className="px-4 py-3">Generated P2</th>
                  <th className="px-4 py-3">Share P1</th>
                  <th className="px-4 py-3">Share P2</th>
                  <th className="px-4 py-3">Δ Share</th>
                </tr>
              </thead>
              <tbody>
                {(data?.comparison ?? []).map((row) => (
                  <tr key={row.project} className="border-t border-white/10 text-white/75">
                    <td className="px-4 py-3 font-semibold text-white">{row.project}</td>
                    <td className="px-4 py-3">{row.period1?.trustScore?.toFixed(1) ?? "—"}</td>
                    <td className="px-4 py-3">{row.period2?.trustScore?.toFixed(1) ?? "—"}</td>
                    <td className="px-4 py-3">{deltaLabel(row.delta?.trustScore ?? null)}</td>
                    <td className="px-4 py-3">{formatNumber(row.period1?.totalReviews ?? 0)}</td>
                    <td className="px-4 py-3">{formatNumber(row.period2?.totalReviews ?? 0)}</td>
                    <td className="px-4 py-3">{formatNumber(row.period1?.generatedLinkReviews ?? 0)}</td>
                    <td className="px-4 py-3">{formatNumber(row.period2?.generatedLinkReviews ?? 0)}</td>
                    <td className="px-4 py-3">{(row.period1?.generatedLinkShare ?? 0).toFixed(1)}%</td>
                    <td className="px-4 py-3">{(row.period2?.generatedLinkShare ?? 0).toFixed(1)}%</td>
                    <td className="px-4 py-3">{deltaLabel(row.delta?.generatedLinkShare ?? null, "%")}</td>
                  </tr>
                ))}
                {!loading && !(data?.comparison?.length) ? (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-white/40">No comparison data available.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-5 text-white/35">{data?.comparisonMeta?.note || "TrustScore history will be available after SupportOS starts saving daily snapshots."}</p>
        </div>
      </Card>

      {error ? (
        <Card className="border-rose-300/25 bg-rose-300/10 p-5 text-rose-100">{error}</Card>
      ) : null}

      {activeProject && !activeProject.configured ? (
        <Card className="border-amber-300/25 bg-amber-300/10 p-5">
          <p className="font-semibold text-amber-100">Trustpilot is not configured for {activeProject.name}</p>
          <p className="mt-2 text-sm leading-6 text-amber-100/70">
            {activeProject.error}
          </p>
        </Card>
      ) : null}

      {activeProject?.configured && activeProject.reviewsError ? (
        <Card className="border-amber-300/25 bg-amber-300/10 p-5">
          <p className="font-semibold text-amber-100">Profile statistics loaded, but review-list access is unavailable for {activeProject.name}</p>
          <p className="mt-2 text-sm leading-6 text-amber-100/70">{activeProject.reviewsError}</p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="TrustScore"
          value={loading ? "…" : data?.summary.trustScore.toFixed(1) ?? "—"}
          subtitle={selectedProject === "all" ? "Weighted across projects" : activeProject?.businessUnit?.displayName}
          icon={<Stars size={20} className="text-emerald-300" />}
        />
        <StatCard
          title="Star rating"
          value={loading ? "…" : data?.summary.stars.toFixed(1) ?? "—"}
          subtitle="Current public rating"
          icon={<Star size={20} className="fill-amber-300 text-amber-300" />}
        />
        <StatCard
          title="Total reviews"
          value={loading ? "…" : formatNumber(data?.summary.totalReviews ?? 0)}
          subtitle="Public profile total"
          icon={<MessageSquareReply size={20} className="text-cyan-300" />}
        />
        <StatCard
          title="Loaded reviews"
          value={loading ? "…" : formatNumber(data?.summary.loadedReviews ?? 0)}
          subtitle="Current filter result"
          icon={<CheckCircle2 size={20} className="text-violet-300" />}
        />
        <StatCard
          title="Unanswered loaded"
          value={loading ? "…" : formatNumber(data?.summary.unansweredLoaded ?? 0)}
          subtitle="Among currently loaded reviews"
          icon={<MessageSquareReply size={20} className="text-rose-300" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Card className="p-6">
          <h2 className="text-xl font-bold text-white">Rating distribution</h2>
          <div className="mt-5 space-y-4">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = data?.summary.distribution[star as 1 | 2 | 3 | 4 | 5] ?? 0;
              const total = data?.summary.totalReviews ?? 0;
              const percent = total ? (count / total) * 100 : 0;
              return (
                <div key={star}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-white/70">
                      {star} <Star size={14} className="fill-amber-300 text-amber-300" />
                    </span>
                    <span className="text-white/45">{formatNumber(count)} · {percent.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-amber-300" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/40">Search</label>
              <div className="relative">
                <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Review, author or project"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-[#080B12] pl-11 pr-4 text-white outline-none focus:border-cyan-300/40"
                />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/40">Stars</label>
              <select
                value={stars}
                onChange={(event) => { setStars(event.target.value); setPage(1); }}
                className="h-12 rounded-2xl border border-white/10 bg-[#080B12] px-4 text-white outline-none"
              >
                <option value="all">All ratings</option>
                {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} stars</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/40">Reply status</label>
              <select
                value={answered}
                onChange={(event) => { setAnswered(event.target.value); setPage(1); }}
                className="h-12 rounded-2xl border border-white/10 bg-[#080B12] px-4 text-white outline-none"
              >
                <option value="all">All reviews</option>
                <option value="answered">Answered</option>
                <option value="unanswered">Unanswered</option>
              </select>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Reviews</h2>
            <p className="mt-1 text-sm text-white/40">{filteredReviews.length} reviews shown</p>
          </div>
          {activeProject?.businessUnit?.profileUrl ? (
            <a
              href={activeProject.businessUnit.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.07]"
            >
              Open profile <ExternalLink size={15} />
            </a>
          ) : null}
        </div>

        {loading ? (
          <div className="py-16 text-center text-white/45">Loading Trustpilot data…</div>
        ) : filteredReviews.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-8 text-center text-white/45">
            No reviews match the current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredReviews.map((review) => (
              <article key={`${review.project}-${review.id}`} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedProject === "all" ? (
                        <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                          {review.project}
                        </span>
                      ) : null}
                      <StarRow value={review.stars} compact />
                      {review.isVerified ? (
                        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">Verified</span>
                      ) : null}
                      <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-[11px] font-semibold text-violet-100">
                        {review.source === "InvitationLinkApi" ? "Generated Link" : review.source === "BasicLink" ? "Basic Link" : review.source}
                      </span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-white">{review.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/70">{review.text || "No review text"}</p>
                    <p className="mt-4 text-xs text-white/35">
                      {review.consumer.displayName}
                      {review.consumer.displayLocation ? ` · ${review.consumer.displayLocation}` : ""}
                      {review.createdAt ? ` · ${formatDate(review.createdAt)}` : ""}
                    </p>
                  </div>
                  {review.reviewUrl ? (
                    <a
                      href={review.reviewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.08]"
                    >
                      Open <ExternalLink size={14} />
                    </a>
                  ) : null}
                </div>

                {review.companyReply ? (
                  <div className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">Company reply</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/65">{review.companyReply.text}</p>
                    {review.companyReply.createdAt ? (
                      <p className="mt-2 text-xs text-white/30">{formatDate(review.companyReply.createdAt)}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] px-4 py-3 text-sm font-medium text-rose-100/80">
                    No company reply
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {data?.pagination && data.pagination.total > data.pagination.perPage ? (
          <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-sm text-white/40">Page {page}</span>
            <button
              onClick={() => setPage((current) => current + 1)}
              disabled={loading || page * data.pagination.perPage >= data.pagination.total}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
