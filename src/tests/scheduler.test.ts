import { expect, it } from "vitest";
import type { BrokerWithPlanningData } from "@/lib/scheduler";
import { generateSchedule } from "@/lib/scheduler";

const weekStart = new Date("2026-06-01T00:00:00.000Z");

function broker(partial: Partial<BrokerWithPlanningData> & { id: string; name: string }): BrokerWithPlanningData {
  return {
    id: partial.id,
    name: partial.name,
    effortLevel: partial.effortLevel ?? "HIGH",
    canExternalDuty: partial.canExternalDuty ?? true,
    active: partial.active ?? true,
    teamId: partial.teamId ?? "team-a",
    createdAt: new Date(),
    updatedAt: new Date(),
    team: { id: partial.teamId ?? "team-a", name: partial.teamId ?? "team-a" },
    autoHistoryTotal: partial.autoHistoryTotal ?? partial.historyTotal?.totalAssignments ?? 0,
    historyTotal: partial.historyTotal ?? {
      id: `history-${partial.id}`,
      brokerId: partial.id,
      totalAssignments: 0,
      externalAssignments: 0,
      headquartersPositionOne: 0,
      headquartersPositionTwo: 0,
      callingAssignments: 0
    }
  };
}

function duty(id: string, name: string, priority: number) {
  return { id, name, priority, requiresExternal: true, isHeadquarters: false, headquartersSlot: null, isCalling: false };
}

function window(id: string, dutyTypeId: string, dayOfWeek: string, quantity = 1, startHour = 8) {
  return { id, weekStart, dayOfWeek, shift: "MORNING", startHour, quantity, dutyTypeId, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 };
}

it("never assigns or suggests a broker unavailable at the duty start", () => {
  const top = duty("top", "Melhor", 1);
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "a", name: "Indisponivel", effortLevel: "VERY_HIGH" }), broker({ id: "b", name: "Disponivel", effortLevel: "HIGH" })],
    dutyTypes: [top],
    windows: [window("w1", top.id, "MONDAY")],
    unavailabilities: [{ id: "u1", date: weekStart, weekStart, dayOfWeek: "MONDAY", shift: "TIME_RANGE", startHour: 8, endHour: 12, brokerId: "a", reason: null }]
  });
  expect(result.assignments[0].brokerId).toBe("b");
});

it("guarantees two slots in each top local for very high effort when possible", () => {
  const best = duty("best", "Melhor", 1);
  const second = duty("second", "Segundo", 2);
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "vh", name: "Muito alto", effortLevel: "VERY_HIGH", autoHistoryTotal: 100 }), broker({ id: "other", name: "Outro", effortLevel: "MEDIUM" })],
    dutyTypes: [best, second],
    windows: [
      window("b1", best.id, "MONDAY"), window("b2", best.id, "TUESDAY"),
      window("s1", second.id, "WEDNESDAY"), window("s2", second.id, "THURSDAY")
    ],
    unavailabilities: [],
    priorityByLocalName: new Map([["Melhor", 1], ["Segundo", 2]])
  });
  expect(result.assignments.filter((item) => item.brokerId === "vh")).toHaveLength(4);
});

it("guarantees one slot in each top local for high effort when possible", () => {
  const best = duty("best", "Melhor", 1);
  const second = duty("second", "Segundo", 2);
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "high", name: "Alto", effortLevel: "HIGH", autoHistoryTotal: 100 }), broker({ id: "other", name: "Outro", effortLevel: "MEDIUM" })],
    dutyTypes: [best, second],
    windows: [window("b1", best.id, "MONDAY"), window("s1", second.id, "TUESDAY")],
    unavailabilities: [],
    priorityByLocalName: new Map([["Melhor", 1], ["Segundo", 2]])
  });
  expect(result.assignments.map((item) => item.brokerId)).toEqual(["high", "high"]);
});

it("balances targets between brokers in the same effort level", () => {
  const best = duty("best", "Melhor", 1);
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "vh1", name: "Muito alto 1", effortLevel: "VERY_HIGH" }),
      broker({ id: "vh2", name: "Muito alto 2", effortLevel: "VERY_HIGH" })
    ],
    dutyTypes: [best],
    windows: [
      window("w1", best.id, "MONDAY"), window("w2", best.id, "TUESDAY"),
      window("w3", best.id, "WEDNESDAY"), window("w4", best.id, "THURSDAY")
    ],
    unavailabilities: [],
    priorityByLocalName: new Map([["Melhor", 1]])
  });
  expect(result.assignments.filter((item) => item.brokerId === "vh1")).toHaveLength(2);
  expect(result.assignments.filter((item) => item.brokerId === "vh2")).toHaveLength(2);
});

it("places low and medium effort in the two worst locals using their aggregate targets", () => {
  const best = duty("best", "Melhor", 1);
  const bad = duty("bad", "Ruim", 2);
  const worst = duty("worst", "Pior", 3);
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "low", name: "Baixo", effortLevel: "LOW", autoHistoryTotal: 100 }),
      broker({ id: "medium", name: "Medio", effortLevel: "MEDIUM", autoHistoryTotal: 100 }),
      broker({ id: "high", name: "Alto", effortLevel: "HIGH" })
    ],
    dutyTypes: [best, bad, worst],
    windows: [
      window("best", best.id, "MONDAY"),
      window("bad1", bad.id, "TUESDAY"), window("bad2", bad.id, "WEDNESDAY"), window("bad3", bad.id, "THURSDAY"),
      window("worst1", worst.id, "FRIDAY"), window("worst2", worst.id, "SATURDAY"), window("worst3", worst.id, "SUNDAY")
    ],
    unavailabilities: [],
    priorityByLocalName: new Map([["Melhor", 1], ["Ruim", 2], ["Pior", 3]])
  });
  expect(result.assignments.filter((item) => item.brokerId === "low")).toHaveLength(3);
  expect(result.assignments.filter((item) => item.brokerId === "medium")).toHaveLength(2);
});

it("prioritizes rewards when best and worst locals overlap", () => {
  const only = duty("only", "Unico", 1);
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "vh", name: "Muito alto", effortLevel: "VERY_HIGH", autoHistoryTotal: 100 }), broker({ id: "low", name: "Baixo", effortLevel: "LOW" })],
    dutyTypes: [only],
    windows: [window("w1", only.id, "MONDAY")],
    unavailabilities: [],
    priorityByLocalName: new Map([["Unico", 1]])
  });
  expect(result.assignments[0].brokerId).toBe("vh");
});

it("uses balance and history after effort targets are satisfied", () => {
  const top = duty("top", "Melhor", 1);
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "loaded", name: "Carregado", effortLevel: "HIGH", autoHistoryTotal: 30 }), broker({ id: "balanced", name: "Equilibrado", effortLevel: "HIGH" })],
    dutyTypes: [top],
    windows: [window("w1", top.id, "MONDAY"), window("w2", top.id, "TUESDAY"), window("w3", top.id, "WEDNESDAY")],
    unavailabilities: [],
    priorityByLocalName: new Map([["Melhor", 1]])
  });
  expect(result.assignments[2].brokerId).toBe("balanced");
});

it("keeps a weekend calling pair inside the same team", () => {
  const calling = { ...duty("call", "Ligacao", 1), requiresExternal: false, isCalling: true };
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "a", name: "A1", effortLevel: "MEDIUM", teamId: "team-a" }),
      broker({ id: "b", name: "A2", effortLevel: "LOW", teamId: "team-a" }),
      broker({ id: "c", name: "B1", effortLevel: "VERY_HIGH", teamId: "team-b" })
    ],
    dutyTypes: [calling],
    windows: [window("w1", calling.id, "SATURDAY", 2)],
    unavailabilities: []
  });
  expect(result.assignments.map((item) => item.brokerId).sort()).toEqual(["a", "b"]);
});
