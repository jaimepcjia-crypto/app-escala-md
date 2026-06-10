import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { normalizeWeekStart } from "@/lib/constants";
import { alignParsedScheduleToWeek, parseScheduleFile } from "@/lib/importer";
import { ensureSeedData } from "@/lib/seed";
import {
  deleteUnpublishedImport,
  replaceWithValidatedImport,
  stageImportWithPendingReconciliation,
  extractFerreiraPlantaoNames,
  latestConfirmedImport
} from "@/lib/import-workflow";
import { generationWindowStatus, weeklyWorkflowStatus } from "@/lib/deadlines";
import { invalidatePendingChangeRequests } from "@/lib/ai-schedule-changes";
import { classifyImportedPlantoes, buildImportChangeSummary } from "@/lib/plantao-reconciliation";
import { prisma } from "@/lib/prisma";

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

    // Extrai nomes de plantão Ferreira do novo arquivo.
    const importedNames = extractFerreiraPlantaoNames(
      parsed.cells.map((cell) => ({
        localName: cell.localName,
        ownerType: cell.ownerType
      })) as any
    );

    // Carrega nomes conhecidos (DutyType) e aliases decididos anteriormente.
    const [knownDuties, aliases] = await Promise.all([
      prisma.dutyType.findMany({ select: { name: true } }),
      prisma.plantaoNameAlias.findMany()
    ]);
    const knownNames = knownDuties.map((d) => d.name);
    const aliasMap = new Map(aliases.map((a) => [a.alias, a.canonicalName]));

    // Classifica os nomes do novo arquivo.
    const classifications = classifyImportedPlantoes({
      parsedNames: importedNames,
      knownNames,
      aliases: aliasMap
    });

    // Separa ambíguos de não ambíguos.
    const ambiguous = classifications.filter((c) => c.status === "AMBIGUOUS");

    // Se há nomes ambíguos, estágia o import para reconciliação.
    if (ambiguous.length > 0) {
      const staged = await stageImportWithPendingReconciliation({
        weekStart,
        fileName: file.name,
        fileType: file.name.split(".").pop()?.toUpperCase() || "UNKNOWN",
        parsed
      });

      // Carrega o import anterior confirmado para comparar mudanças.
      const previousImport = await latestConfirmedImport(weekStart);
      const previousCells = previousImport?.cells || [];
      const changeSummary = buildImportChangeSummary(
        previousCells.map((c) => ({ localName: c.localName!, startHour: c.startHour })),
        parsed.cells
          .filter((c) => c.ownerType === "FERREIRA_WINDOW")
          .map((c) => ({ localName: c.localName!, startHour: c.startHour! }))
      );

      await invalidatePendingChangeRequests(weekStart);

      return NextResponse.json({
        import: staged,
        pendingReconciliation: ambiguous.map((c) => ({
          rawName: c.rawName,
          suggestion: c.status === "AMBIGUOUS" ? c.suggestion : undefined
        })),
        changeSummary,
        summary: {
          total: staged.cells.length,
          ferreiraWindows: staged.cells.filter((cell) => cell.ownerType === "FERREIRA_WINDOW").length,
          external: staged.cells.filter((cell) => cell.ownerType === "EXTERNAL_IMPORTED").length
        }
      });
    }

    // Sem ambiguidades: finaliza o import normalmente.
    const scheduleImport = await replaceWithValidatedImport({
      weekStart,
      fileName: file.name,
      fileType: file.name.split(".").pop()?.toUpperCase() || "UNKNOWN",
      parsed
    });

    // Carrega o import anterior para comparar mudanças.
    const previousImport = await latestConfirmedImport(weekStart);
    const previousCells = previousImport?.cells || [];
    const changeSummary = buildImportChangeSummary(
      previousCells.map((c) => ({ localName: c.localName!, startHour: c.startHour })),
      parsed.cells
        .filter((c) => c.ownerType === "FERREIRA_WINDOW")
        .map((c) => ({ localName: c.localName!, startHour: c.startHour! }))
    );

    await invalidatePendingChangeRequests(weekStart);

    return NextResponse.json({
      import: scheduleImport,
      changeSummary,
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
