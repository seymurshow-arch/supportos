import { NextResponse } from "next/server";
import { resolveConfiguredLiveChatProjects } from "@/services/livechatProjectsService";

export async function GET() {
  try {
    const projects = await resolveConfiguredLiveChatProjects();
    return NextResponse.json({ ok: true, projects });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load LiveChat projects" },
      { status: 500 },
    );
  }
}
