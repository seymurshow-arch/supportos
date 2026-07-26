import { supabase } from "@/lib/supabase";

export type Schedule = {
  id: string;
  month_key: string;
  title: string;
  raw_text: string | null;
  parsed_data: any;
  stats: any;
};

export async function getSchedules() {
  return supabase
    .from("schedules")
    .select("*")
    .order("month_key", { ascending: false });
}

export async function getSchedule(monthKey: string) {
  return supabase
    .from("schedules")
    .select("*")
    .eq("month_key", monthKey)
    .single();
}

export async function saveSchedule(data: Omit<Schedule, "id">) {
  return supabase
    .from("schedules")
    .upsert(data, {
      onConflict: "month_key",
    });
}

export async function deleteSchedule(monthKey: string) {
  return supabase
    .from("schedules")
    .delete()
    .eq("month_key", monthKey);
}