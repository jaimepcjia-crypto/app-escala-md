import { prisma } from "@/lib/prisma";
import type { ParsedScheduleFile } from "@/lib/importer";
import type { ScheduleImport, ImportedScheduleCell } from "@prisma/client";

function dutyDefaults(localName: string, priority: number) {
  const value = localName.toUpperCase();
  const isHeadquarters = value.includes("SEDE");
  const isCalling = value.includes("LIGAC");
  return {
    name: localName,
    priority,
    requiresExternal: !isHeadquarters && !isCalling,
    isHeadquarters,
    headquartersSlot: null,
    isCalling
  };
}

export async function ensureDutyTypeForLocal(localName: string | null | undefined, priority = 50) {
  const name = localName || "JANELA IMPORTADA";
  const data = dutyDefaults(name, priority);
  return prisma.dutyType.upsert({
    where: { name },
    update: data,
    create: data
  });
}

// Extrai e normaliza todos os nomes de plantão Ferreira de um import (para reconciliação).
export function extractFerreiraPlantaoNames(cells: ImportedScheduleCell[]): string[] {
  const ferreiraNames = cells
    .filter((cell) => cell.ownerType === "FERREIRA_WINDOW" && cell.localName)
    .map((cell) => cell.localName!);
  return [...new Set(ferreiraNames)];
}

// Cria as WeeklyWindow e DutyType a partir de um import (já com nomes finalizados/reconciliados).
// tx é opcional: se fornecido, usa a transação; se não, cria uma nova.
async function buildWeeklyWindowsForImport(
  scheduleImport: ScheduleImport & { cells: ImportedScheduleCell[] },
  tx?: any
) {
  const executor = tx || prisma;
  const purpleCells = scheduleImport.cells.filter(
    (cell) => cell.ownerType === "FERREIRA_WINDOW" && cell.dayOfWeek && cell.shift
  );

  let priority = 10;
  for (const cell of purpleCells) {
    const dutyData = dutyDefaults(cell.localName || "JANELA IMPORTADA", priority);
    const duty = await executor.dutyType.upsert({
      where: { name: dutyData.name },
      update: dutyData,
      create: dutyData
    });
    priority += 1;
    await executor.weeklyWindow.create({
      data: {
        weekStart: scheduleImport.weekStart,
        dayOfWeek: cell.dayOfWeek ?? "MONDAY",
        shift: cell.shift ?? "MORNING",
        startHour: cell.startHour,
        quantity: 1,
        dutyTypeId: duty.id,
        importCellId: cell.id,
        sourceText: cell.text,
        sourceColorHex: cell.colorHex,
        confidence: cell.confidence
      }
    });
  }
}

export async function confirmScheduleImport(importId: string) {
  const scheduleImport = await prisma.scheduleImport.findUnique({
    where: { id: importId },
    include: { cells: true }
  });
  if (!scheduleImport) throw new Error("Importacao nao encontrada.");

  await prisma.$transaction(async (tx) => {
    const existingSchedule = await tx.schedule.findFirst({ where: { weekStart: scheduleImport.weekStart } });
    if (existingSchedule) {
      throw new Error("A escala desta semana ja foi publicada anteriormente e o arquivo nao pode ser substituido.");
    }
    await tx.schedule.deleteMany({ where: { weekStart: scheduleImport.weekStart } });
    await tx.weeklyWindow.deleteMany({ where: { weekStart: scheduleImport.weekStart } });
    await tx.scheduleImport.updateMany({
      where: { weekStart: scheduleImport.weekStart, id: { not: importId } },
      data: { status: "SUPERSEDED" }
    });

    await buildWeeklyWindowsForImport(scheduleImport, tx);

    await tx.scheduleImport.update({
      where: { id: importId },
      data: { status: "CONFIRMED", confirmedAt: new Date() }
    });
  });

  return prisma.scheduleImport.findUnique({
    where: { id: importId },
    include: { cells: true }
  });
}

// Aplica as decisões de reconciliação (aliases) e finaliza o import.
export async function applyReconciliationAndFinalize(importId: string, decisions: Record<string, string>) {
  const scheduleImport = await prisma.scheduleImport.findUnique({
    where: { id: importId },
    include: { cells: true }
  });
  if (!scheduleImport) throw new Error("Importacao nao encontrada.");
  if (scheduleImport.status !== "PENDING_RECONCILIATION") {
    throw new Error("Import nao esta aguardando reconciliacao.");
  }

  return prisma.$transaction(async (tx) => {
    // Atualiza os nomes das células com base nas decisões do gerente e salva aliases.
    for (const [rawName, canonicalName] of Object.entries(decisions)) {
      if (canonicalName === "NEW") continue; // novo plantão, mantém o nome original
      // Reescreve localName para o canonicalName (alias)
      await tx.importedScheduleCell.updateMany({
        where: { importId, localName: rawName, ownerType: "FERREIRA_WINDOW" },
        data: { localName: canonicalName }
      });
      // Grava a decisão como alias para reuso futuro.
      const normalized = rawName
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
      await tx.plantaoNameAlias.upsert({
        where: { alias: normalized },
        update: { canonicalName },
        create: { alias: normalized, canonicalName }
      });
    }

    // Reconstrói o import com os nomes finalizados.
    const updated = await tx.scheduleImport.findUnique({
      where: { id: importId },
      include: { cells: true }
    });
    if (!updated) throw new Error("Import desapareceu durante reconciliacao.");

    // Constrói as janelas e finaliza.
    await buildWeeklyWindowsForImport(updated, tx);
    await tx.scheduleImport.update({
      where: { id: importId },
      data: { status: "CONFIRMED", confirmedAt: new Date() }
    });

    return updated;
  });
}

// Estágia um import com status PENDING_RECONCILIATION quando há nomes ambíguos.
export async function stageImportWithPendingReconciliation(input: {
  weekStart: Date;
  fileName: string;
  fileType: string;
  parsed: ParsedScheduleFile;
}) {
  return prisma.$transaction(async (tx) => {
    const existingSchedule = await tx.schedule.findFirst({ where: { weekStart: input.weekStart } });
    if (existingSchedule) {
      throw new Error("A escala desta semana ja foi publicada anteriormente e o arquivo nao pode ser substituido.");
    }

    // Limpa imports anteriores não confirmados.
    await tx.weeklyWindow.deleteMany({ where: { weekStart: input.weekStart } });
    await tx.scheduleImport.deleteMany({ where: { weekStart: input.weekStart } });

    // Cria o import com status PENDING_RECONCILIATION (sem janelas).
    const scheduleImport = await tx.scheduleImport.create({
      data: {
        weekStart: input.weekStart,
        fileName: input.fileName,
        fileType: input.fileType,
        status: "PENDING_RECONCILIATION",
        layoutJson: JSON.stringify(input.parsed.layout),
        cells: {
          create: input.parsed.cells.map((cell) => ({
            rowIndex: cell.rowIndex,
            colIndex: cell.colIndex,
            rowLabel: cell.rowLabel,
            colLabel: cell.colLabel,
            localName: cell.localName,
            timeLabel: cell.timeLabel,
            dayOfWeek: cell.dayOfWeek,
            shift: cell.shift,
            startHour: cell.startHour,
            dateLabel: cell.dateLabel,
            text: cell.text,
            colorHex: cell.colorHex,
            ownerType: cell.ownerType,
            confidence: cell.confidence
          }))
        }
      },
      include: { cells: true }
    });

    return scheduleImport;
  });
}

export async function replaceWithValidatedImport(input: {
  weekStart: Date;
  fileName: string;
  fileType: string;
  parsed: ParsedScheduleFile;
}) {
  const purpleCells = input.parsed.cells.filter((cell) => cell.ownerType === "FERREIRA_WINDOW" && cell.dayOfWeek && cell.shift);
  if (!input.parsed.cells.length) throw new Error("O XLSX nao contem celulas de escala reconhecidas.");
  if (!purpleCells.length) throw new Error("O XLSX nao contem janelas roxas validas para a equipe Ferreira.");

  return prisma.$transaction(async (tx) => {
    const existingSchedule = await tx.schedule.findFirst({ where: { weekStart: input.weekStart } });
    if (existingSchedule) throw new Error("A escala desta semana ja foi publicada anteriormente e o arquivo nao pode ser substituido.");

    await tx.weeklyWindow.deleteMany({ where: { weekStart: input.weekStart } });
    await tx.scheduleImport.deleteMany({ where: { weekStart: input.weekStart } });

    const scheduleImport = await tx.scheduleImport.create({
      data: {
        weekStart: input.weekStart,
        fileName: input.fileName,
        fileType: input.fileType,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        layoutJson: JSON.stringify(input.parsed.layout),
        cells: {
          create: input.parsed.cells.map((cell) => ({
            rowIndex: cell.rowIndex,
            colIndex: cell.colIndex,
            rowLabel: cell.rowLabel,
            colLabel: cell.colLabel,
            localName: cell.localName,
            timeLabel: cell.timeLabel,
            dayOfWeek: cell.dayOfWeek,
            shift: cell.shift,
            startHour: cell.startHour,
            dateLabel: cell.dateLabel,
            text: cell.text,
            colorHex: cell.colorHex,
            ownerType: cell.ownerType,
            confidence: cell.confidence
          }))
        }
      },
      include: { cells: true }
    });

    await buildWeeklyWindowsForImport(scheduleImport, tx);
    return scheduleImport;
  });
}

export async function deleteUnpublishedImport(importId: string, weekStart: Date) {
  return prisma.$transaction(async (tx) => {
    const scheduleImport = await tx.scheduleImport.findUnique({ where: { id: importId } });
    if (!scheduleImport || scheduleImport.weekStart.getTime() !== weekStart.getTime()) throw new Error("Arquivo da proxima escala nao encontrado.");
    const existingSchedule = await tx.schedule.findFirst({ where: { weekStart } });
    if (existingSchedule) throw new Error("A escala ja foi publicada anteriormente e o arquivo nao pode ser excluido.");
    // Limpa WeeklyWindow (só existem se o import foi finalizado) e o import (PENDING_RECONCILIATION ou CONFIRMED).
    await tx.weeklyWindow.deleteMany({ where: { weekStart } });
    await tx.scheduleImport.delete({ where: { id: importId } });
    return { deleted: true };
  });
}

export async function latestConfirmedImport(weekStart: Date) {
  return prisma.scheduleImport.findFirst({
    where: { weekStart, status: "CONFIRMED" },
    include: { cells: true },
    orderBy: { confirmedAt: "desc" }
  });
}
