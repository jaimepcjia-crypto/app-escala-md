"use client";

import { useMemo, type CSSProperties } from "react";
import { RealScheduleGrid } from "@/components/RealScheduleGrid";

type Assignment = {
  id: string;
  dayOfWeek: string;
  shift: string;
  slot: number;
  assignmentType?: string;
  sourceText?: string | null;
  sourceColorHex?: string | null;
  isViolation: boolean;
  violationReason?: string | null;
  balanceAlert?: string | null;
  broker?: { id: string; name: string; team?: { name: string } } | null;
  dutyType: { id: string; name: string };
  importedCell?: {
    id: string;
    rowIndex: number;
    colIndex: number;
    localName?: string | null;
    timeLabel?: string | null;
    ownerType: string;
    text?: string | null;
    colorHex?: string | null;
  } | null;
  manualAlerts?: { id: string; reason: string }[];
};

type LayoutCell = {
  rowIndex: number;
  colIndex: number;
  text: string;
  rowSpan: number;
  colSpan: number;
  skip?: boolean;
  ownerType?: "FERREIRA_WINDOW" | "EXTERNAL_IMPORTED" | null;
  style?: {
    fillColor?: string | null;
    fontColor?: string | null;
    bold?: boolean;
    italic?: boolean;
    fontSize?: number | null;
    horizontal?: string | null;
    vertical?: string | null;
    wrapText?: boolean;
    textRotation?: number | string | null;
    border?: {
      top?: BorderSide;
      right?: BorderSide;
      bottom?: BorderSide;
      left?: BorderSide;
    };
  };
};

type BorderSide = { style?: string; color?: string | null } | null;

type SpreadsheetLayout = {
  version: 1;
  sheetName: string;
  rowCount: number;
  columnCount: number;
  rows: Array<{ index: number; height?: number | null }>;
  columns: Array<{ index: number; width?: number | null }>;
  cells: LayoutCell[];
};

type ScheduleWithLayout = {
  assignments: Assignment[];
  import?: { layoutJson?: string | null } | null;
};

function parseLayout(layoutJson?: string | null): SpreadsheetLayout | null {
  if (!layoutJson) return null;
  try {
    const parsed = JSON.parse(layoutJson) as SpreadsheetLayout;
    if (parsed?.version !== 1 || !Array.isArray(parsed.cells)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function textColor(background?: string | null) {
  if (!background) return "#111827";
  const hex = background.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 < 130 ? "#FFFFFF" : "#111827";
}

function excelWidthToPx(width?: number | null) {
  if (!width) return 62;
  return Math.max(12, Math.round(width * 7 + 5));
}

function excelHeightToPx(height?: number | null) {
  if (!height) return 19;
  return Math.max(16, Math.round(height * 1.333));
}

function borderCss(side?: BorderSide) {
  return side?.style ? "1px solid #000000" : "1px solid #000000";
}

function cssAlign(value?: string | null) {
  if (value === "middle") return "center";
  if (value === "bottom") return "bottom";
  if (value === "top") return "top";
  return value ?? "center";
}

function cellStyle(cell: LayoutCell, rowHeight?: number | null): CSSProperties {
  const style = cell.style ?? {};
  const background = style.fillColor ?? "#FFFFFF";
  const rotated = Boolean(style.textRotation && style.textRotation !== "horizontal" && style.textRotation !== 0);
  return {
    minWidth: 0,
    height: excelHeightToPx(rowHeight),
    padding: "1px 2px",
    background,
    color: style.fontColor ?? textColor(background),
    fontWeight: style.bold ? 800 : 600,
    fontStyle: style.italic ? "italic" : undefined,
    fontSize: `${Math.min(11, Math.max(7, (style.fontSize ?? 9) - 1))}px`,
    lineHeight: "1.05",
    textAlign: (style.horizontal as CSSProperties["textAlign"]) ?? "center",
    verticalAlign: cssAlign(style.vertical) as CSSProperties["verticalAlign"],
    whiteSpace: style.wrapText || rotated ? "normal" : "pre-wrap",
    overflow: "hidden",
    wordBreak: "break-word",
    borderTop: borderCss(style.border?.top),
    borderRight: borderCss(style.border?.right),
    borderBottom: borderCss(style.border?.bottom),
    borderLeft: borderCss(style.border?.left),
    writingMode: rotated ? "vertical-rl" : undefined
  };
}

function displayText(cell: LayoutCell, assignment?: Assignment) {
  if (!assignment) return cell.text;
  if (assignment.assignmentType === "EXTERNAL_IMPORTED") {
    return assignment.sourceText || assignment.importedCell?.text || cell.text;
  }
  return assignment.broker?.name || "Sem cobertura";
}

export function SpreadsheetScheduleGrid({
  schedule,
  highlightBrokerId,
  fallbackForGroupedFilter = false
}: {
  schedule: ScheduleWithLayout;
  highlightBrokerId?: string | null;
  fallbackForGroupedFilter?: boolean;
}) {
  const layout = useMemo(() => parseLayout(schedule.import?.layoutJson), [schedule.import?.layoutJson]);
  const assignments = schedule.assignments ?? [];

  const assignmentByPosition = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const assignment of assignments) {
      const cell = assignment.importedCell;
      if (!cell) continue;
      map.set(`${cell.rowIndex}:${cell.colIndex}`, assignment);
    }
    return map;
  }, [assignments]);

  const rowsByIndex = useMemo(() => new Map(layout?.rows.map((row) => [row.index, row]) ?? []), [layout]);
  const cellsByRow = useMemo(() => {
    const map = new Map<number, LayoutCell[]>();
    for (const cell of layout?.cells ?? []) {
      if (!map.has(cell.rowIndex)) map.set(cell.rowIndex, []);
      map.get(cell.rowIndex)!.push(cell);
    }
    for (const cells of map.values()) cells.sort((left, right) => left.colIndex - right.colIndex);
    return map;
  }, [layout]);

  if (!layout || fallbackForGroupedFilter) {
    return (
      <RealScheduleGrid
        assignments={assignments}
        highlightBrokerId={highlightBrokerId}
      />
    );
  }

  return (
      <div className="overflow-auto rounded-lg border border-black bg-white">
        <table className="border-collapse bg-white font-sans" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {layout.columns.map((column) => (
              <col key={column.index} style={{ width: excelWidthToPx(column.width) }} />
            ))}
          </colgroup>
          <tbody>
            {Array.from({ length: layout.rowCount }, (_, rowOffset) => {
              const rowIndex = rowOffset + 1;
              const row = rowsByIndex.get(rowIndex);
              return (
                <tr key={rowIndex} style={{ height: excelHeightToPx(row?.height) }}>
                  {(cellsByRow.get(rowIndex) ?? []).map((cell) => {
                    if (cell.skip) return null;
                    const assignment = assignmentByPosition.get(`${cell.rowIndex}:${cell.colIndex}`);
                    const text = displayText(cell, assignment);
                    const highlighted = Boolean(highlightBrokerId && assignment?.broker?.id === highlightBrokerId);
                    const hasAlert = Boolean(assignment?.isViolation || assignment?.balanceAlert || assignment?.manualAlerts?.length);
                    return (
                      <td
                        key={`${cell.rowIndex}:${cell.colIndex}`}
                        rowSpan={cell.rowSpan}
                        colSpan={cell.colSpan}
                        style={{
                          ...cellStyle(cell, row?.height),
                          outline: hasAlert ? "2px solid #D94A2B" : highlighted ? "2px solid #111827" : undefined,
                          outlineOffset: "-2px"
                        }}
                        title={hasAlert ? assignment?.violationReason || assignment?.balanceAlert || "Ajuste manual com alerta" : undefined}
                      >
                        <span className={highlighted ? "font-black" : undefined}>{text}</span>
                        {assignment?.assignmentType === "FERREIRA_MANAGER_AI" ? <span className="ml-1 text-[7px] font-black">GERENTE VIA IA</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
  );
}
