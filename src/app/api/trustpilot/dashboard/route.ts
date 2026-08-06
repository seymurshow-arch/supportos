import { NextResponse } from "next/server";
import { SUPPORT_PROJECTS } from "@/data/supportProjects";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = "https://api.trustpilot.com/v1";
const GENERATED_SOURCE = "InvitationLinkApi";

type BusinessUnit = {
  id: string;
  displayName?: string;
  name?: { identifying?: string; referring?: string[] };
  websiteUrl?: string;
  country?: string;
  numberOfReviews?: {
    total?: number;
    usedForTrustScoreCalculation?: number;
    oneStar?: number;
    twoStars?: number;
    threeStars?: number;
    fourStars?: number;
    fiveStars?: number;
  };
  score?: { trustScore?: number; stars?: number };
  status?: string;
};

type TrustpilotReview = {
  id: string;
  stars?: number;
  title?: string;
  text?: string;
  language?: string;
  createdAt?: string;
  updatedAt?: string;
  experiencedAt?: string;
  isVerified?: boolean;
  source?: string;
  countsTowardsTrustScore?: boolean;
  companyReply?: { text?: string; createdAt?: string; updatedAt?: string } | null;
  consumer?: { displayLocation?: string; displayName?: string; id?: string };
};

type ReviewsResponse = {
  reviews?: TrustpilotReview[];
  total?: number;
  page?: number;
  perPage?: number;
  links?: Array<{ rel?: string; href?: string }>;
};

type LoadOptions = { page: number; perPage: number; stars: string; answered: string };

type SnapshotRow = {
  project: string;
  snapshot_date: string;
  trust_score: number;
  star_rating: number;
  total_reviews: number;
};

const DOMAIN_ENV_KEYS: Record<string, string[]> = {
  LunuBet: ["TRUSTPILOT_DOMAIN_LUNUBET"],
  Roostino: ["TRUSTPILOT_DOMAIN_ROOSTINO"],
  WonderLuck: ["TRUSTPILOT_DOMAIN_WONDERLUCK"],
  FanoBet: ["TRUSTPILOT_DOMAIN_FANOBET"],
  "Tip-top": ["TRUSTPILOT_DOMAIN_TIP_TOP", "TRUSTPILOT_DOMAIN_TIPTOP"],
  "50 Crowns": ["TRUSTPILOT_DOMAIN_50_CROWNS", "TRUSTPILOT_DOMAIN_50CROWNS"],
  "Haha Spin": ["TRUSTPILOT_DOMAIN_HAHA_SPIN", "TRUSTPILOT_DOMAIN_HAHASPIN"],
  Galleon: ["TRUSTPILOT_DOMAIN_GALLEON"],
};

function domainForProject(project: string) {
  const keys = DOMAIN_ENV_KEYS[project] ?? [];
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  }
  return "";
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

async function trustpilotGet<T>(path: string, params?: URLSearchParams): Promise<T> {
  const apiKey = process.env.TRUSTPILOT_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing TRUSTPILOT_API_KEY in environment variables");

  const url = new URL(`${API_BASE}${path}`);
  params?.forEach((value, key) => url.searchParams.append(key, value));
  const response = await fetch(url, {
    headers: { apikey: apiKey, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Trustpilot API ${response.status}: ${text.replace(/\s+/g, " ").slice(0, 400)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function fetchReviewsPage(businessUnitId: string, options: LoadOptions) {
  const params = new URLSearchParams({
    page: String(options.page),
    perPage: String(options.perPage),
    orderBy: "createdat.desc",
    includeReportedReviews: "true",
  });
  if (/^[1-5]$/.test(options.stars)) params.set("stars", options.stars);
  if (options.answered === "answered") params.set("responded", "true");
  if (options.answered === "unanswered") params.set("responded", "false");
  return trustpilotGet<ReviewsResponse>(`/business-units/${businessUnitId}/reviews`, params);
}

async function fetchReviewsForPeriods(businessUnitId: string, earliest: string, latest: string) {
  const earliestMs = new Date(`${earliest}T00:00:00Z`).getTime();
  const latestMs = new Date(`${latest}T23:59:59.999Z`).getTime();
  const collected: TrustpilotReview[] = [];

  for (let page = 1; page <= 100; page += 1) {
    const response = await fetchReviewsPage(businessUnitId, {
      page,
      perPage: 100,
      stars: "all",
      answered: "all",
    });
    const reviews = response.reviews ?? [];
    if (!reviews.length) break;

    for (const review of reviews) {
      const createdMs = review.createdAt ? new Date(review.createdAt).getTime() : NaN;
      if (Number.isFinite(createdMs) && createdMs >= earliestMs && createdMs <= latestMs) collected.push(review);
    }

    const oldestMs = reviews.reduce((min, review) => {
      const value = review.createdAt ? new Date(review.createdAt).getTime() : Number.POSITIVE_INFINITY;
      return Math.min(min, value);
    }, Number.POSITIVE_INFINITY);
    const hasNext = (response.links ?? []).some((link) => link.rel === "next-page");
    if (!hasNext || oldestMs < earliestMs) break;
  }

  return collected;
}

function mapReview(review: TrustpilotReview, project: string) {
  return {
    id: review.id,
    project,
    stars: Number(review.stars ?? 0),
    title: review.title || "Untitled review",
    text: review.text || "",
    language: review.language || null,
    createdAt: review.createdAt || null,
    updatedAt: review.updatedAt || null,
    experiencedAt: review.experiencedAt || null,
    isVerified: Boolean(review.isVerified),
    source: review.source || "Unknown",
    countsTowardsTrustScore: review.countsTowardsTrustScore !== false,
    consumer: {
      displayName: review.consumer?.displayName || "Anonymous",
      displayLocation: review.consumer?.displayLocation || null,
    },
    companyReply: review.companyReply
      ? { text: review.companyReply.text || "", createdAt: review.companyReply.createdAt || null }
      : null,
    reviewUrl: review.id ? `https://www.trustpilot.com/reviews/${review.id}` : null,
  };
}

async function saveSnapshot(project: string, details: BusinessUnit) {
  const supabase = getSupabase();
  if (!supabase) return;
  const row: SnapshotRow = {
    project,
    snapshot_date: new Date().toISOString().slice(0, 10),
    trust_score: Number(details.score?.trustScore ?? 0),
    star_rating: Number(details.score?.stars ?? 0),
    total_reviews: Number(details.numberOfReviews?.total ?? 0),
  };
  const { error } = await supabase.from("trustpilot_snapshots").upsert(row, {
    onConflict: "project,snapshot_date",
  });
  if (error) console.warn("[trustpilot/snapshot]", error.message);
}

async function snapshotAtOrBefore(project: string, date: string) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("trustpilot_snapshots")
    .select("project,snapshot_date,trust_score,star_rating,total_reviews")
    .eq("project", project)
    .lte("snapshot_date", date)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[trustpilot/snapshot-read]", error.message);
    return null;
  }
  return data as SnapshotRow | null;
}

function periodStats(reviews: TrustpilotReview[], from: string, to: string) {
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T23:59:59.999Z`).getTime();
  const periodReviews = reviews.filter((review) => {
    const value = review.createdAt ? new Date(review.createdAt).getTime() : NaN;
    return Number.isFinite(value) && value >= fromMs && value <= toMs;
  });
  const generated = periodReviews.filter((review) => review.source === GENERATED_SOURCE).length;
  const organic = periodReviews.filter((review) => review.source === "Organic").length;
  const basicLink = periodReviews.filter((review) => review.source === "BasicLink").length;
  const total = periodReviews.length;
  return {
    from,
    to,
    totalReviews: total,
    generatedLinkReviews: generated,
    organicReviews: organic,
    basicLinkReviews: basicLink,
    generatedLinkShare: total ? Number(((generated / total) * 100).toFixed(2)) : 0,
  };
}

async function loadProject(project: string, options: LoadOptions) {
  const domain = domainForProject(project);
  const envKeys = DOMAIN_ENV_KEYS[project] ?? [];
  if (!domain) {
    return {
      project,
      configured: false,
      error: envKeys.length ? `Missing ${envKeys.join(" or ")} in environment variables.` : "No Trustpilot domain is mapped for this project.",
      businessUnit: null,
      reviews: [],
      reviewsError: null,
      pagination: { page: options.page, perPage: options.perPage, total: 0 },
    };
  }

  const details = await trustpilotGet<BusinessUnit>(
    "/business-units/find",
    new URLSearchParams({ name: domain }),
  );
  await saveSnapshot(project, details);

  let reviewsResponse: ReviewsResponse = {};
  let reviewsError: string | null = null;
  try {
    reviewsResponse = await fetchReviewsPage(details.id, options);
  } catch (error) {
    reviewsError = error instanceof Error ? error.message : "Unable to load reviews";
  }

  const profileDomain = details.name?.identifying || domain;
  return {
    project,
    configured: true,
    error: null,
    reviewsError,
    businessUnit: {
      id: details.id,
      displayName: details.displayName || project,
      domain: profileDomain,
      websiteUrl: details.websiteUrl || null,
      country: details.country || null,
      status: details.status || null,
      trustScore: Number(details.score?.trustScore ?? 0),
      stars: Number(details.score?.stars ?? 0),
      totalReviews: Number(details.numberOfReviews?.total ?? 0),
      usedForTrustScore: Number(details.numberOfReviews?.usedForTrustScoreCalculation ?? 0),
      distribution: {
        1: Number(details.numberOfReviews?.oneStar ?? 0),
        2: Number(details.numberOfReviews?.twoStars ?? 0),
        3: Number(details.numberOfReviews?.threeStars ?? 0),
        4: Number(details.numberOfReviews?.fourStars ?? 0),
        5: Number(details.numberOfReviews?.fiveStars ?? 0),
      },
      profileUrl: profileDomain ? `https://www.trustpilot.com/review/${profileDomain}` : null,
    },
    reviews: (reviewsResponse.reviews ?? []).map((review) => mapReview(review, project)),
    pagination: {
      page: Number(reviewsResponse.page ?? options.page),
      perPage: Number(reviewsResponse.perPage ?? options.perPage),
      total: Number(reviewsResponse.total ?? details.numberOfReviews?.total ?? 0),
    },
  };
}

async function loadPeriodComparison(projects: string[], dates: { p1From: string; p1To: string; p2From: string; p2To: string }) {
  const earliest = [dates.p1From, dates.p2From].sort()[0];
  const latest = [dates.p1To, dates.p2To].sort().at(-1)!;

  const rows = await Promise.all(projects.map(async (project) => {
    const domain = domainForProject(project);
    if (!domain) return { project, configured: false, error: "Missing Trustpilot domain", period1: null, period2: null };

    try {
      const details = await trustpilotGet<BusinessUnit>("/business-units/find", new URLSearchParams({ name: domain }));
      await saveSnapshot(project, details);
      const reviews = await fetchReviewsForPeriods(details.id, earliest, latest);
      const period1 = periodStats(reviews, dates.p1From, dates.p1To);
      const period2 = periodStats(reviews, dates.p2From, dates.p2To);
      const p1Snapshot = await snapshotAtOrBefore(project, dates.p1To);
      const p2Snapshot = await snapshotAtOrBefore(project, dates.p2To);

      return {
        project,
        configured: true,
        error: null,
        period1: { ...period1, trustScore: p1Snapshot?.trust_score ?? null, snapshotDate: p1Snapshot?.snapshot_date ?? null },
        period2: { ...period2, trustScore: p2Snapshot?.trust_score ?? null, snapshotDate: p2Snapshot?.snapshot_date ?? null },
        delta: {
          trustScore: p1Snapshot && p2Snapshot ? Number((p2Snapshot.trust_score - p1Snapshot.trust_score).toFixed(2)) : null,
          totalReviews: period2.totalReviews - period1.totalReviews,
          generatedLinkReviews: period2.generatedLinkReviews - period1.generatedLinkReviews,
          generatedLinkShare: Number((period2.generatedLinkShare - period1.generatedLinkShare).toFixed(2)),
        },
      };
    } catch (error) {
      return { project, configured: true, error: error instanceof Error ? error.message : "Period comparison failed", period1: null, period2: null };
    }
  }));

  return rows;
}

function validDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedProject = searchParams.get("project")?.trim() || "all";
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const perPage = Math.min(100, Math.max(5, Number(searchParams.get("perPage") || 20)));
    const stars = searchParams.get("stars") || "all";
    const answered = searchParams.get("answered") || "all";
    const projectsParam = searchParams.get("projects");
    const projects = projectsParam
      ? [...new Set(projectsParam.split(",").map((item) => item.trim()).filter(Boolean))]
      : [...SUPPORT_PROJECTS];
    const selectedProjects = requestedProject.toLowerCase() === "all"
      ? projects
      : projects.filter((project) => project.toLowerCase() === requestedProject.toLowerCase());
    if (!selectedProjects.length) return NextResponse.json({ ok: false, error: "Unknown project" }, { status: 400 });

    const p1From = searchParams.get("p1From");
    const p1To = searchParams.get("p1To");
    const p2From = searchParams.get("p2From");
    const p2To = searchParams.get("p2To");
    const wantsComparison = [p1From, p1To, p2From, p2To].every(validDate);

    const allMode = requestedProject.toLowerCase() === "all";
    const results = await Promise.all(selectedProjects.map((project) =>
      loadProject(project, {
        page: allMode ? 1 : page,
        perPage: allMode ? Math.min(perPage, 20) : perPage,
        stars,
        answered,
      }).catch((error) => ({
        project,
        configured: false,
        error: error instanceof Error ? error.message : "Trustpilot request failed",
        reviewsError: null,
        businessUnit: null,
        reviews: [],
        pagination: { page: 1, perPage, total: 0 },
      })),
    ));

    const configured = results.filter((item) => item.configured && item.businessUnit);
    const reviews = results.flatMap((item) => item.reviews).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const totalReviews = configured.reduce((sum, item) => sum + Number(item.businessUnit?.totalReviews ?? 0), 0);
    const weightedTrustScore = totalReviews
      ? configured.reduce((sum, item) => sum + Number(item.businessUnit?.trustScore ?? 0) * Number(item.businessUnit?.totalReviews ?? 0), 0) / totalReviews
      : 0;
    const weightedStars = totalReviews
      ? configured.reduce((sum, item) => sum + Number(item.businessUnit?.stars ?? 0) * Number(item.businessUnit?.totalReviews ?? 0), 0) / totalReviews
      : 0;
    const distribution = configured.reduce((acc, item) => {
      for (const star of [1, 2, 3, 4, 5] as const) acc[star] += Number(item.businessUnit?.distribution?.[star] ?? 0);
      return acc;
    }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

    const comparison = wantsComparison
      ? await loadPeriodComparison(selectedProjects, { p1From: p1From!, p1To: p1To!, p2From: p2From!, p2To: p2To! })
      : null;

    return NextResponse.json({
      ok: true,
      selectedProject: requestedProject,
      allMode,
      projects: results.map((item) => ({
        name: item.project,
        configured: item.configured,
        businessUnit: item.businessUnit,
        error: item.error,
        reviewsError: item.reviewsError,
      })),
      summary: {
        configuredProjects: configured.length,
        totalProjects: results.length,
        totalReviews,
        trustScore: Number(weightedTrustScore.toFixed(2)),
        stars: Number(weightedStars.toFixed(2)),
        distribution,
        unansweredLoaded: reviews.filter((review) => !review.companyReply).length,
        loadedReviews: reviews.length,
      },
      reviews,
      pagination: allMode ? null : results[0]?.pagination ?? null,
      comparison,
      comparisonMeta: wantsComparison ? {
        generatedSource: GENERATED_SOURCE,
        note: "TrustScore history starts from the first saved SupportOS snapshot. Review-source metrics are calculated directly from Trustpilot reviews.",
      } : null,
    });
  } catch (error) {
    console.error("[trustpilot/dashboard]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown Trustpilot error" }, { status: 500 });
  }
}
