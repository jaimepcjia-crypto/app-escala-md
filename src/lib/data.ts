import { prisma } from "@/lib/prisma";
import { ensureSeedData, managerInitialEmail } from "@/lib/seed";
import { formatWeekStart, normalizeWeekStart, type DayOfWeek, type Shift } from "@/lib/constants";
import { addDays, currentSaoPauloWeekStart, dateForWeekDay, dateOnly, dayOfWeekForDate, defaultAiScheduleWeek, generationWindowStatus, parseDateOnly, weeklyWorkflowStatus } from "@/lib/deadlines";
import { availabilityReadiness } from "@/lib/availability-readiness";

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
  const [teams, rawBrokers, dutyTypes, windows, schedules, imports, latestConfirmedImport, confirmations, priorityRows, historyByBroker, pendingChangeRequest] = await Promise.all([
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
    prisma.scheduleImport.findFirst({ where: { status: "CONFIRMED" }, include: { cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] } }, orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }] }),
    prisma.unavailabilityConfirmation.findMany({ where: { weekStart }, include: { broker: true } }),
    prisma.dutyPriority.findMany(),
    publishedHistoryCounts(),
    prisma.aiScheduleChangeRequest.findFirst({ where: { weekStart: aiWeekStart, status: "PENDING" }, orderBy: { createdAt: "desc" } })
  ]);

  const brokers = rawBrokers
    .map((broker) => ({ ...broker, autoHistoryTotal: historyByBroker.get(broker.id) ?? 0 }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const ferreiraBrokers = brokers.filter((broker) => broker.team.isFerreira && broker.active);
  const confirmedBrokerIds = new Set(confirmations.map((item) => item.brokerId));
  const readiness = availabilityReadiness(ferreiraBrokers.map((broker) => broker.id), [...confirmedBrokerIds]);
  const confirmedImport = imports.find((item) => item.status === "CONFIRMED") ?? imports[0] ?? null;
  const importedLocalNames = confirmedImport?.cells.map((cell) => cell.localName ?? "").filter(Boolean) ?? [];
  const rememberedLocalNames = [
    ...priorityRows.sort((left, right) => left.position - right.position).map((row) => row.localName),
    ...(latestConfirmedImport?.cells.map((cell) => cell.localName ?? "").filter(Boolean) ?? [])
  ];
  const plantaoPriorities = importedLocalNames.length
    ? buildPlantaoPrioritiesFromNames(importedLocalNames, priorityRows)
    : rememberedLocalNames.length
      ? buildPlantaoPrioritiesFromNames(rememberedLocalNames, priorityRows)
      : buildPlantaoPriorities(windows, priorityRows);

  return {
    weekStart: formatWeekStart(weekStart),
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
      totalFerreiraBrokers: readiness.total,
      confirmed: readiness.confirmed,
      allConfirmed: readiness.allConfirmed
    },
    generationGate: generationWindowStatus(weekStart)
    ,
    pendingChangeRequest,
    workflow: {
      isOpen: workflow.isOpen,
      daysUntilOpen: workflow.daysUntilOpen,
      currentWeekStart: workflow.currentWeekStart,
      currentWeekEnd: workflow.currentWeekEnd,
      weekStart: workflow.weekStart,
      weekEnd: workflow.weekEnd,
      opensOn: workflow.opensOn,
      closesOn: workflow.closesOn
    }
  };
}

export async function getPublishedSchedule(weekStartInput?: string, options: { ferreiraOnly?: boolean } = {}) {
  await ensureSeedData();
  const weekStart = weekStartInput ? normalizeWeekStart(weekStartInput) : currentSaoPauloWeekStart();
  const schedule = await prisma.schedule.findFirst({
    where: { weekStart, status: "PUBLISHED" },
    include: {
      import: true,
      assignments: {
        where: options.ferreiraOnly ? { assignmentType: { not: "EXTERNAL_IMPORTED" } } : undefined,
        include: {
          broker: { select: { id: true, name: true, team: { select: { name: true, isFerreira: true } } } },
          dutyType: true,
          importedCell: true,
          manualAlerts: true
        },
        orderBy: [{ dayOfWeek: "asc" }, { shift: "asc" }, { slot: "asc" }]
      },
      aiReview: true,
      changeNotices: { orderBy: { confirmedAt: "asc" } }
    },
    orderBy: { publishedAt: "desc" }
  });
  const brokers = await prisma.broker.findMany({
    where: { active: true },
    select: { id: true, name: true, team: { select: { name: true, isFerreira: true } } },
    orderBy: { name: "asc" }
  });
  return {
    weekStart: formatWeekStart(weekStart),
    schedule,
    brokers
  };
}

export async function listPlanningData(weekStart: Date) {
  await ensureSeedData();
  const [rawBrokers, dutyTypes, windows, unavailabilities, priorityRows, historyByBroker] = await Promise.all([
    prisma.broker.findMany({ where: { active: true, team: { isFerreira: true } }, include: { team: true, historyTotal: true } }),
    prisma.dutyType.findMany({ orderBy: { priority: "asc" } }),
    prisma.weeklyWindow.findMany({ where: { weekStart, quantity: { gt: 0 }, importCellId: { not: null } }, include: { importedCell: true } }),
    prisma.unavailability.findMany({ where: { date: { gte: weekStart, lte: addDays(weekStart, 6) } } }),
    prisma.dutyPriority.findMany(),
    publishedHistoryCounts()
  ]);
  const brokers = rawBrokers
    .map((broker) => ({
      ...broker,
      autoHistoryTotal: historyByBroker.get(broker.id) ?? 0
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
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
