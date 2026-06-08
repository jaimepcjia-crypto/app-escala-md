import type { Broker, DutyType, HistoryTotal, ImportedScheduleCell, Unavailability, WeeklyWindow } from "@prisma/client";
import { isWeekend, labelsFor, type DayOfWeek, type Shift } from "@/lib/constants";

export type BrokerWithPlanningData = Broker & {
  team: { id: string; name: string };
  historyTotal: HistoryTotal | null;
  salesRank?: number;
  salesAmountCents?: bigint;
  salesTieSize?: number;
  salesOrdinalStart?: number | null;
  salesOrdinalEnd?: number | null;
  autoHistoryTotal?: number;
};

export type GeneratedAssignment = {
  brokerId: string | null;
  dutyTypeId: string;
  dayOfWeek: DayOfWeek;
  shift: Shift;
  startHour: number | null;
  slot: number;
  assignmentType: "FERREIRA_AI";
  importedCellId?: string | null;
  sourceText?: string | null;
  sourceColorHex?: string | null;
  isViolation: boolean;
  violationReason?: string;
};

export type SchedulingConflict = {
  dutyType: string;
  dayOfWeek: DayOfWeek;
  shift: Shift;
  reason: string;
  suggestions: string[];
};

type EngineInput = {
  brokers: BrokerWithPlanningData[];
  dutyTypes: DutyType[];
  windows: Array<WeeklyWindow & { importedCell?: ImportedScheduleCell | null }>;
  unavailabilities: Unavailability[];
  priorityByLocalName?: Map<string, number>;
  weekStart: Date;
  balanceMode?: "NORMAL" | "MORE_BALANCED";
  deprioritizeBrokerIds?: string[];
};

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function fallbackStartHour(shift: Shift | string) {
  if (shift === "MORNING") return 8;
  if (shift === "AFTERNOON") return 12;
  return 20;
}

function windowStartHour(window: WeeklyWindow & { importedCell?: ImportedScheduleCell | null }) {
  return window.startHour ?? window.importedCell?.startHour ?? fallbackStartHour(window.shift);
}

function isUnavailableAtStart(
  brokerId: string,
  dateKey: string,
  startHour: number,
  unavailableRanges: Map<string, Array<{ startHour: number; endHour: number }>>
) {
  const ranges = unavailableRanges.get(`${brokerId}:${dateKey}`) ?? [];
  return ranges.some((range) => startHour >= range.startHour && startHour < range.endHour);
}

function assignmentKey(brokerId: string, dayOfWeek: DayOfWeek | string, startHour: number) {
  return `${brokerId}:${dayOfWeek}:${startHour}`;
}

function historyCount(broker: BrokerWithPlanningData, duty: DutyType) {
  const history = broker.historyTotal;
  if (!history) return 0;
  if (duty.isCalling) return history.callingAssignments;
  if (duty.requiresExternal) return history.externalAssignments;
  if (duty.headquartersSlot === 1) return history.headquartersPositionOne;
  if (duty.headquartersSlot === 2) return history.headquartersPositionTwo;
  return history.totalAssignments;
}

function isEligible(broker: BrokerWithPlanningData, duty: DutyType) {
  if (!broker.active) return false;
  if (duty.requiresExternal && !broker.canExternalDuty) return false;
  return true;
}

function candidateValue(
  broker: BrokerWithPlanningData,
  duty: DutyType,
  sameWeekCount: number,
  seed: string,
  balanceMode: "NORMAL" | "MORE_BALANCED" = "NORMAL",
  deprioritizeBrokerIds: Set<string> = new Set()
) {
  const rankBonus = (1000 - (broker.salesRank ?? 999)) * 100;
  const balancePenalty = (broker.autoHistoryTotal ?? broker.historyTotal?.totalAssignments ?? 0) * (balanceMode === "MORE_BALANCED" ? 14 : 7);
  const dutyPenalty = historyCount(broker, duty) * (balanceMode === "MORE_BALANCED" ? 8 : 4);
  const weekPenalty = sameWeekCount * (balanceMode === "MORE_BALANCED" ? 42 : 18);
  const focusPenalty = deprioritizeBrokerIds.has(broker.id) ? 250 : 0;
  const jitter = hashSeed(`${seed}:${broker.id}`) % 7;
  return rankBonus - balancePenalty - dutyPenalty - weekPenalty - focusPenalty + jitter;
}

function brokerSalesAmount(broker: BrokerWithPlanningData) {
  return broker.salesAmountCents ?? BigInt(100);
}

function buildSalesGroups(brokers: BrokerWithPlanningData[]) {
  const active = brokers.filter((broker) => broker.active);
  const amounts = [...new Set(active.map((broker) => brokerSalesAmount(broker).toString()))]
    .map(BigInt)
    .sort((left, right) => (right > left ? 1 : right < left ? -1 : 0));
  const groups: Array<{ amount: bigint; start: number; end: number; brokerIds: Set<string> }> = [];
  let start = 1;
  for (const amount of amounts) {
    const brokerIds = new Set(active.filter((broker) => brokerSalesAmount(broker) === amount).map((broker) => broker.id));
    const end = start + brokerIds.size - 1;
    groups.push({ amount, start, end, brokerIds });
    start = end + 1;
  }
  return groups;
}

function brokerIdsForOrdinalRange(groups: ReturnType<typeof buildSalesGroups>, start: number, end: number) {
  const ids = new Set<string>();
  for (const group of groups) {
    if (group.start <= end && group.end >= start) {
      for (const brokerId of group.brokerIds) ids.add(brokerId);
    }
  }
  return ids;
}

function brokerIdsForOrdinal(groups: ReturnType<typeof buildSalesGroups>, ordinal: number) {
  const group = groups.find((item) => item.start <= ordinal && item.end >= ordinal);
  return new Set(group?.brokerIds ?? []);
}

function localNameForWindow(window: WeeklyWindow & { importedCell?: ImportedScheduleCell | null }, duty?: DutyType) {
  return window.importedCell?.localName || duty?.name || "PLANTAO";
}

function windowPriority(window: WeeklyWindow & { importedCell?: ImportedScheduleCell | null }, duty: DutyType | undefined, priorities?: Map<string, number>) {
  return priorities?.get(localNameForWindow(window, duty)) ?? duty?.priority ?? 999;
}

function selectCandidates(
  brokers: BrokerWithPlanningData[],
  duty: DutyType,
  dayOfWeek: DayOfWeek,
  startHour: number,
  dateKey: string,
  unavailableRanges: Map<string, Array<{ startHour: number; endHour: number }>>,
  assignedAtTime: Set<string>,
  weekCounts: Map<string, number>,
  seed: string,
  balanceMode: "NORMAL" | "MORE_BALANCED",
  deprioritizeBrokerIds: Set<string>
) {
  return brokers
    .filter((broker) => isEligible(broker, duty))
    .filter((broker) => !isUnavailableAtStart(broker.id, dateKey, startHour, unavailableRanges))
    .filter((broker) => !assignedAtTime.has(assignmentKey(broker.id, dayOfWeek, startHour)))
    .map((broker) => ({
      broker,
      value: candidateValue(broker, duty, weekCounts.get(broker.id) ?? 0, seed, balanceMode, deprioritizeBrokerIds)
    }))
    .sort((left, right) => right.value - left.value);
}

function bestExtraordinarySuggestions(
  brokers: BrokerWithPlanningData[],
  duty: DutyType,
  dayOfWeek: DayOfWeek,
  startHour: number,
  dateKey: string,
  unavailableRanges: Map<string, Array<{ startHour: number; endHour: number }>>,
  seed: string,
  balanceMode: "NORMAL" | "MORE_BALANCED",
  deprioritizeBrokerIds: Set<string>
) {
  return brokers
    .filter((broker) => isEligible(broker, duty))
    .filter((broker) => !isUnavailableAtStart(broker.id, dateKey, startHour, unavailableRanges))
    .map((broker) => ({ broker, value: candidateValue(broker, duty, 0, seed, balanceMode, deprioritizeBrokerIds) }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map((item) => item.broker.name);
}

export function generateSchedule(input: EngineInput) {
  const dutyById = new Map(input.dutyTypes.map((duty) => [duty.id, duty]));
  const unavailableRanges = new Map<string, Array<{ startHour: number; endHour: number }>>();
  for (const item of input.unavailabilities) {
    if (item.startHour === null || item.startHour === undefined || item.endHour === null || item.endHour === undefined) continue;
    const key = `${item.brokerId}:${item.date.toISOString().slice(0, 10)}`;
    const rows = unavailableRanges.get(key) ?? [];
    rows.push({ startHour: item.startHour, endHour: item.endHour });
    unavailableRanges.set(key, rows);
  }
  const assignments: GeneratedAssignment[] = [];
  const conflicts: SchedulingConflict[] = [];
  const assignedAtTime = new Set<string>();
  const weekCounts = new Map<string, number>();
  const balanceMode = input.balanceMode ?? "NORMAL";
  const deprioritizeBrokerIds = new Set(input.deprioritizeBrokerIds ?? []);

  const sortedWindows = input.windows
    .filter((window) => window.quantity > 0)
    .sort((left, right) => {
      const leftDuty = dutyById.get(left.dutyTypeId);
      const rightDuty = dutyById.get(right.dutyTypeId);
      return windowPriority(left, leftDuty, input.priorityByLocalName) - windowPriority(right, rightDuty, input.priorityByLocalName);
    });

  const windowsByLocal = new Map<string, typeof sortedWindows>();
  for (const window of sortedWindows) {
    const duty = dutyById.get(window.dutyTypeId);
    const key = localNameForWindow(window, duty);
    const rows = windowsByLocal.get(key) ?? [];
    rows.push(window);
    windowsByLocal.set(key, rows);
  }
  const topLocalNames = [...windowsByLocal.keys()].sort((left, right) => {
    return (input.priorityByLocalName?.get(left) ?? 999) - (input.priorityByLocalName?.get(right) ?? 999);
  });
  const salesGroups = buildSalesGroups(input.brokers);
  const meritocracyActive = salesGroups.length > 1;
  const reservedBrokerIdsBySlot = new Map<string, { allowed: Set<string>; preferred: Set<string> }>();
  topLocalNames.slice(0, 3).forEach((localName, localIndex) => {
    if (!meritocracyActive) return;
    const windows = windowsByLocal.get(localName) ?? [];
    const total = windows.reduce((sum, window) => sum + window.quantity, 0);
    const reservedCount = Math.ceil(total * 0.4);
    const ordinalStart = localIndex * 2 + 1;
    const ordinalEnd = ordinalStart + 1;
    const allowed = brokerIdsForOrdinalRange(salesGroups, ordinalStart, ordinalEnd);
    let marked = 0;
    for (const window of windows) {
      for (let slot = 1; slot <= window.quantity && marked < reservedCount; slot += 1) {
        const preferred = brokerIdsForOrdinal(salesGroups, ordinalStart + (marked % 2));
        reservedBrokerIdsBySlot.set(`${window.id}:${slot}`, { allowed, preferred });
        marked += 1;
      }
      if (marked >= reservedCount) break;
    }
  });

  for (const window of sortedWindows) {
    const duty = dutyById.get(window.dutyTypeId);
    if (!duty) continue;

    let slot = 1;
    while (slot <= window.quantity) {
      const seed = `${input.weekStart.toISOString()}:${duty.id}:${window.dayOfWeek}:${window.shift}:${slot}`;

      const dayOfWeek = window.dayOfWeek as DayOfWeek;
      const shift = window.shift as Shift;
      const startHour = windowStartHour(window);
      const date = new Date(input.weekStart);
      const dayOffset = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].indexOf(dayOfWeek);
      date.setUTCDate(input.weekStart.getUTCDate() + Math.max(0, dayOffset));
      const dateKey = date.toISOString().slice(0, 10);
      const reservedBrokerIds = reservedBrokerIdsBySlot.get(`${window.id}:${slot}`) ?? null;

      if (duty.isCalling && isWeekend(dayOfWeek) && window.quantity - slot + 1 >= 2) {
        const teams = new Map<string, BrokerWithPlanningData[]>();
        for (const candidate of selectCandidates(input.brokers, duty, dayOfWeek, startHour, dateKey, unavailableRanges, assignedAtTime, weekCounts, seed, balanceMode, deprioritizeBrokerIds)) {
          const rows = teams.get(candidate.broker.teamId) ?? [];
          rows.push(candidate.broker);
          teams.set(candidate.broker.teamId, rows);
        }

        const pair = [...teams.values()]
          .filter((items) => items.length >= 2)
          .map((items) => items.slice(0, 2))
          .sort((left, right) => {
            const leftValue = left.reduce((sum, broker) => sum + candidateValue(broker, duty, weekCounts.get(broker.id) ?? 0, seed, balanceMode, deprioritizeBrokerIds), 0);
            const rightValue = right.reduce((sum, broker) => sum + candidateValue(broker, duty, weekCounts.get(broker.id) ?? 0, seed, balanceMode, deprioritizeBrokerIds), 0);
            return rightValue - leftValue;
          })[0];

        if (pair) {
          for (const broker of pair) {
            assignments.push({
              brokerId: broker.id,
              dutyTypeId: duty.id,
              dayOfWeek,
              shift,
              startHour,
              slot,
              assignmentType: "FERREIRA_AI",
              importedCellId: window.importCellId,
              sourceText: window.sourceText,
              sourceColorHex: window.sourceColorHex,
              isViolation: false
            });
            assignedAtTime.add(assignmentKey(broker.id, dayOfWeek, startHour));
            weekCounts.set(broker.id, (weekCounts.get(broker.id) ?? 0) + 1);
            slot += 1;
          }
          continue;
        }
      }

      const candidates = selectCandidates(input.brokers, duty, dayOfWeek, startHour, dateKey, unavailableRanges, assignedAtTime, weekCounts, seed, balanceMode, deprioritizeBrokerIds);
      const selected = reservedBrokerIds
        ? candidates.find((candidate) => reservedBrokerIds.preferred.has(candidate.broker.id)) ??
          candidates.find((candidate) => reservedBrokerIds.allowed.has(candidate.broker.id)) ??
          candidates[0]
        : candidates[0];
      if (selected) {
        assignments.push({
          brokerId: selected.broker.id,
          dutyTypeId: duty.id,
          dayOfWeek,
          shift,
          startHour,
          slot,
          assignmentType: "FERREIRA_AI",
          importedCellId: window.importCellId,
          sourceText: window.sourceText,
          sourceColorHex: window.sourceColorHex,
          isViolation: false
        });
        assignedAtTime.add(assignmentKey(selected.broker.id, dayOfWeek, startHour));
        weekCounts.set(selected.broker.id, (weekCounts.get(selected.broker.id) ?? 0) + 1);
      } else {
        const reason = `Sem corretor disponivel para ${duty.name} em ${labelsFor(dayOfWeek, shift)} as ${String(startHour).padStart(2, "0")}:00.`;
        const suggestions = bestExtraordinarySuggestions(input.brokers, duty, dayOfWeek, startHour, dateKey, unavailableRanges, seed, balanceMode, deprioritizeBrokerIds);
        assignments.push({
          brokerId: null,
          dutyTypeId: duty.id,
          dayOfWeek,
          shift,
          startHour,
          slot,
          assignmentType: "FERREIRA_AI",
          importedCellId: window.importCellId,
          sourceText: window.sourceText,
          sourceColorHex: window.sourceColorHex,
          isViolation: true,
          violationReason: reason
        });
        conflicts.push({ dutyType: duty.name, dayOfWeek, shift, reason, suggestions });
      }
      slot += 1;
    }
  }

  return { assignments, conflicts };
}
