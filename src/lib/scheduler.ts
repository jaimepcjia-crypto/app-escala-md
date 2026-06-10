import type { Broker, DutyType, HistoryTotal, ImportedScheduleCell, Unavailability, WeeklyWindow } from "@prisma/client";
import { isWeekend, labelsFor, type DayOfWeek, type Shift } from "@/lib/constants";
import type { EffortLevel } from "@/lib/effort-level";

export type BrokerWithPlanningData = Broker & {
  team: { id: string; name: string };
  historyTotal: HistoryTotal | null;
  effortLevel: string | null;
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
  initialAssignments?: Array<{
    brokerId: string;
    dayOfWeek: DayOfWeek | string;
    startHour: number;
    localName: string;
  }>;
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
  const balancePenalty = (broker.autoHistoryTotal ?? broker.historyTotal?.totalAssignments ?? 0) * (balanceMode === "MORE_BALANCED" ? 14 : 7);
  const dutyPenalty = historyCount(broker, duty) * (balanceMode === "MORE_BALANCED" ? 8 : 4);
  const weekPenalty = sameWeekCount * (balanceMode === "MORE_BALANCED" ? 42 : 18);
  const focusPenalty = deprioritizeBrokerIds.has(broker.id) ? 250 : 0;
  const jitter = hashSeed(`${seed}:${broker.id}`) % 7;
  return -balancePenalty - dutyPenalty - weekPenalty - focusPenalty + jitter;
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

type Candidate = ReturnType<typeof selectCandidates>[number];

function effortCountKey(brokerId: string, localName: string) {
  return `${brokerId}:${localName}`;
}

function prioritizeEffortCandidates(
  candidates: Candidate[],
  localName: string,
  topLocalNames: Set<string>,
  bottomLocalNames: Set<string>,
  localCounts: Map<string, number>,
  bottomCounts: Map<string, number>
) {
  const topTargets: Array<{ level: EffortLevel; target: number }> = [
    { level: "VERY_HIGH", target: 2 },
    { level: "HIGH", target: 1 }
  ];
  if (topLocalNames.has(localName)) {
    for (const rule of topTargets) {
      const preferred = candidates.filter((candidate) =>
        candidate.broker.effortLevel === rule.level &&
        (localCounts.get(effortCountKey(candidate.broker.id, localName)) ?? 0) < rule.target
      );
      if (preferred.length) return preferred;
    }
  }

  const bottomTargets: Array<{ level: EffortLevel; target: number }> = [
    { level: "LOW", target: 3 },
    { level: "MEDIUM", target: 2 }
  ];
  if (bottomLocalNames.has(localName)) {
    for (const rule of bottomTargets) {
      const preferred = candidates.filter((candidate) =>
        candidate.broker.effortLevel === rule.level &&
        (bottomCounts.get(candidate.broker.id) ?? 0) < rule.target
      );
      if (preferred.length) return preferred;
    }
  }
  return candidates;
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
  const effortLocalCounts = new Map<string, number>();
  const effortBottomCounts = new Map<string, number>();
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
  const bestLocalNames = new Set(topLocalNames.slice(0, 2));
  const worstLocalNames = new Set(topLocalNames.slice(-2));

  function recordAssignment(brokerId: string, localName: string) {
    effortLocalCounts.set(effortCountKey(brokerId, localName), (effortLocalCounts.get(effortCountKey(brokerId, localName)) ?? 0) + 1);
    if (worstLocalNames.has(localName)) effortBottomCounts.set(brokerId, (effortBottomCounts.get(brokerId) ?? 0) + 1);
  }

  for (const assignment of input.initialAssignments ?? []) {
    weekCounts.set(assignment.brokerId, (weekCounts.get(assignment.brokerId) ?? 0) + 1);
    recordAssignment(assignment.brokerId, assignment.localName);
  }

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
      const localName = localNameForWindow(window, duty);

      if (duty.isCalling && isWeekend(dayOfWeek) && window.quantity - slot + 1 >= 2) {
        const allCallingCandidates = selectCandidates(input.brokers, duty, dayOfWeek, startHour, dateKey, unavailableRanges, assignedAtTime, weekCounts, seed, balanceMode, deprioritizeBrokerIds);
        const preferredCallingCandidates = prioritizeEffortCandidates(
          allCallingCandidates,
          localName,
          bestLocalNames,
          worstLocalNames,
          effortLocalCounts,
          effortBottomCounts
        );
        const pairFor = (candidates: Candidate[]) => {
          const teams = new Map<string, BrokerWithPlanningData[]>();
          for (const candidate of candidates) {
            const rows = teams.get(candidate.broker.teamId) ?? [];
            rows.push(candidate.broker);
            teams.set(candidate.broker.teamId, rows);
          }
          return [...teams.values()]
            .filter((items) => items.length >= 2)
            .map((items) => items.slice(0, 2))
            .sort((left, right) => {
              const leftValue = left.reduce((sum, broker) => sum + candidateValue(broker, duty, weekCounts.get(broker.id) ?? 0, seed, balanceMode, deprioritizeBrokerIds), 0);
              const rightValue = right.reduce((sum, broker) => sum + candidateValue(broker, duty, weekCounts.get(broker.id) ?? 0, seed, balanceMode, deprioritizeBrokerIds), 0);
              return rightValue - leftValue;
            })[0];
        };
        const pair = pairFor(preferredCallingCandidates) ?? pairFor(allCallingCandidates);

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
            recordAssignment(broker.id, localName);
            slot += 1;
          }
          continue;
        }
      }

      const candidates = prioritizeEffortCandidates(
        selectCandidates(input.brokers, duty, dayOfWeek, startHour, dateKey, unavailableRanges, assignedAtTime, weekCounts, seed, balanceMode, deprioritizeBrokerIds),
        localName,
        bestLocalNames,
        worstLocalNames,
        effortLocalCounts,
        effortBottomCounts
      );
      const selected = candidates[0];
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
        recordAssignment(selected.broker.id, localName);
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
