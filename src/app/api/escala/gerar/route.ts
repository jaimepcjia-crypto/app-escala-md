import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { generateAndPublishSchedule } from "@/lib/schedule-actions";

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  try {
    const body = await request.json();
    return NextResponse.json(await generateAndPublishSchedule(body.weekStart));
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao gerar escala." }, { status });
  }
}
