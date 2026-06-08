"use client";

import { DAYS, SHIFTS } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";

type Assignment = {
  id: string;
  dayOfWeek: string;
  shift: string;
  slot: number;
  isViolation: boolean;
  violationReason?: string | null;
  broker?: { id: string; name: string; team?: { name: string } } | null;
  dutyType: { id: string; name: string };
};

export function ScheduleTable({
  assignments
}: {
  assignments: Assignment[];
}) {
  const dutyNames = [...new Set(assignments.map((item) => item.dutyType.name))];

  return (
    <div className="overflow-x-auto rounded-lg border border-graphite/15">
      <table className="ui-font min-w-[980px] w-full border-collapse bg-white/70 text-sm">
        <thead className="bg-ink text-paper">
          <tr>
            <th className="w-44 border-r border-paper/20 px-3 py-3 text-left">Plantao</th>
            {DAYS.map((day) => (
              <th key={day.key} className="border-r border-paper/20 px-3 py-3 text-left">
                {day.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dutyNames.map((dutyName) =>
            SHIFTS.map((shift) => (
              <tr key={`${dutyName}-${shift.key}`} className="border-t border-graphite/10 align-top">
                <td className="border-r border-graphite/10 bg-linen/50 px-3 py-3 font-bold">
                  {dutyName}
                  <div className="text-xs font-normal text-graphite">{shift.label}</div>
                </td>
                {DAYS.map((day) => {
                  const cells = assignments.filter(
                    (item) => item.dutyType.name === dutyName && item.dayOfWeek === day.key && item.shift === shift.key
                  );
                  return (
                    <td key={day.key} className="h-24 border-r border-graphite/10 px-2 py-2">
                      <div className="flex flex-col gap-2">
                        {cells.length === 0 ? <span className="text-xs text-graphite/50">-</span> : null}
                        {cells.map((assignment) => (
                          <div key={assignment.id} className="rounded-md border border-graphite/15 bg-paper p-2">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-graphite">#{assignment.slot}</span>
                              {assignment.isViolation ? <StatusPill tone="warn">alerta</StatusPill> : <StatusPill tone="ok">ok</StatusPill>}
                            </div>
                            <div className="font-bold">{assignment.broker?.name ?? "Sem cobertura"}</div>
                            {assignment.broker?.team ? <div className="text-xs text-graphite">{assignment.broker.team.name}</div> : null}
                            {assignment.violationReason ? <p className="mt-1 text-xs text-signal">{assignment.violationReason}</p> : null}
                          </div>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
