import { supabase } from "@/lib/supabase";

export type SalarySnapshot = {
  id?: string;
  month_key: string;
  title: string;
  rows: unknown[];
  totals: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export async function getSalarySnapshots() {
  return supabase
    .from("salary_snapshots")
    .select("*")
    .order("month_key", { ascending: false });
}

export async function saveSalarySnapshot(snapshot: SalarySnapshot) {
  return supabase.from("salary_snapshots").upsert(
    {
      ...snapshot,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "month_key" }
  );
}

export async function deleteSalarySnapshot(monthKey: string) {
  return supabase
    .from("salary_snapshots")
    .delete()
    .eq("month_key", monthKey);
}