import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { getAdminSnapshot } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { ensureSeedData } from "@/lib/seed";

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export async function GET(request: NextRequest) {
  await ensureSeedData();
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;
  const weekStart = request.nextUrl.searchParams.get("weekStart") ?? undefined;
  const snapshot = await getAdminSnapshot(weekStart);

  const [imports, schedules] = await Promise.all([
    prisma.scheduleImport.findMany({
      include: { cells: true },
      orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }]
    }),
    prisma.schedule.findMany({
      where: { status: "PUBLISHED" },
      include: {
        import: true,
        assignments: {
          include: {
            broker: { include: { team: true } },
            dutyType: true,
            importedCell: true,
            manualAlerts: true
          },
          orderBy: [{ dayOfWeek: "asc" }, { shift: "asc" }, { slot: "asc" }]
        }
      },
      orderBy: [{ weekStart: "desc" }, { publishedAt: "desc" }]
    })
  ]);

  return NextResponse.json({
    brokers: snapshot.brokers,
    salesMonthStart: snapshot.salesMonthStart,
    imports: imports.map((item) => ({
      id: item.id,
      weekStart: dateOnly(item.weekStart),
      fileName: item.fileName,
      fileType: item.fileType,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      confirmedAt: item.confirmedAt?.toISOString() ?? null,
      summary: {
        total: item.cells.length,
        ferreiraWindows: item.cells.filter((cell) => cell.ownerType === "FERREIRA_WINDOW").length,
        external: item.cells.filter((cell) => cell.ownerType === "EXTERNAL_IMPORTED").length
      }
    })),
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      weekStart: dateOnly(schedule.weekStart),
      status: schedule.status,
      publishedAt: schedule.publishedAt?.toISOString() ?? null,
      importFileName: schedule.import?.fileName ?? null,
      import: schedule.import
        ? {
            id: schedule.import.id,
            fileName: schedule.import.fileName,
            layoutJson: schedule.import.layoutJson
          }
        : null,
      assignments: schedule.assignments
    }))
  });
}
