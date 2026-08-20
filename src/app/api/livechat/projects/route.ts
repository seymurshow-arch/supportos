import { NextResponse } from "next/server";
import { resolveConfiguredLiveChatProjects } from "@/services/livechatProjectsService";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const names = String(searchParams.get("names") || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    const projects = await resolveConfiguredLiveChatProjects(names.length ? names : undefined);
    return NextResponse.json({ ok: true, projects });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load LiveChat projects" },
      { status: 500 },
    );
  }
}
