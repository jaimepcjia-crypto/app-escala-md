import { DAYS } from "@/lib/constants";

export type AgendaAssignment = {
  id: string;
  dayOfWeek: string;
  shift: string;
  slot: number;
  startHour?: number | null;
  assignmentType?: string;
  sourceText?: string | null;
  isViolation: boolean;
  violationReason?: string | null;
  balanceAlert?: string | null;
  broker?: { id: string; name: string; team?: { name: string } } | null;
  dutyType: { id: string; name: string };
  importedCell?: {
    id: string;
    localName?: string | null;
    timeLabel?: string | null;
    text?: string | null;
  } | null;
  manualAlerts?: { id: string; reason: string }[];
};

export function assignmentLocal(assignment: AgendaAssignment) {
  return assignment.importedCell?.localName || assignment.dutyType.name || "Local não informado";
}

export function assignmentTime(assignment: AgendaAssignment) {
  return assignment.importedCell?.timeLabel || (assignment.startHour !== null && assignment.startHour !== undefined
    ? `${String(assignment.startHour).padStart(2, "0")}:00`
    : assignment.shift || "Horário não informado");
}

export function assignmentName(assignment: AgendaAssignment) {
  if (assignment.assignmentType === "EXTERNAL_IMPORTED") {
    return assignment.sourceText || assignment.importedCell?.text || "Já definido no arquivo";
  }
  return assignment.broker?.name || "Sem cobertura";
}

export function assignmentWarnings(assignment: AgendaAssignment) {
  return [
    assignment.violationReason,
    assignment.balanceAlert,
    ...(assignment.manualAlerts ?? []).map((alert) => alert.reason)
  ].filter((warning): warning is string => Boolean(warning));
}

function timeOrder(assignment: AgendaAssignment) {
  if (assignment.startHour !== null && assignment.startHour !== undefined) return assignment.startHour * 60;
  const value = assignmentTime(assignment).toLowerCase();
  if (value.includes("noturno")) return 20 * 60;
  const match = value.match(/(\d{1,2})\s*h(?:(\d{2}))?/);
  return match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : 24 * 60;
}

export function sortAgendaAssignments(assignments: AgendaAssignment[]) {
  return [...assignments].sort((left, right) =>
    timeOrder(left) - timeOrder(right)
    || assignmentLocal(left).localeCompare(assignmentLocal(right))
    || left.slot - right.slot
    || assignmentName(left).localeCompare(assignmentName(right))
  );
}

export function groupAssignmentsByLocal(assignments: AgendaAssignment[]) {
  const groups = new Map<string, AgendaAssignment[]>();
  for (const assignment of sortAgendaAssignments(assignments)) {
    const local = assignmentLocal(assignment);
    groups.set(local, [...(groups.get(local) ?? []), assignment]);
  }
  return [...groups.entries()].map(([local, items]) => ({ local, assignments: items }));
}

export function buildWeeklyAgenda(assignments: AgendaAssignment[]) {
  return DAYS.map((day) => {
    const dayAssignments = sortAgendaAssignments(assignments.filter((assignment) => assignment.dayOfWeek === day.key));
    return {
      ...day,
      assignments: dayAssignments,
      ferreira: groupAssignmentsByLocal(dayAssignments.filter((assignment) => assignment.assignmentType !== "EXTERNAL_IMPORTED")),
      prefilled: groupAssignmentsByLocal(dayAssignments.filter((assignment) => assignment.assignmentType === "EXTERNAL_IMPORTED"))
    };
  });
}

export function agendaStats(assignments: AgendaAssignment[]) {
  return {
    total: assignments.length,
    ferreira: assignments.filter((assignment) => assignment.assignmentType !== "EXTERNAL_IMPORTED").length,
    prefilled: assignments.filter((assignment) => assignment.assignmentType === "EXTERNAL_IMPORTED").length,
    alerts: assignments.filter((assignment) => assignment.isViolation || assignmentWarnings(assignment).length > 0).length
  };
}
