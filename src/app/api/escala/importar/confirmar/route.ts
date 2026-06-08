import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { confirmScheduleImport } from "@/lib/import-workflow";
import { generationWindowStatus, weeklyWorkflowStatus } from "@/lib/deadlines";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const importId = String(body.importId ?? "");
  if (!importId) return NextResponse.json({ error: "Importacao obrigatoria." }, { status: 400 });

  try {
    const workflow = weeklyWorkflowStatus();
    const gate = generationWindowStatus(workflow.weekStart);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason }, { status: 403 });
    }

    const existingImport = await prisma.scheduleImport.findUnique({
      where: { id: importId },
      select: { weekStart: true },
    });
    if (!existingImport || existingImport.weekStart.getTime() !== workflow.weekStartDate.getTime()) {
      return NextResponse.json(
        { error: "Somente o arquivo da proxima semana pode ser confirmado." },
        { status: 400 },
      );
    }

    const confirmedImport = await confirmScheduleImport(importId);
    return NextResponse.json({ import: confirmedImport });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao confirmar importacao." }, { status: 400 });
  }
}
