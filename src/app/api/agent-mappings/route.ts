import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }

  if (!key) {
    throw new Error(
      "Neither SUPABASE_SERVICE_ROLE_KEY nor NEXT_PUBLIC_SUPABASE_ANON_KEY is configured"
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function GET() {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("agent_schedule_mappings")
      .select("schedule_name,email,created_at,updated_at")
      .order("schedule_name", { ascending: true });

    if (error) {
      console.error("[agent-mappings][GET] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error("[agent-mappings][GET] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load mappings" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const scheduleName = normalizeName(body?.schedule_name);
    const email = normalizeEmail(body?.email);

    if (!scheduleName) {
      return NextResponse.json({ error: "Schedule name is required" }, { status: 400 });
    }

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (!validEmail(email)) {
      return NextResponse.json({ error: "Email format is invalid" }, { status: 400 });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("agent_schedule_mappings")
      .upsert(
        {
          schedule_name: scheduleName,
          email,
          updated_at: now,
        },
        { onConflict: "schedule_name" }
      )
      .select("schedule_name,email,created_at,updated_at")
      .single();

    if (error) {
      console.error("[agent-mappings][POST] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error("[agent-mappings][POST] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save mapping" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const scheduleName = normalizeName(body?.schedule_name);

    if (!scheduleName) {
      return NextResponse.json({ error: "Schedule name is required" }, { status: 400 });
    }

    const supabase = getSupabase();

    const { error } = await supabase
      .from("agent_schedule_mappings")
      .delete()
      .eq("schedule_name", scheduleName);

    if (error) {
      console.error("[agent-mappings][DELETE] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: null });
  } catch (error) {
    console.error("[agent-mappings][DELETE] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete mapping" },
      { status: 500 }
    );
  }
}
