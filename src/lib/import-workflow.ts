import { prisma } from "@/lib/prisma";

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

export async function latestConfirmedImport(weekStart: Date) {
  return prisma.scheduleImport.findFirst({
    where: { weekStart, status: "CONFIRMED" },
    include: { cells: true },
    orderBy: { confirmedAt: "desc" }
  });
}
