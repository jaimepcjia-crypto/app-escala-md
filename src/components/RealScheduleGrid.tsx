"use client";

import { DAYS } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";

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

function textColor(background?: string | null) {
  if (!background) return "#1d2328";
  const hex = background.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 < 120 ? "#fffaf0" : "#1d2328";
}

function groupKey(assignment: Assignment) {
  return assignment.importedCell?.localName || assignment.dutyType.name;
}

export function RealScheduleGrid({
  assignments,
  highlightBrokerId
}: {
  assignments: Assignment[];
  highlightBrokerId?: string | null;
}) {
  const groups = [...new Set(assignments.map(groupKey))];
  const hasImported = assignments.some((assignment) => assignment.importedCell);

  return (
    <div className="overflow-x-auto rounded-lg border-4 border-black bg-white">
      <table className="ui-font min-w-[1180px] w-full border-collapse text-[11px] leading-tight">
        <thead>
          <tr className="bg-[#b7b7b7] text-black">
            <th className="w-28 border border-black px-2 py-2">LOCAL</th>
            <th className="w-28 border border-black px-2 py-2">HORARIO</th>
            {DAYS.map((day) => (
              <th key={day.key} className="border border-black px-2 py-2 text-center">
                {day.label.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const groupAssignments = assignments
              .filter((assignment) => groupKey(assignment) === group)
              .sort((left, right) => (left.importedCell?.rowIndex ?? left.slot) - (right.importedCell?.rowIndex ?? right.slot));
            const rows = [...new Set(groupAssignments.map((assignment) => assignment.importedCell?.timeLabel || assignment.shift || "Turno"))];
            return rows.map((row, rowIndex) => (
              <tr key={`${group}-${row}`} className={rowIndex === 0 ? "border-t-4 border-black" : "border-t border-black"}>
                {rowIndex === 0 ? (
                  <td className="border border-black bg-[#efefef] px-2 py-2 text-center font-black uppercase [writing-mode:vertical-rl]" rowSpan={rows.length}>
                    {group}
                  </td>
                ) : null}
                <td className="border border-black bg-[#efefef] px-2 py-2 text-center font-bold">{row}</td>
                {DAYS.map((day) => {
                  const cells = groupAssignments.filter(
                    (assignment) => assignment.dayOfWeek === day.key && (assignment.importedCell?.timeLabel || assignment.shift || "Turno") === row
                  );
                  return (
                    <td key={day.key} className="min-h-12 border border-black bg-white px-1 py-1 align-top">
                      <div className="flex flex-col gap-1">
                        {cells.length === 0 ? <span className="text-black/30">{hasImported ? "" : "-"}</span> : null}
                        {cells.map((assignment) => {
                          const background = assignment.sourceColorHex || assignment.importedCell?.colorHex || (assignment.assignmentType === "FERREIRA_AI" ? "#B4A7D6" : "#EFEFEF");
                          const displayName = assignment.assignmentType === "EXTERNAL_IMPORTED"
                            ? assignment.sourceText || assignment.importedCell?.text || "Ocupado"
                            : assignment.broker?.name || "Sem cobertura";
                          const isHighlightedBroker = Boolean(highlightBrokerId && assignment.broker?.id === highlightBrokerId);
                          return (
                            <div
                              key={assignment.id}
                              className="rounded-md border border-black/25 px-1 py-1 text-center font-medium uppercase"
                              style={{ background, color: textColor(background) }}
                            >
                              <span className={isHighlightedBroker ? "font-black" : "font-medium"}>{displayName}</span>
                              {assignment.assignmentType === "FERREIRA_MANAGER_AI" ? <div className="mt-1"><StatusPill tone="warn">gerente via IA</StatusPill></div> : null}
                              {assignment.isViolation || assignment.balanceAlert || assignment.manualAlerts?.length ? (
                                <div className="mt-1 rounded-sm bg-white/80 p-1 text-[10px] text-signal">
                                  {assignment.violationReason || assignment.balanceAlert || assignment.manualAlerts?.map((item) => item.reason).join(" | ")}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
