import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { addDays, currentSaoPauloDate } from "@/lib/deadlines";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function scheduleStateFingerprint(weekStart: Date) {
  const weekEnd = addDays(weekStart, 6);
  const [priorities, brokers, unavailabilities, scheduleImport, windows, schedule] = await Promise.all([
    prisma.dutyPriority.findMany({ select: { localName: true, position: true, updatedAt: true }, orderBy: { localName: "asc" } }),
    prisma.broker.findMany({
      where: { team: { isFerreira: true } },
      select: { id: true, active: true, canExternalDuty: true, effortLevel: true, updatedAt: true },
      orderBy: { id: "asc" }
    }),
    prisma.unavailability.findMany({
      where: { date: { gte: weekStart, lte: weekEnd } },
      select: { id: true, brokerId: true, date: true, startHour: true, endHour: true, shift: true },
      orderBy: { id: "asc" }
    }),
    prisma.scheduleImport.findFirst({
      where: { weekStart, status: "CONFIRMED" },
      select: { id: true, status: true, confirmedAt: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.weeklyWindow.findMany({
      where: { weekStart },
      select: { id: true, dayOfWeek: true, shift: true, startHour: true, quantity: true, dutyTypeId: true, importCellId: true },
      orderBy: { id: "asc" }
    }),
    prisma.schedule.findFirst({
      where: { weekStart, status: "PUBLISHED" },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        assignments: {
          select: { id: true, brokerId: true, dayOfWeek: true, shift: true, startHour: true, dutyTypeId: true, importedCellId: true, assignmentType: true },
          orderBy: { id: "asc" }
        }
      },
      orderBy: { publishedAt: "desc" }
    })
  ]);
  return createHash("sha256").update(stable({
    today: currentSaoPauloDate().toISOString().slice(0, 10),
    priorities,
    brokers,
    unavailabilities,
    scheduleImport,
    windows,
    schedule
  })).digest("hex");
}
