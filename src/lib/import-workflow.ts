import { prisma } from "@/lib/prisma";
import type { ParsedScheduleFile } from "@/lib/importer";

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

    const purpleCells = scheduleImport.cells.filter(
      (cell) => cell.ownerType === "FERREIRA_WINDOW" && cell.dayOfWeek && cell.shift
    );

    let priority = 10;
    for (const cell of purpleCells) {
      const dutyData = dutyDefaults(cell.localName || "JANELA IMPORTADA", priority);
      const duty = await tx.dutyType.upsert({
        where: { name: dutyData.name },
        update: dutyData,
        create: dutyData
      });
      priority += 1;
      await tx.weeklyWindow.create({
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

    let priority = 10;
    for (const cell of scheduleImport.cells.filter((item) => item.ownerType === "FERREIRA_WINDOW" && item.dayOfWeek && item.shift)) {
      const dutyData = dutyDefaults(cell.localName || "JANELA IMPORTADA", priority);
      const duty = await tx.dutyType.upsert({ where: { name: dutyData.name }, update: dutyData, create: dutyData });
      priority += 1;
      await tx.weeklyWindow.create({
        data: {
          weekStart: input.weekStart,
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
    return scheduleImport;
  });
}

export async function deleteUnpublishedImport(importId: string, weekStart: Date) {
  return prisma.$transaction(async (tx) => {
    const scheduleImport = await tx.scheduleImport.findUnique({ where: { id: importId } });
    if (!scheduleImport || scheduleImport.weekStart.getTime() !== weekStart.getTime()) throw new Error("Arquivo da proxima escala nao encontrado.");
    const existingSchedule = await tx.schedule.findFirst({ where: { weekStart } });
    if (existingSchedule) throw new Error("A escala ja foi publicada anteriormente e o arquivo nao pode ser excluido.");
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
