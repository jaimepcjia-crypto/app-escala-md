import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth";
import { normalizeWeekStart } from "@/lib/constants";
import { alignParsedScheduleToWeek, parseScheduleFile } from "@/lib/importer";
import { ensureSeedData } from "@/lib/seed";

export async function POST(request: NextRequest) {
  try {
    await ensureSeedData();
    const auth = await requireManager(request);
    if ("error" in auth) return auth.error;

    const formData = await request.formData();
    const weekStart = normalizeWeekStart(String(formData.get("weekStart") ?? ""));
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo nao enviado." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = alignParsedScheduleToWeek(await parseScheduleFile(file.name, buffer), weekStart);

    const scheduleImport = await prisma.scheduleImport.create({
      data: {
        weekStart,
        fileName: file.name,
        fileType: file.name.split(".").pop()?.toUpperCase() || "UNKNOWN",
        layoutJson: JSON.stringify(parsed.layout),
        cells: {
          create: parsed.cells.map((cell) => ({
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
