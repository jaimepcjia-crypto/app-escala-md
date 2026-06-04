import { prisma } from "@/lib/prisma";
import { ensureSeedData } from "@/lib/seed";
import { formatWeekStart, normalizeWeekStart, type DayOfWeek, type Shift } from "@/lib/constants";
import { addDays, dateForWeekDay, dateOnly, dayOfWeekForDate, generationWindowStatus, parseDateOnly } from "@/lib/deadlines";

export function salesMonthStartForWeek(weekStart: Date) {
  return new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), 1));
}

function centsToReais(cents: bigint | number | null | undefined) {
  const value = BigInt(cents ?? 100);
  const zero = BigInt(0);
  const hundred = BigInt(100);
  const sign = value < zero ? "-" : "";
  const absolute = value < zero ? -value : value;
  const reais = absolute / hundred;
  const centavos = absolute % hundred;
  return `${sign}${reais.toString()}.${centavos.toString().padStart(2, "0")}`;
}

function reaisToCents(value: unknown) {
  const raw = String(value ?? "1")
    .replace(/[^\d,.-]/g, "")
    .trim();
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const number = Number.parseFloat(normalized);
  if (!Number.isFinite(number) || number <= 0) return BigInt(100);
  return BigInt(Math.round(number * 100));
}

export { reaisToCents };

async function publishedHistoryCounts() {
  const assignments = await prisma.scheduleAssignment.findMany({
    where: {
      brokerId: { not: null },
      isViolation: false,
      assignmentType: { not: "EXTERNAL_IMPORTED" },
      schedule: { status: "PUBLISHED" }
    },
    select: { brokerId: true }
  });
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    if (!assignment.brokerId) continue;
    counts.set(assignment.brokerId, (counts.get(assignment.brokerId) ?? 0) + 1);
  }
  return counts;
}

export function rankingFromBrokers<T extends { id: string; name: string; team: { isFerreira: boolean }; active: boolean }>(
  brokers: T[],
  salesByBroker: Map<string, bigint>,
  historyByBroker: Map<string, number>
) {
  const ranked = brokers
    .filter((broker) => broker.team.isFerreira && broker.active)
    .sort((left, right) => {
      const salesDiff = salesByBroker.get(right.id)! > salesByBroker.get(left.id)! ? 1 : salesByBroker.get(right.id)! < salesByBroker.get(left.id)! ? -1 : 0;
      if (salesDiff !== 0) return salesDiff;
      const historyDiff = (historyByBroker.get(left.id) ?? 0) - (historyByBroker.get(right.id) ?? 0);
      if (historyDiff !== 0) return historyDiff;
      return left.name.localeCompare(right.name);
    });
  return new Map(ranked.map((broker, index) => [broker.id, index + 1]));
}

function localNameForWindow(window: { importedCell?: { localName?: string | null } | null; dutyType: { name: string; priority: number } }) {
  return window.importedCell?.localName || window.dutyType.name;
}

export function buildPlantaoPriorities(
  windows: Array<{ importedCell?: { localName?: string | null } | null; dutyType: { name: string; priority: number } }>,
  priorityRows: Array<{ localName: string; position: number }>
) {
  const rowByName = new Map(priorityRows.map((row) => [row.localName, row.position]));
  const names = [...new Set(windows.map(localNameForWindow))];
  return names
    .map((name) => ({
      localName: name,
      position: rowByName.get(name) ?? 10_000 + (windows.find((window) => localNameForWindow(window) === name)?.dutyType.priority ?? 999)
    }))
    .sort((left, right) => left.position - right.position || left.localName.localeCompare(right.localName));
}

export async function getAdminSnapshot(weekStartInput?: string) {
  await ensureSeedData();
  const weekStart = normalizeWeekStart(weekStartInput);
  const monthStart = salesMonthStartForWeek(weekStart);

  const [teams, rawBrokers, dutyTypes, windows, schedules, imports, confirmations, salesRows, priorityRows, historyByBroker] = await Promise.all([
    prisma.team.findMany({ orderBy: { name: "asc" } }),
    prisma.broker.findMany({ include: { team: true, historyTotal: true, user: true }, orderBy: { name: "asc" } }),
    prisma.dutyType.findMany({ orderBy: { priority: "asc" } }),
    prisma.weeklyWindow.findMany({ where: { weekStart }, include: { dutyType: true, importedCell: true }, orderBy: [{ dayOfWeek: "asc" }, { shift: "asc" }] }),
    prisma.schedule.findMany({
      where: { weekStart },
      include: {
        assignments: { include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true } },
        aiReview: true
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.scheduleImport.findMany({ where: { weekStart }, include: { cells: true }, orderBy: { createdAt: "desc" } }),
    prisma.unavailabilityConfirmation.findMany({ where: { weekStart }, include: { broker: true } }),
    prisma.brokerMonthlySale.findMany({ where: { monthStart } }),
    prisma.dutyPriority.findMany(),
    publishedHistoryCounts()
  ]);

  const salesByBroker = new Map(rawBrokers.map((broker) => [broker.id, BigInt(100)]));
  for (const sale of salesRows) salesByBroker.set(sale.brokerId, sale.amountCents);
  const rankByBroker = rankingFromBrokers(rawBrokers, salesByBroker, historyByBroker);
  const brokers = rawBrokers
    .map((broker) => {
      const amountCents = salesByBroker.get(broker.id) ?? BigInt(100);
      return {
        ...broker,
        salesAmountCents: amountCents.toString(),
        salesAmountReais: centsToReais(amountCents),
        salesRank: rankByBroker.get(broker.id) ?? null,
        autoHistoryTotal: historyByBroker.get(broker.id) ?? 0
      };
    })
    .sort((left, right) => (left.salesRank ?? 9999) - (right.salesRank ?? 9999) || left.name.localeCompare(right.name));
  const ferreiraBrokers = brokers.filter((broker) => broker.team.isFerreira && broker.active);
  const confirmedBrokerIds = new Set(confirmations.map((item) => item.brokerId));
  const plantaoPriorities = buildPlantaoPriorities(windows, priorityRows);

  return {
    weekStart: formatWeekStart(weekStart),
    salesMonthStart: formatWeekStart(monthStart),
    teams,
    brokers,
    dutyTypes,
    windows,
    schedules,
    imports,
    confirmations,
    weights: [],
    plantaoPriorities,
    readiness: {
      totalFerreiraBrokers: ferreiraBrokers.length,
      confirmed: ferreiraBrokers.filter((broker) => confirmedBrokerIds.has(broker.id)).length,
      allConfirmed: ferreiraBrokers.length > 0 && ferreiraBrokers.every((broker) => confirmedBrokerIds.has(broker.id))
    },
    generationGate: generationWindowStatus(weekStart)
  };
}

export async function getPublishedSchedule(weekStartInput?: string, options: { ferreiraOnly?: boolean } = {}) {
  await ensureSeedData();
  const weekStart = normalizeWeekStart(weekStartInput);
  const monthStart = salesMonthStartForWeek(weekStart);
  const schedule = await prisma.schedule.findFirst({
    where: { weekStart, status: "PUBLISHED" },
    include: {
      assignments: {
        where: options.ferreiraOnly ? { assignmentType: { not: "EXTERNAL_IMPORTED" } } : undefined,
        include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true },
        orderBy: [{ dayOfWeek: "asc" }, { shift: "asc" }, { slot: "asc" }]
      },
      aiReview: true
    },
    orderBy: { publishedAt: "desc" }
  });
  const [rawBrokers, salesRows, historyByBroker] = await Promise.all([
    prisma.broker.findMany({ where: { active: true }, include: { team: true }, orderBy: { name: "asc" } }),
    prisma.brokerMonthlySale.findMany({ where: { monthStart } }),
    publishedHistoryCounts()
  ]);
  const salesByBroker = new Map(rawBrokers.map((broker) => [broker.id, BigInt(100)]));
  for (const sale of salesRows) salesByBroker.set(sale.brokerId, sale.amountCents);
  const rankByBroker = rankingFromBrokers(rawBrokers, salesByBroker, historyByBroker);
  const brokers = rawBrokers.map((broker) => ({ ...broker, salesRank: rankByBroker.get(broker.id) ?? null }));
  return { weekStart: formatWeekStart(weekStart), salesMonthStart: formatWeekStart(monthStart), schedule, brokers };
}

export async function listPlanningData(weekStart: Date) {
  await ensureSeedData();
  const monthStart = salesMonthStartForWeek(weekStart);
  const [rawBrokers, dutyTypes, windows, unavailabilities, salesRows, priorityRows, historyByBroker] = await Promise.all([
    prisma.broker.findMany({ where: { active: true, team: { isFerreira: true } }, include: { team: true, historyTotal: true } }),
    prisma.dutyType.findMany({ orderBy: { priority: "asc" } }),
    prisma.weeklyWindow.findMany({ where: { weekStart, quantity: { gt: 0 }, importCellId: { not: null } }, include: { importedCell: true } }),
    prisma.unavailability.findMany({ where: { date: { gte: weekStart, lte: addDays(weekStart, 6) } } }),
    prisma.brokerMonthlySale.findMany({ where: { monthStart } }),
    prisma.dutyPriority.findMany(),
    publishedHistoryCounts()
  ]);
  const salesByBroker = new Map(rawBrokers.map((broker) => [broker.id, BigInt(100)]));
  for (const sale of salesRows) salesByBroker.set(sale.brokerId, sale.amountCents);
  const rankByBroker = rankingFromBrokers(rawBrokers, salesByBroker, historyByBroker);
  const brokers = rawBrokers
    .map((broker) => ({
      ...broker,
      salesAmountCents: salesByBroker.get(broker.id) ?? BigInt(100),
      salesRank: rankByBroker.get(broker.id) ?? 9999,
      autoHistoryTotal: historyByBroker.get(broker.id) ?? 0
    }))
    .sort((left, right) => left.salesRank - right.salesRank || left.name.localeCompare(right.name));
  const priorityByLocalName = new Map(buildPlantaoPriorities(windows.map((window) => ({ ...window, dutyType: dutyTypes.find((duty) => duty.id === window.dutyTypeId) ?? { name: "PLANTAO", priority: 999 } })), priorityRows).map((item, index) => [item.localName, index + 1]));
  const normalizedUnavailabilities = unavailabilities.map((item) => ({
    ...item,
    weekStart,
    dayOfWeek: dayOfWeekForDate(item.date)
  }));
  return { brokers, dutyTypes, windows, unavailabilities: normalizedUnavailabilities, weights: [], priorityByLocalName };
}

export function parseSlot(value: unknown): { dayOfWeek: DayOfWeek; shift: Shift } | null {
  if (!value || typeof value !== "object") return null;
  const slot = value as { dayOfWeek?: DayOfWeek; shift?: Shift };
  if (!slot.dayOfWeek || !slot.shift) return null;
  return { dayOfWeek: slot.dayOfWeek, shift: slot.shift };
}

export function parseDateSlot(value: unknown): { date: Date; shift: Shift } | null {
  if (!value || typeof value !== "object") return null;
  const slot = value as { date?: string; shift?: Shift };
  if (!slot.date || !slot.shift) return null;
  return { date: parseDateOnly(slot.date), shift: slot.shift };
}

export function legacySlotToDate(weekStart: Date, dayOfWeek: DayOfWeek | string) {
  return dateForWeekDay(weekStart, dayOfWeek);
}

export function dateToDayKey(date: Date) {
  return dateOnly(date);
}
