"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { RealScheduleGrid } from "@/components/RealScheduleGrid";

type BrokerOption = { id: string; name: string };

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

function isFerreiraEditable(cell: LayoutCell, assignment?: Assignment) {
  return cell.ownerType === "FERREIRA_WINDOW" || assignment?.assignmentType === "FERREIRA_AI" || assignment?.assignmentType === "FERREIRA_MANUAL";
}

export function SpreadsheetScheduleGrid({
  schedule,
  brokers,
  editable,
  onChange,
  highlightBrokerId,
  fallbackForGroupedFilter = false
}: {
  schedule: ScheduleWithLayout;
  brokers?: BrokerOption[];
  editable?: boolean;
  onChange?: (assignmentId: string, brokerId: string) => void | Promise<void>;
  highlightBrokerId?: string | null;
  fallbackForGroupedFilter?: boolean;
}) {
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [selectedBrokerId, setSelectedBrokerId] = useState("");
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
        brokers={brokers}
        editable={editable}
        onChange={onChange ? (assignmentId, brokerId) => { void onChange(assignmentId, brokerId); } : undefined}
        highlightBrokerId={highlightBrokerId}
      />
    );
  }

  function openEditor(assignment: Assignment | undefined, cell: LayoutCell) {
    if (!editable || !brokers?.length || !assignment || !isFerreiraEditable(cell, assignment)) return;
    setSelected(assignment);
    setSelectedBrokerId(assignment.broker?.id ?? "");
  }

  async function saveManualChange() {
    if (!selected) return;
    await onChange?.(selected.id, selectedBrokerId);
    setSelected(null);
  }

  return (
    <>
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
                    const editableCell = isFerreiraEditable(cell, assignment);
                    const highlighted = Boolean(highlightBrokerId && assignment?.broker?.id === highlightBrokerId);
                    const hasAlert = Boolean(assignment?.isViolation || assignment?.balanceAlert || assignment?.manualAlerts?.length);
                    return (
                      <td
                        key={`${cell.rowIndex}:${cell.colIndex}`}
                        rowSpan={cell.rowSpan}
                        colSpan={cell.colSpan}
                        className={editable && editableCell ? "cursor-pointer" : undefined}
                        style={{
                          ...cellStyle(cell, row?.height),
                          outline: hasAlert ? "2px solid #D94A2B" : highlighted ? "2px solid #111827" : undefined,
                          outlineOffset: "-2px"
                        }}
                        onClick={() => openEditor(assignment, cell)}
                        data-help={editable && editableCell ? "Clique para trocar manualmente o corretor desta janela roxa." : undefined}
                        title={hasAlert ? assignment?.violationReason || assignment?.balanceAlert || "Ajuste manual com alerta" : undefined}
                      >
                        <span className={highlighted ? "font-black" : undefined}>{text}</span>
                        {assignment?.assignmentType === "FERREIRA_MANUAL" ? <span className="ml-1 text-[7px] font-black">MANUAL</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-graphite/20 bg-linen p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="ui-font text-xs font-bold uppercase tracking-[0.14em] text-signal">Ajuste manual</p>
                <h3 className="text-xl font-bold">{selected.importedCell?.localName ?? selected.dutyType?.name ?? "Janela roxa"}</h3>
                <p className="ui-font text-sm text-graphite">{selected.importedCell?.timeLabel ?? "Horario importado do XLSX"}</p>
              </div>
              <button className="rounded-md border border-graphite/20 p-1" onClick={() => setSelected(null)} data-help="Fecha esta janela sem salvar.">
                <X size={18} />
              </button>
            </div>
            <label className="ui-font block text-sm font-bold">
              Corretor
              <select
                className="control mt-1 w-full rounded-md px-3 py-2"
                value={selectedBrokerId}
                onChange={(event) => setSelectedBrokerId(event.target.value)}
                data-help="Escolhe o corretor que ficara nesta janela roxa."
              >
                <option value="">Sem cobertura</option>
                {brokers?.map((broker) => (
                  <option key={broker.id} value={broker.id}>
                    {broker.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button className="ui-font rounded-md border border-graphite/20 px-3 py-2 font-bold" onClick={() => setSelected(null)} data-help="Cancela a troca manual.">
                Cancelar
              </button>
              <button className="ui-font rounded-md bg-ink px-3 py-2 font-bold text-paper" onClick={saveManualChange} data-help="Salva a troca e registra alertas se houver regra quebrada.">
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
