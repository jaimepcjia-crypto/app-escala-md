import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth";
import { invalidatePendingChangeRequests } from "@/lib/ai-schedule-changes";
import { generationWindowStatus, weeklyWorkflowStatus } from "@/lib/deadlines";

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const workflow = weeklyWorkflowStatus();
  const gate = generationWindowStatus(workflow.weekStartDate);
  if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const schedule = await prisma.schedule.findUnique({ where: { id: body.scheduleId } });
  if (!schedule) return NextResponse.json({ error: "Escala nao encontrada." }, { status: 404 });
  if (schedule.weekStart.getTime() !== workflow.weekStartDate.getTime()) {
    return NextResponse.json({ error: "Somente a escala da proxima semana pode ser publicada." }, { status: 403 });
  }
  if (schedule.status === "PUBLISHED") return NextResponse.json({ schedule });

  const published = await prisma.schedule.update({
    where: { id: schedule.id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
    include: {
      assignments: { include: { broker: { include: { team: true } }, dutyType: true } }
    }
  });
  await invalidatePendingChangeRequests(schedule.weekStart);

  return NextResponse.json({ schedule: published });
}
