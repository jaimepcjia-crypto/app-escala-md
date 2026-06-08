import { expect, it } from "vitest";
import { agendaStats, assignmentName, buildScheduleGrid, buildWeeklyAgenda, type AgendaAssignment } from "@/lib/schedule-agenda";

function assignment(patch: Partial<AgendaAssignment> & Pick<AgendaAssignment, "id">): AgendaAssignment {
  return {
    dayOfWeek: "MONDAY",
    shift: "MORNING",
    slot: 1,
    assignmentType: "FERREIRA_AI",
    isViolation: false,
    broker: { id: `broker-${patch.id}`, name: `Corretor ${patch.id}` },
    dutyType: { id: "duty", name: "SEDE" },
    importedCell: { id: `cell-${patch.id}`, localName: "SEDE", timeLabel: "8h-12h" },
    ...patch
  };
}

it("separates Ferreira assignments from names already defined in the XLSX", () => {
  const items = [
    assignment({ id: "ferreira" }),
    assignment({ id: "prefilled", assignmentType: "EXTERNAL_IMPORTED", sourceText: "Nome importado", broker: null })
  ];
  const monday = buildWeeklyAgenda(items)[0];

  expect(monday.ferreira.flatMap((group) => group.assignments).map((item) => item.id)).toEqual(["ferreira"]);
  expect(monday.prefilled.flatMap((group) => group.assignments).map((item) => item.id)).toEqual(["prefilled"]);
  expect(assignmentName(items[1])).toBe("Nome importado");
});

it("keeps every assignment exactly once and orders each day chronologically", () => {
  const items = [
    assignment({ id: "afternoon", startHour: 16, importedCell: { id: "a", localName: "SEDE", timeLabel: "16h-20h" } }),
    assignment({ id: "morning", startHour: 8, importedCell: { id: "b", localName: "SEDE", timeLabel: "8h-12h" } }),
    assignment({ id: "tuesday", dayOfWeek: "TUESDAY", startHour: 9 })
  ];
  const agenda = buildWeeklyAgenda(items);
  const renderedIds = agenda.flatMap((day) => [...day.ferreira, ...day.prefilled]).flatMap((group) => group.assignments.map((item) => item.id));

  expect(renderedIds).toHaveLength(items.length);
  expect(new Set(renderedIds).size).toBe(items.length);
  expect(agenda[0].assignments.map((item) => item.id)).toEqual(["morning", "afternoon"]);
});

it("reports operational totals and alerts", () => {
  const stats = agendaStats([
    assignment({ id: "ferreira" }),
    assignment({ id: "changed", assignmentType: "FERREIRA_MANAGER_AI", manualAlerts: [{ id: "alert", reason: "Critério contrariado" }] }),
    assignment({ id: "prefilled", assignmentType: "EXTERNAL_IMPORTED" })
  ]);

  expect(stats).toEqual({ total: 3, ferreira: 2, prefilled: 1, alerts: 1 });
});

it("groups the modern grid by local, day and time without duplicating assignments", () => {
  const items = [
    assignment({ id: "ana", dayOfWeek: "MONDAY", importedCell: { id: "a", localName: "SEDE", timeLabel: "8h-12h" } }),
    assignment({ id: "bruno", dayOfWeek: "MONDAY", importedCell: { id: "b", localName: "SEDE", timeLabel: "8h-12h" } }),
    assignment({ id: "carla", dayOfWeek: "TUESDAY", importedCell: { id: "c", localName: "QUIOSQUE", timeLabel: "12h-16h" } })
  ];
  const grid = buildScheduleGrid(items);
  const ids = grid.flatMap((local) => local.days).flatMap((day) => day.times).flatMap((time) => time.assignments.map((item) => item.id));

  expect(grid.map((local) => local.local)).toEqual(["SEDE", "QUIOSQUE"]);
  expect(grid[0].days[0].times[0].assignments.map((item) => item.id)).toEqual(["ana", "bruno"]);
  expect(ids).toHaveLength(items.length);
  expect(new Set(ids).size).toBe(items.length);
});
