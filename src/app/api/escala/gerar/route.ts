import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { generateAndPublishSchedule } from "@/lib/schedule-actions";
import { weeklyWorkflowStatus } from "@/lib/deadlines";

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json(await generateAndPublishSchedule(weeklyWorkflowStatus().weekStartDate));
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao gerar escala." }, { status });
  }
}
