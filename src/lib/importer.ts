import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
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

const PURPLE = { r: 180, g: 167, b: 214 };

function distance(hex: string) {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return Math.sqrt((r - PURPLE.r) ** 2 + (g - PURPLE.g) ** 2 + (b - PURPLE.b) ** 2);
}

function argbToHex(argb?: string) {
  if (!argb) return null;
  const value = argb.length === 8 ? argb.slice(2) : argb;
  if (value.length !== 6) return null;
  return `#${value.toUpperCase()}`;
}

function ownerType(colorHex: string | null, text: string): ImportCellCandidate["ownerType"] | null {
  const hasText = Boolean(text.trim());
  if (!colorHex) return hasText ? "EXTERNAL_IMPORTED" : null;
  if (distance(colorHex) <= 45) return "FERREIRA_WINDOW";
  return hasText ? "EXTERNAL_IMPORTED" : null;
}

function inferDayFromColumn(index: number) {
  const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  return days[(index - 1) % 7] ?? null;
}

function inferShiftFromText(text: string | null, rowIndex: number) {
  const value = (text ?? "").toLowerCase();
  if (value.includes("8h") || value.includes("9h")) return "MORNING";
  if (value.includes("12h") || value.includes("13h") || value.includes("14h")) return "AFTERNOON";
  if (value.includes("16h") || value.includes("17h")) return "NIGHT";
  if (rowIndex < 15) return "MORNING";
  if (rowIndex < 35) return "AFTERNOON";
  return "NIGHT";
}

export function inferStartHourFromText(text: string | null, rowIndex = 0) {
  const value = (text ?? "").toLowerCase();
  if (value.includes("plantao noturno") || value.includes("plantão noturno")) return 20;
  const match = value.match(/(?:^|[^\d])([01]?\d|2[0-3])\s*h/);
  if (match) return Number(match[1]);
  const shift = inferShiftFromText(text, rowIndex);
  if (shift === "MORNING") return 8;
  if (shift === "AFTERNOON") return 12;
  return 20;
}

function normalizeLocal(label: string | null) {
  const value = (label ?? "").toUpperCase();
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

function isUsefulExternalText(text: string, rowIndex: number, colIndex: number) {
  const value = text.trim();
  if (!value) return false;
  if (rowIndex <= 2 || colIndex <= 2) return false;
  const upper = value.toUpperCase();
  if (["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM", "M", "T", "N"].includes(upper)) return false;
  if (upper.includes("PLANTAO") || upper.includes("HORARIO") || upper.includes("CORRETOR")) return false;
  return true;
}

export async function parseXlsxSchedule(buffer: Buffer): Promise<ImportCellCandidate[]> {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  const candidates: ImportCellCandidate[] = [];

  worksheet.eachRow((row, rowIndex) => {
    let rowLabel = "";
    row.eachCell({ includeEmpty: true }, (cell, colIndex) => {
      const rawText = String(cell.value ?? "").trim();
      if (colIndex <= 2 && rawText) rowLabel = rawText;
      const fill = cell.fill;
      const colorHex = fill?.type === "pattern" ? argbToHex(fill.fgColor?.argb) : null;
      const type = ownerType(colorHex, rawText);
      if (!type) return;
      if (type === "EXTERNAL_IMPORTED" && !isUsefulExternalText(rawText, rowIndex, colIndex)) return;
      const localName = normalizeLocal(rowLabel);
      const shift = inferShiftFromText(rowLabel || rawText, rowIndex);
      const startHour = inferStartHourFromText(`${rowLabel} ${rawText}`.trim(), rowIndex);
      candidates.push({
        rowIndex,
        colIndex,
        rowLabel,
        colLabel: worksheet.getRow(2).getCell(colIndex).text || worksheet.getRow(1).getCell(colIndex).text || null,
        localName,
        timeLabel: rowLabel || null,
        dayOfWeek: inferDayFromColumn(colIndex),
        shift,
        startHour,
        dateLabel: worksheet.getRow(1).getCell(colIndex).text || null,
        text: rawText,
        colorHex,
        ownerType: type,
        confidence: type === "FERREIRA_WINDOW" ? 0.92 : 0.82
      });
    });
  });

  return candidates;
}

export async function parsePdfSchedule(buffer: Buffer, fileName: string): Promise<ImportCellCandidate[]> {
  const dir = await mkdtemp(join(tmpdir(), "escala-md-"));
  const pdfPath = join(dir, fileName.replace(/[^a-zA-Z0-9_.-]/g, "_") || "escala.pdf");
  await writeFile(pdfPath, buffer);
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn("python", [join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "parse-pdf-schedule.py"), pdfPath], {
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `Parser PDF finalizou com codigo ${code}`));
      });
    });
    return JSON.parse(output).cells ?? [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function parseScheduleFile(fileName: string, buffer: Buffer) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return parsePdfSchedule(buffer, fileName);
  if (lower.endsWith(".xlsx")) return parseXlsxSchedule(buffer);
  throw new Error("Formato ainda nao suportado. Envie PDF ou XLSX.");
}
