import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import type { XlsxScheduleLayout } from "@/lib/importer";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function weekLabel(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(value);
}

function monthYearLabel(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(value);
}

function fileSafe(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function argb(hex?: string | null) {
  if (!hex) return undefined;
  const normalized = hex.replace("#", "").toUpperCase();
  return normalized.length === 6 ? `FF${normalized}` : undefined;
}

function color(hex?: string | null) {
  const value = argb(hex);
  return value ? { argb: value } : undefined;
}

function borderSide(side?: { style?: string; color?: string | null } | null): Partial<ExcelJS.Border> {
  return {
    style: (side?.style as ExcelJS.BorderStyle) ?? "thin",
    color: color(side?.color) ?? { argb: "FF000000" }
  };
}

function assignmentText(assignment?: {
  assignmentType?: string;
  sourceText?: string | null;
  broker?: { name: string } | null;
  importedCell?: { text?: string | null } | null;
}) {
  if (!assignment) return null;
  if (assignment.assignmentType === "EXTERNAL_IMPORTED") return assignment.sourceText || assignment.importedCell?.text || null;
  return assignment.broker?.name || "Sem cobertura";
}

function applyCellStyle(cell: ExcelJS.Cell, layoutCell: XlsxScheduleLayout["cells"][number]) {
  const style = layoutCell.style ?? {};
  if (style.fillColor) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argb(style.fillColor) }
    };
  }
  cell.font = {
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    size: style.fontSize ?? 9,
    color: color(style.fontColor)
  };
  cell.alignment = {
    horizontal: (style.horizontal as ExcelJS.Alignment["horizontal"]) ?? "center",
    vertical: (style.vertical as ExcelJS.Alignment["vertical"]) ?? "middle",
    wrapText: style.wrapText ?? true,
    textRotation: style.textRotation as ExcelJS.Alignment["textRotation"]
  };
  cell.border = {
    top: borderSide(style.border?.top),
    right: borderSide(style.border?.right),
    bottom: borderSide(style.border?.bottom),
    left: borderSide(style.border?.left)
  };
}

function parseLayout(layoutJson?: string | null) {
  if (!layoutJson) return null;
  try {
    const layout = JSON.parse(layoutJson) as XlsxScheduleLayout;
    return layout?.version === 1 && Array.isArray(layout.cells) ? layout : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  const { scheduleId } = await params;
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      import: true,
      assignments: {
        include: {
          broker: true,
          importedCell: true,
          dutyType: true
        }
      },
      changeNotices: { include: { request: true }, orderBy: { confirmedAt: "asc" } }
    }
  });

  if (!schedule || schedule.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Escala publicada nao encontrada." }, { status: 404 });
  }

  const layout = parseLayout(schedule.import?.layoutJson);
  if (!layout) {
    return NextResponse.json({ error: "Esta escala nao tem layout XLSX salvo para download fiel." }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "App Escala MD";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(layout.sheetName || "Escala");
  worksheet.views = [{ showGridLines: false }];

  for (const column of layout.columns) {
    worksheet.getColumn(column.index).width = column.width ?? 8;
  }
  for (const row of layout.rows) {
    worksheet.getRow(row.index).height = row.height ?? 15;
  }

  const assignmentsByCell = new Map(
    schedule.assignments
      .filter((assignment) => assignment.importedCell)
      .map((assignment) => [`${assignment.importedCell!.rowIndex}:${assignment.importedCell!.colIndex}`, assignment])
  );

  for (const layoutCell of layout.cells) {
    if (layoutCell.skip) continue;
    const cell = worksheet.getRow(layoutCell.rowIndex).getCell(layoutCell.colIndex);
    const assignedText = assignmentText(assignmentsByCell.get(`${layoutCell.rowIndex}:${layoutCell.colIndex}`));
    cell.value = assignedText ?? layoutCell.text ?? "";
    applyCellStyle(cell, layoutCell);
  }

  for (const merge of layout.merges ?? []) {
    try {
      worksheet.mergeCells(merge.top, merge.left, merge.bottom, merge.right);
    } catch {
      // ExcelJS rejects duplicate or invalid merges; imported layout may already be covered.
    }
  }

  if (schedule.changeNotices.length) {
    const notices = workbook.addWorksheet("Avisos de alterações");
    notices.columns = [
      { header: "Local", key: "local", width: 28 },
      { header: "Dia", key: "day", width: 16 },
      { header: "Horário", key: "time", width: 18 },
      { header: "Corretor anterior", key: "previous", width: 24 },
      { header: "Novo corretor", key: "next", width: 24 },
      { header: "Auditoria histórica privada", key: "warnings", width: 70 },
      { header: "Confirmação", key: "confirmation", width: 34 }
    ];
    notices.getRow(1).font = { bold: true };
    for (const notice of schedule.changeNotices) {
      const warnings = (() => {
        try {
          const analysis = JSON.parse(notice.request.analysisJson);
          return Array.isArray(analysis.warnings) && analysis.warnings.length ? analysis.warnings.join(" | ") : "Nenhum aumento mensurável de desequilíbrio detectado.";
        } catch {
          return "Análise privada indisponível.";
        }
      })();
      notices.addRow({
        local: notice.localName,
        day: notice.dayOfWeek,
        time: notice.timeLabel || (notice.startHour !== null ? `${String(notice.startHour).padStart(2, "0")}:00` : ""),
        previous: notice.previousBrokerName || "Sem cobertura",
        next: notice.newBrokerName || "Sem cobertura",
        warnings,
        confirmation: "Mudança confirmada expressamente pelo gerente via IA."
      });
    }
    notices.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
      row.eachCell((cell) => {
        cell.border = { top: borderSide(), right: borderSide(), bottom: borderSide(), left: borderSide() };
      });
    });
  }

  const weekStart = weekLabel(schedule.weekStart);
  const month = monthYearLabel(schedule.weekStart);
  const fileName = `escala-${fileSafe(dateOnly(schedule.weekStart))}-${fileSafe(month)}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Schedule-Week": weekStart
    }
  });
}
