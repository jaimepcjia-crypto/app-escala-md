import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { normalizeWeekStart } from "@/lib/constants";
import { alignParsedScheduleToWeek, parseScheduleFile } from "@/lib/importer";
import { ensureSeedData } from "@/lib/seed";
import { deleteUnpublishedImport, replaceWithValidatedImport } from "@/lib/import-workflow";
import { generationWindowStatus, weeklyWorkflowStatus } from "@/lib/deadlines";
import { invalidatePendingChangeRequests } from "@/lib/ai-schedule-changes";

export async function POST(request: NextRequest) {
  try {
    await ensureSeedData();
    const auth = await requireManager(request);
    if ("error" in auth) return auth.error;

    const formData = await request.formData();
    const workflow = weeklyWorkflowStatus();
    const weekStart = normalizeWeekStart(workflow.weekStartDate);
    const gate = generationWindowStatus(weekStart);
    if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 403 });
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo nao enviado." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = alignParsedScheduleToWeek(await parseScheduleFile(file.name, buffer), weekStart);

    const scheduleImport = await replaceWithValidatedImport({
      weekStart,
      fileName: file.name,
      fileType: file.name.split(".").pop()?.toUpperCase() || "UNKNOWN",
      parsed
    });
    await invalidatePendingChangeRequests(weekStart);

    return NextResponse.json({
      import: scheduleImport,
      summary: {
        total: scheduleImport.cells.length,
        ferreiraWindows: scheduleImport.cells.filter((cell) => cell.ownerType === "FERREIRA_WINDOW").length,
        external: scheduleImport.cells.filter((cell) => cell.ownerType === "EXTERNAL_IMPORTED").length
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao importar escala." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireManager(request);
    if ("error" in auth) return auth.error;
    const workflow = weeklyWorkflowStatus();
    if (!workflow.isOpen) return NextResponse.json({ error: `Arquivos da proxima escala so podem ser excluidos no sabado ou domingo.` }, { status: 403 });
    const importId = request.nextUrl.searchParams.get("importId") ?? "";
    if (!importId) return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
    const result = await deleteUnpublishedImport(importId, workflow.weekStartDate);
    await invalidatePendingChangeRequests(workflow.weekStartDate);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao excluir arquivo." }, { status: 400 });
  }
}
