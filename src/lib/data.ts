import { prisma } from "@/lib/prisma";
import { ensureSeedData, managerInitialEmail } from "@/lib/seed";
import { formatWeekStart, normalizeWeekStart, type DayOfWeek, type Shift } from "@/lib/constants";
import { addDays, dateForWeekDay, dateOnly, dayOfWeekForDate, defaultAiScheduleWeek, generationWindowStatus, parseDateOnly, weeklyWorkflowStatus } from "@/lib/deadlines";

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

function centsToBRL(cents: bigint | number | null | undefined) {
  const value = Number(cents ?? 100) / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
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

function currentSaoPauloSalesPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? now.getUTCMonth() + 1);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart);
  return { year, monthStart, yearStart, nextYearStart, monthLabel };
}

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

function ordinalLabel(rank: number, tieSize: number) {
  return tieSize > 1 ? `${rank}o empatado` : `${rank}o`;
}

export function salesRankInfoFromBrokers<T extends { id: string; name: string; team: { isFerreira: boolean }; active: boolean }>(
  brokers: T[],
  salesByBroker: Map<string, bigint>
) {
  const eligible = brokers.filter((broker) => broker.team.isFerreira && broker.active);
  const amounts = [...new Set(eligible.map((broker) => (salesByBroker.get(broker.id) ?? BigInt(100)).toString()))]
    .map(BigInt)
    .sort((left, right) => (right > left ? 1 : right < left ? -1 : 0));
  const amountToRank = new Map(amounts.map((amount, index) => [amount.toString(), index + 1]));
  const groups = new Map<string, T[]>();
  for (const broker of eligible) {
    const amount = (salesByBroker.get(broker.id) ?? BigInt(100)).toString();
    const rows = groups.get(amount) ?? [];
    rows.push(broker);
    groups.set(amount, rows);
  }

  let ordinalStart = 1;
  const result = new Map<string, { rank: number; label: string; tieSize: number; ordinalStart: number; ordinalEnd: number }>();
  for (const amount of amounts) {
    const key = amount.toString();
    const rows = groups.get(key) ?? [];
    const tieSize = rows.length;
    const rank = amountToRank.get(key) ?? 9999;
    const ordinalEnd = ordinalStart + tieSize - 1;
    for (const broker of rows) {
      result.set(broker.id, {
        rank,
        label: ordinalLabel(rank, tieSize),
        tieSize,
        ordinalStart,
        ordinalEnd
      });
    }
    ordinalStart = ordinalEnd + 1;
  }
  return result;
}

export function rankingFromBrokers<T extends { id: string; name: string; team: { isFerreira: boolean }; active: boolean }>(
  brokers: T[],
  salesByBroker: Map<string, bigint>,
  _historyByBroker: Map<string, number>
) {
  const details = salesRankInfoFromBrokers(brokers, salesByBroker);
  return new Map([...details.entries()].map(([brokerId, info]) => [brokerId, info.rank]));
}

function localNameForWindow(window: { importedCell?: { localName?: string | null } | null; dutyType: { name: string; priority: number } }) {
  return window.importedCell?.localName || window.dutyType.name;
}

function buildPlantaoPrioritiesFromNames(names: string[], priorityRows: Array<{ localName: string; position: number }>) {
  const rowByName = new Map(priorityRows.map((row) => [row.localName, row.position]));
  return [...new Set(names.filter((name) => name && name !== "JANELA IMPORTADA"))]
    .map((name, index) => ({
      localName: name,
      position: rowByName.get(name) ?? 10_000 + index
    }))
    .sort((left, right) => left.position - right.position || left.localName.localeCompare(right.localName));
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

export async function getAdminSnapshot(_weekStartInput?: string) {
  await ensureSeedData();
  const workflow = weeklyWorkflowStatus();
  const weekStart = normalizeWeekStart(workflow.weekStartDate);
  const aiWeekStart = defaultAiScheduleWeek();
  const monthStart = salesMonthStartForWeek(weekStart);

  const [teams, rawBrokers, dutyTypes, windows, schedules, imports, confirmations, salesRows, priorityRows, historyByBroker, pendingChangeRequest] = await Promise.all([
    prisma.team.findMany({ orderBy: { name: "asc" } }),
    prisma.broker.findMany({ include: { team: true, historyTotal: true, user: true }, orderBy: { name: "asc" } }),
    prisma.dutyType.findMany({ orderBy: { priority: "asc" } }),
    prisma.weeklyWindow.findMany({ where: { weekStart }, include: { dutyType: true, importedCell: true }, orderBy: [{ dayOfWeek: "asc" }, { shift: "asc" }] }),
    prisma.schedule.findMany({
      where: { weekStart },
      include: {
        import: true,
        assignments: { include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true } },
        aiReview: true
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.scheduleImport.findMany({ where: { weekStart }, include: { cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] } }, orderBy: { createdAt: "desc" } }),
    prisma.unavailabilityConfirmation.findMany({ where: { weekStart }, include: { broker: true } }),
    prisma.brokerMonthlySale.findMany({ where: { monthStart } }),
    prisma.dutyPriority.findMany(),
    publishedHistoryCounts(),
    prisma.aiScheduleChangeRequest.findFirst({ where: { weekStart: aiWeekStart, status: "PENDING" }, orderBy: { createdAt: "desc" } })
  ]);

  const salesByBroker = new Map(rawBrokers.map((broker) => [broker.id, BigInt(100)]));
  for (const sale of salesRows) salesByBroker.set(sale.brokerId, sale.amountCents);
  const rankByBroker = salesRankInfoFromBrokers(rawBrokers, salesByBroker);
  const brokers = rawBrokers
    .map((broker) => {
      const amountCents = salesByBroker.get(broker.id) ?? BigInt(100);
      const rankInfo = rankByBroker.get(broker.id);
      return {
        ...broker,
        salesAmountCents: amountCents.toString(),
        salesAmountReais: centsToReais(amountCents),
        salesRank: rankInfo?.rank ?? null,
        salesRankLabel: rankInfo?.label ?? "-",
        salesTieSize: rankInfo?.tieSize ?? 0,
        salesOrdinalStart: rankInfo?.ordinalStart ?? null,
        salesOrdinalEnd: rankInfo?.ordinalEnd ?? null,
        autoHistoryTotal: historyByBroker.get(broker.id) ?? 0
      };
    })
    .sort((left, right) => (left.salesRank ?? 9999) - (right.salesRank ?? 9999) || left.name.localeCompare(right.name));
  const ferreiraBrokers = brokers.filter((broker) => broker.team.isFerreira && broker.active);
  const confirmedBrokerIds = new Set(confirmations.map((item) => item.brokerId));
  const confirmedImport = imports.find((item) => item.status === "CONFIRMED") ?? imports[0] ?? null;
  const importedLocalNames = confirmedImport?.cells.map((cell) => cell.localName ?? "").filter(Boolean) ?? [];
  const plantaoPriorities = importedLocalNames.length
    ? buildPlantaoPrioritiesFromNames(importedLocalNames, priorityRows)
    : buildPlantaoPriorities(windows, priorityRows);

  return {
    weekStart: formatWeekStart(weekStart),
    salesMonthStart: formatWeekStart(monthStart),
    managerEmail: managerInitialEmail(),
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
    ,
    pendingChangeRequest,
    workflow: {
      isOpen: workflow.isOpen,
      daysUntilOpen: workflow.daysUntilOpen,
      weekStart: workflow.weekStart,
      weekEnd: workflow.weekEnd,
      opensOn: workflow.opensOn,
      closesOn: workflow.closesOn
    }
  };
}

export async function getPublishedSchedule(weekStartInput?: string, options: { ferreiraOnly?: boolean } = {}) {
  await ensureSeedData();
  const weekStart = normalizeWeekStart(weekStartInput);
  const salesPeriod = currentSaoPauloSalesPeriod();
  const schedule = await prisma.schedule.findFirst({
    where: { weekStart, status: "PUBLISHED" },
    include: {
      import: true,
      assignments: {
        where: options.ferreiraOnly ? { assignmentType: { not: "EXTERNAL_IMPORTED" } } : undefined,
        include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true },
        orderBy: [{ dayOfWeek: "asc" }, { shift: "asc" }, { slot: "asc" }]
      },
      aiReview: true,
      changeNotices: { orderBy: { confirmedAt: "asc" } }
    },
    orderBy: { publishedAt: "desc" }
  });
  const [rawBrokers, salesRows] = await Promise.all([
    prisma.broker.findMany({ where: { active: true }, include: { team: true }, orderBy: { name: "asc" } }),
    prisma.brokerMonthlySale.findMany({
      where: {
        monthStart: {
          gte: salesPeriod.yearStart,
          lt: salesPeriod.nextYearStart
        }
      }
    })
  ]);
  const salesByBroker = new Map(rawBrokers.map((broker) => [broker.id, BigInt(100)]));
  const yearSalesByBroker = new Map(rawBrokers.map((broker) => [broker.id, BigInt(0)]));
  const brokersWithCurrentMonthSale = new Set<string>();
  for (const sale of salesRows) {
    yearSalesByBroker.set(sale.brokerId, (yearSalesByBroker.get(sale.brokerId) ?? BigInt(0)) + sale.amountCents);
    if (sale.monthStart.getTime() === salesPeriod.monthStart.getTime()) {
      salesByBroker.set(sale.brokerId, sale.amountCents);
      brokersWithCurrentMonthSale.add(sale.brokerId);
    }
  }
  for (const broker of rawBrokers) {
    if (!brokersWithCurrentMonthSale.has(broker.id)) {
      yearSalesByBroker.set(broker.id, (yearSalesByBroker.get(broker.id) ?? BigInt(0)) + BigInt(100));
    }
  }
  const rankByBroker = salesRankInfoFromBrokers(rawBrokers, salesByBroker);
  const brokers = rawBrokers.map((broker) => {
    const rankInfo = rankByBroker.get(broker.id);
    const monthAmountCents = salesByBroker.get(broker.id) ?? BigInt(100);
    const yearAmountCents = yearSalesByBroker.get(broker.id) ?? BigInt(0);
    return {
      ...broker,
      salesRank: rankInfo?.rank ?? null,
      salesRankLabel: rankInfo?.label ?? "-",
      salesTieSize: rankInfo?.tieSize ?? 0,
      salesOrdinalStart: rankInfo?.ordinalStart ?? null,
      salesOrdinalEnd: rankInfo?.ordinalEnd ?? null,
      currentMonthSalesReais: centsToBRL(monthAmountCents),
      currentYearSalesReais: centsToBRL(yearAmountCents),
      currentMonthSalesCents: monthAmountCents.toString(),
      currentYearSalesCents: yearAmountCents.toString()
    };
  });
  return {
    weekStart: formatWeekStart(weekStart),
    salesMonthStart: formatWeekStart(salesPeriod.monthStart),
    salesMonthLabel: salesPeriod.monthLabel,
    salesYear: salesPeriod.year,
    schedule,
    brokers
  };
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
  const rankByBroker = salesRankInfoFromBrokers(rawBrokers, salesByBroker);
  const brokers = rawBrokers
    .map((broker) => ({
      ...broker,
      salesAmountCents: salesByBroker.get(broker.id) ?? BigInt(100),
      salesRank: rankByBroker.get(broker.id)?.rank ?? 9999,
      salesRankLabel: rankByBroker.get(broker.id)?.label ?? "-",
      salesTieSize: rankByBroker.get(broker.id)?.tieSize ?? 0,
      salesOrdinalStart: rankByBroker.get(broker.id)?.ordinalStart ?? null,
      salesOrdinalEnd: rankByBroker.get(broker.id)?.ordinalEnd ?? null,
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
