import { prisma } from "@/lib/prisma";
import { addDays, dateOnly, parseDateOnly } from "@/lib/deadlines";

export type HistoricalAssignmentFilters = {
  brokerName?: string | null;
  localName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

type HistoricalAssignmentRow = {
  schedule: { weekStart: Date };
  dayOfWeek: string;
  assignmentType: string;
  broker: { name: string } | null;
  dutyType: { name: string };
  importedCell: { localName: string | null } | null;
};

const dayOffset: Record<string, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6
};

function normalize(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function localName(row: HistoricalAssignmentRow) {
  return row.importedCell?.localName || row.dutyType.name;
}

function resolveUniqueName(wanted: string | null | undefined, available: string[], label: string) {
  if (!wanted) return { value: null, error: null };
  const normalizedWanted = normalize(wanted);
  const exact = available.filter((item) => normalize(item) === normalizedWanted);
  if (exact.length === 1) return { value: exact[0], error: null };
  const partial = available.filter((item) => normalize(item).includes(normalizedWanted) || normalizedWanted.includes(normalize(item)));
  if (partial.length === 1) return { value: partial[0], error: null };
  if (!exact.length && !partial.length) return { value: null, error: `${label} "${wanted}" não encontrado no histórico publicado.` };
  return { value: null, error: `${label} "${wanted}" é ambíguo. Encontrei: ${[...new Set([...exact, ...partial])].join(", ")}.` };
}

export function isHistoricalAssignmentQuestion(command: string) {
  const normalized = normalize(command);
  return /\b(quantos?|quantidade|historico|histórico|vezes|total|compare|comparar)\b/.test(normalized)
    && /\b(plantao|plantoes|escala|escalas)\b/.test(normalized);
}

export function summarizeHistoricalAssignments(rows: HistoricalAssignmentRow[], filters: HistoricalAssignmentFilters) {
  const brokers = [...new Set(rows.map((row) => row.broker?.name).filter((name): name is string => Boolean(name)))].sort();
  const locals = [...new Set(rows.map(localName))].sort();
  const broker = resolveUniqueName(filters.brokerName, brokers, "Corretor");
  if (broker.error) return { state: "BLOCKED" as const, message: `IA: ${broker.error}` };
  const local = resolveUniqueName(filters.localName, locals, "Plantão");
  if (local.error) return { state: "BLOCKED" as const, message: `IA: ${local.error}` };

  const startDate = filters.startDate ? parseDateOnly(filters.startDate) : null;
  const endDate = filters.endDate ? parseDateOnly(filters.endDate) : null;
  if (startDate && endDate && startDate > endDate) {
    return { state: "BLOCKED" as const, message: "IA: o início do período informado é posterior ao fim." };
  }

  const matches = rows.filter((row) => {
    if (row.assignmentType === "EXTERNAL_IMPORTED" || !row.broker) return false;
    if (broker.value && row.broker.name !== broker.value) return false;
    if (local.value && localName(row) !== local.value) return false;
    const dutyDate = addDays(row.schedule.weekStart, dayOffset[row.dayOfWeek] ?? 0);
    if (startDate && dutyDate < startDate) return false;
    if (endDate && dutyDate > endDate) return false;
    return true;
  });

  const historicalDates = rows
    .filter((row) => row.assignmentType !== "EXTERNAL_IMPORTED" && row.broker)
    .map((row) => addDays(row.schedule.weekStart, dayOffset[row.dayOfWeek] ?? 0))
    .sort((left, right) => left.getTime() - right.getTime());
  const availableStart = historicalDates[0] ? dateOnly(historicalDates[0]) : null;
  const availableEnd = historicalDates.at(-1) ? dateOnly(historicalDates.at(-1)!) : null;
  const periodStart = filters.startDate ?? availableStart;
  const periodEnd = filters.endDate ?? availableEnd;
  const subject = [broker.value ? `de ${broker.value}` : null, local.value ? `no plantão ${local.value}` : null].filter(Boolean).join(" ");
  const period = periodStart && periodEnd ? ` entre ${periodStart} e ${periodEnd}` : "";

  const byLocal = new Map<string, number>();
  const byBroker = new Map<string, number>();
  for (const row of matches) {
    byLocal.set(localName(row), (byLocal.get(localName(row)) ?? 0) + 1);
    byBroker.set(row.broker!.name, (byBroker.get(row.broker!.name) ?? 0) + 1);
  }
  const top = (map: Map<string, number>) => [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 5);
  const details = broker.value && !local.value
    ? top(byLocal).map(([name, count]) => `${name}: ${count}`).join("; ")
    : !broker.value && local.value
      ? top(byBroker).map(([name, count]) => `${name}: ${count}`).join("; ")
      : "";

  return {
    state: "ANSWERED" as const,
    message: `IA: encontrei ${matches.length} ${matches.length === 1 ? "plantão" : "plantões"} ${subject || "no histórico publicado"}${period}.${details ? `\nDetalhamento: ${details}.` : ""}${availableStart ? `\nHistórico disponível no app: ${availableStart} a ${availableEnd}.` : "\nAinda não há plantões publicados no histórico."}`,
    data: {
      count: matches.length,
      brokerName: broker.value,
      localName: local.value,
      startDate: periodStart,
      endDate: periodEnd,
      availableStart,
      availableEnd,
      byLocal: Object.fromEntries(byLocal),
      byBroker: Object.fromEntries(byBroker)
    }
  };
}

export async function queryHistoricalAssignments(filters: HistoricalAssignmentFilters) {
  const rows = await prisma.scheduleAssignment.findMany({
    where: { schedule: { status: "PUBLISHED" } },
    select: {
      dayOfWeek: true,
      assignmentType: true,
      schedule: { select: { weekStart: true } },
      broker: { select: { name: true } },
      dutyType: { select: { name: true } },
      importedCell: { select: { localName: true } }
    }
  });
  return summarizeHistoricalAssignments(rows, filters);
}
