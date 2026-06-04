import ExcelJS from "exceljs";

export type ImportCellCandidate = {
  rowIndex: number;
  colIndex: number;
  rowLabel?: string | null;
  colLabel?: string | null;
  localName?: string | null;
  timeLabel?: string | null;
  dayOfWeek?: string | null;
  shift?: string | null;
  startHour?: number | null;
  dateLabel?: string | null;
  text?: string | null;
  colorHex?: string | null;
  ownerType: "FERREIRA_WINDOW" | "EXTERNAL_IMPORTED";
  confidence: number;
};

type BorderSide = { style?: string; color?: string | null } | null;

export type XlsxLayoutCell = {
  rowIndex: number;
  colIndex: number;
  text: string;
  rowSpan: number;
  colSpan: number;
  skip?: boolean;
  ownerType?: "FERREIRA_WINDOW" | "EXTERNAL_IMPORTED" | null;
  style: {
    fillColor?: string | null;
    fontColor?: string | null;
    bold?: boolean;
    italic?: boolean;
    fontSize?: number | null;
    horizontal?: string | null;
    vertical?: string | null;
    wrapText?: boolean;
    textRotation?: number | string | null;
    border?: { top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide };
  };
};

export type XlsxScheduleLayout = {
  version: 1;
  sheetName: string;
  rowCount: number;
  columnCount: number;
  rows: Array<{ index: number; height?: number | null }>;
  columns: Array<{ index: number; width?: number | null }>;
  merges: Array<{ top: number; left: number; bottom: number; right: number }>;
  cells: XlsxLayoutCell[];
};

export type ParsedScheduleFile = {
  cells: ImportCellCandidate[];
  layout: XlsxScheduleLayout;
};

const dayOffsets = new Map([
  ["MONDAY", 0],
  ["TUESDAY", 1],
  ["WEDNESDAY", 2],
  ["THURSDAY", 3],
  ["FRIDAY", 4],
  ["SATURDAY", 5],
  ["SUNDAY", 6]
]);
const PURPLE = { r: 180, g: 167, b: 214 };
const dayMap = new Map([
  ["SEGUNDA", "MONDAY"],
  ["TERCA", "TUESDAY"],
  ["TERÇA", "TUESDAY"],
  ["QUARTA", "WEDNESDAY"],
  ["QUINTA", "THURSDAY"],
  ["SEXTA", "FRIDAY"],
  ["SABADO", "SATURDAY"],
  ["SÁBADO", "SATURDAY"],
  ["DOMINGO", "SUNDAY"]
]);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim();
}

function argbToHex(argb?: string) {
  if (!argb) return null;
  const value = argb.length === 8 ? argb.slice(2) : argb;
  if (value.length !== 6) return null;
  return `#${value.toUpperCase()}`;
}

function rgb(hex: string) {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function isPurpleFerreira(colorHex: string | null) {
  if (!colorHex) return false;
  const color = rgb(colorHex);
  const distance = Math.sqrt((color.r - PURPLE.r) ** 2 + (color.g - PURPLE.g) ** 2 + (color.b - PURPLE.b) ** 2);
  return distance <= 45 && color.b > color.r + 20 && color.b > color.g + 20;
}

function fillHex(cell: ExcelJS.Cell) {
  const fill = cell.fill;
  return fill?.type === "pattern" ? argbToHex(fill.fgColor?.argb) : null;
}

function colorHex(color?: Partial<ExcelJS.Color>) {
  return argbToHex(color?.argb);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(value);
}

function formatWeekDate(weekStart: Date, dayOfWeek: string | null | undefined) {
  const offset = dayOffsets.get(dayOfWeek ?? "");
  if (offset === undefined) return null;
  const date = new Date(weekStart);
  date.setUTCDate(date.getUTCDate() + offset);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date);
}

function textFromValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
  if ("text" in value && value.text !== undefined) return String(value.text).trim();
  if ("result" in value) return textFromValue(value.result as ExcelJS.CellValue);
  if ("formula" in value) return String(value.formula ?? "").trim();
  return "";
}

function cellText(cell: ExcelJS.Cell) {
  const valueText = textFromValue(cell.value);
  if (valueText && valueText !== "[object Object]") return valueText;
  try {
    const text = cell.text?.trim() ?? "";
    return text === "[object Object]" ? "" : text;
  } catch {
    return "";
  }
}

function parseRange(range: string) {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) return null;
  const toNumber = (letters: string) => letters.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
  const left = toNumber(match[1]);
  const top = Number(match[2]);
  const right = toNumber(match[3]);
  const bottom = Number(match[4]);
  return { top, left, bottom, right };
}

function borderSide(side?: Partial<ExcelJS.Border>) {
  if (!side?.style) return null;
  return { style: side.style, color: colorHex(side.color) };
}

function cellStyle(cell: ExcelJS.Cell): XlsxLayoutCell["style"] {
  return {
    fillColor: fillHex(cell),
    fontColor: colorHex(cell.font?.color),
    bold: Boolean(cell.font?.bold),
    italic: Boolean(cell.font?.italic),
    fontSize: cell.font?.size ?? null,
    horizontal: cell.alignment?.horizontal ?? null,
    vertical: cell.alignment?.vertical ?? null,
    wrapText: Boolean(cell.alignment?.wrapText),
    textRotation: cell.alignment?.textRotation ?? null,
    border: {
      top: borderSide(cell.border?.top),
      right: borderSide(cell.border?.right),
      bottom: borderSide(cell.border?.bottom),
      left: borderSide(cell.border?.left)
    }
  };
}

function inferShiftFromStartHour(startHour: number | null) {
  if (startHour === null) return "MORNING";
  if (startHour < 12) return "MORNING";
  if (startHour < 16) return "AFTERNOON";
  return "NIGHT";
}

export function inferStartHourFromText(text: string | null, rowIndex = 0) {
  const value = (text ?? "").toLowerCase();
  if (value.includes("plantao noturno") || value.includes("plantão noturno")) return 20;
  const match = value.match(/(?:^|[^\d])([01]?\d|2[0-3])\s*h/);
  if (match) return Number(match[1]);
  if (rowIndex < 15) return 8;
  if (rowIndex < 35) return 12;
  return 20;
}

function normalizeLocal(label: string | null) {
  const value = normalize(label ?? "");
  if (value.includes("NOTURNO")) return "PLANTAO NOTURNO";
  if (value.includes("SOMB")) return "STAND / SOMB";
  if (value.includes("BARRA")) return "BARRA";
  if (value.includes("QUIOS")) return "QUIOSQUE";
  if (value.includes("M CLUB")) return "M CLUB";
  if (value.includes("CS")) return "CS MD";
  if (value.includes("LIGA")) return "LIGACAO";
  if (value.includes("O.A") || value.includes("SEDE MD")) return "SEDE MD / O.A.";
  if (value.includes("SEDE")) return "SEDE MOURA DUBEUX";
  return label || "JANELA IMPORTADA";
}

function isNameLikeCell(text: string) {
  const value = normalize(text);
  if (!value) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^\d{1,2}\/\d{1,2}$/.test(value)) return false;
  if (/^\d{1,2}H/.test(value)) return false;
  if (["SEMANA", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO", "DOMINGO"].includes(value)) return false;
  if (value.includes("PLANTAO") || value.includes("HORARIO") || value.includes("LOCAL")) return false;
  return true;
}

function dayColumns(worksheet: ExcelJS.Worksheet, maxCol: number) {
  const days = new Map<number, string>();
  for (let colIndex = 1; colIndex <= maxCol; colIndex += 1) {
    const value = normalize(cellText(worksheet.getRow(2).getCell(colIndex)));
    const day = dayMap.get(value);
    if (day) days.set(colIndex, day);
  }
  return days;
}

function nearestTimeLabel(worksheet: ExcelJS.Worksheet, rowIndex: number, colIndex: number) {
  const candidates = colIndex >= 12 ? [colIndex - 1, colIndex - 2, 4] : [4, colIndex - 1];
  for (const candidate of candidates) {
    if (candidate <= 0) continue;
    const text = cellText(worksheet.getRow(rowIndex).getCell(candidate));
    if (/\d{1,2}h/i.test(text) || normalize(text).includes("PLANTAO NOTURNO")) return text;
  }
  return "";
}

function rowLocalLabel(worksheet: ExcelJS.Worksheet, rowIndex: number) {
  for (let row = rowIndex; row >= 1; row -= 1) {
    const left = cellText(worksheet.getRow(row).getCell(2));
    const middle = cellText(worksheet.getRow(row).getCell(3));
    const time = cellText(worksheet.getRow(row).getCell(4));
    if (normalize(time).includes("PLANTAO NOTURNO")) return time;
    if (left && middle) return `${left} ${middle}`;
    if (left) return left;
    if (middle) return middle;
  }
  return "";
}

function hasVisibleContent(cell: ExcelJS.Cell) {
  return Boolean(cellText(cell) || fillHex(cell) || cell.border?.top || cell.border?.right || cell.border?.bottom || cell.border?.left);
}

function usedRange(worksheet: ExcelJS.Worksheet) {
  let maxTextRow = 1;
  let maxTextCol = 1;
  worksheet.eachRow({ includeEmpty: true }, (row, rowIndex) => {
    for (let colIndex = 1; colIndex <= Math.min(worksheet.columnCount, 40); colIndex += 1) {
      const cell = row.getCell(colIndex);
      if (cellText(cell)) {
        maxTextRow = Math.max(maxTextRow, rowIndex);
        maxTextCol = Math.max(maxTextCol, colIndex);
      }
    }
  });
  const maxRow = Math.min(maxTextRow, 120);
  const maxCol = Math.min(Math.max(maxTextCol, 14), 20);
  return { maxRow, maxCol };
}

function buildLayout(worksheet: ExcelJS.Worksheet, maxRow: number, maxCol: number, ownerByPosition: Map<string, ImportCellCandidate["ownerType"]>): XlsxScheduleLayout {
  const parsedMerges = (worksheet.model.merges ?? [])
    .map(parseRange)
    .filter((merge): merge is { top: number; left: number; bottom: number; right: number } => Boolean(merge))
    .filter((merge) => merge.top <= maxRow && merge.left <= maxCol);
  const mergeMaster = new Map<string, { top: number; left: number; bottom: number; right: number }>();
  const mergeCovered = new Set<string>();
  for (const merge of parsedMerges) {
    mergeMaster.set(`${merge.top}:${merge.left}`, merge);
    for (let row = merge.top; row <= merge.bottom; row += 1) {
      for (let col = merge.left; col <= merge.right; col += 1) {
        if (row !== merge.top || col !== merge.left) mergeCovered.add(`${row}:${col}`);
      }
    }
  }

  const cells: XlsxLayoutCell[] = [];
  for (let rowIndex = 1; rowIndex <= maxRow; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    for (let colIndex = 1; colIndex <= maxCol; colIndex += 1) {
      const key = `${rowIndex}:${colIndex}`;
      const merge = mergeMaster.get(key);
      if (mergeCovered.has(key)) {
        cells.push({ rowIndex, colIndex, text: "", rowSpan: 1, colSpan: 1, skip: true, style: cellStyle(row.getCell(colIndex)) });
        continue;
      }
      const cell = row.getCell(colIndex);
      cells.push({
        rowIndex,
        colIndex,
        text: cellText(cell),
        rowSpan: merge ? merge.bottom - merge.top + 1 : 1,
        colSpan: merge ? merge.right - merge.left + 1 : 1,
        ownerType: ownerByPosition.get(key) ?? null,
        style: cellStyle(cell)
      });
    }
  }

  return {
    version: 1,
    sheetName: worksheet.name,
    rowCount: maxRow,
    columnCount: maxCol,
    rows: Array.from({ length: maxRow }, (_, index) => {
      const row = worksheet.getRow(index + 1);
      return { index: index + 1, height: row.height ?? null };
    }),
    columns: Array.from({ length: maxCol }, (_, index) => {
      const column = worksheet.getColumn(index + 1);
      return { index: index + 1, width: column.width ?? null };
    }),
    merges: parsedMerges,
    cells
  };
}

export async function parseXlsxSchedule(buffer: Buffer): Promise<ParsedScheduleFile> {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  const { maxRow, maxCol } = usedRange(worksheet);
  const daysByColumn = dayColumns(worksheet, maxCol);
  const candidates: ImportCellCandidate[] = [];
  const ownerByPosition = new Map<string, ImportCellCandidate["ownerType"]>();

  for (let rowIndex = 1; rowIndex <= maxRow; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    for (let colIndex = 1; colIndex <= maxCol; colIndex += 1) {
      const dayOfWeek = daysByColumn.get(colIndex);
      if (!dayOfWeek) continue;
      const cell = row.getCell(colIndex);
      if (!hasVisibleContent(cell)) continue;
      const rawText = cellText(cell);
      const colorHex = fillHex(cell);
      const ownerType = isPurpleFerreira(colorHex) ? "FERREIRA_WINDOW" : isNameLikeCell(rawText) ? "EXTERNAL_IMPORTED" : null;
      if (!ownerType) continue;
      const localLabel = rowLocalLabel(worksheet, rowIndex);
      const timeLabel = nearestTimeLabel(worksheet, rowIndex, colIndex);
      const startHour = inferStartHourFromText(`${timeLabel} ${rawText}`.trim(), rowIndex);
      const candidate = {
        rowIndex,
        colIndex,
        rowLabel: localLabel,
        colLabel: cellText(worksheet.getRow(2).getCell(colIndex)) || null,
        localName: normalizeLocal(localLabel),
        timeLabel: timeLabel || null,
        dayOfWeek,
        shift: inferShiftFromStartHour(startHour),
        startHour,
        dateLabel: cellText(worksheet.getRow(1).getCell(colIndex)) || null,
        text: rawText,
        colorHex,
        ownerType,
        confidence: ownerType === "FERREIRA_WINDOW" ? 0.98 : 0.9
      } satisfies ImportCellCandidate;
      candidates.push(candidate);
      ownerByPosition.set(`${rowIndex}:${colIndex}`, ownerType);
    }
  }

  return { cells: candidates, layout: buildLayout(worksheet, maxRow, maxCol, ownerByPosition) };
}

export async function parseScheduleFile(fileName: string, buffer: Buffer): Promise<ParsedScheduleFile> {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".xlsx")) {
    throw new Error("Para manter a formatação fiel, envie XLSX.");
  }
  return parseXlsxSchedule(buffer);
}

export function alignParsedScheduleToWeek(parsed: ParsedScheduleFile, weekStart: Date): ParsedScheduleFile {
  const dayByColumn = new Map<number, string>();
  for (const cell of parsed.layout.cells) {
    if (cell.rowIndex !== 2) continue;
    const dayOfWeek = dayMap.get(normalize(cell.text));
    if (dayOfWeek) dayByColumn.set(cell.colIndex, dayOfWeek);
  }

  for (const cell of parsed.layout.cells) {
    if (cell.rowIndex !== 1) continue;
    const dateLabel = formatWeekDate(weekStart, dayByColumn.get(cell.colIndex));
    if (dateLabel) cell.text = dateLabel;
  }

  for (const cell of parsed.cells) {
    const dateLabel = formatWeekDate(weekStart, cell.dayOfWeek);
    if (dateLabel) cell.dateLabel = dateLabel;
  }

  return parsed;
}
