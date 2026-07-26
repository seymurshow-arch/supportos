import { supabase } from "@/lib/supabase";

export type SavedReport = {
  id?: string;
  report_key: string;
  title: string;
  report_type: "weekly" | "monthly";
  project: string;
  period: Record<string, unknown>;
  summary: Record<string, unknown>;
  projects: unknown[];
  tags: unknown[];
  agents: unknown[];
  notes?: string;
  ai_summary?: string;
  created_at?: string;
  updated_at?: string;
};

export async function getSavedReports() {
  return supabase
    .from("saved_reports")
    .select("*")
    .order("updated_at", { ascending: false });
}

export async function saveReport(report: SavedReport) {
  return supabase.from("saved_reports").upsert(
    {
      ...report,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "report_key" }
  );
}

export async function deleteSavedReport(reportKey: string) {
  return supabase.from("saved_reports").delete().eq("report_key", reportKey);
}