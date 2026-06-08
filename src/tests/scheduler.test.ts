import { expect, it } from "vitest";
import type { BrokerWithPlanningData } from "@/lib/scheduler";
import { generateSchedule } from "@/lib/scheduler";

const weekStart = new Date("2026-06-01T00:00:00.000Z");

function broker(partial: Partial<BrokerWithPlanningData> & { id: string; name: string; salesRank?: number; teamId?: string }): BrokerWithPlanningData {
  const salesRank = partial.salesRank ?? 1;
  const salesAmountCents = partial.salesAmountCents ?? BigInt((10_000 - salesRank) * 100);
  return {
    id: partial.id,
    name: partial.name,
    canExternalDuty: partial.canExternalDuty ?? true,
    active: partial.active ?? true,
    teamId: partial.teamId ?? "team-a",
    createdAt: new Date(),
    updatedAt: new Date(),
    team: { id: partial.teamId ?? "team-a", name: partial.teamId ?? "team-a" },
    salesRank,
    salesAmountCents,
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

const duty = {
  id: "duty-casa",
  name: "Casa MD",
  priority: 1,
  requiresExternal: true,
  isHeadquarters: false,
  headquartersSlot: null,
  isCalling: false
};

it("never assigns a broker unavailable at the real duty start hour", () => {
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "a", name: "Alta", salesRank: 1 }), broker({ id: "b", name: "Baixa", salesRank: 2 })],
    dutyTypes: [duty],
    windows: [{ id: "w1", weekStart, dayOfWeek: "MONDAY", shift: "MORNING", startHour: 12, quantity: 1, dutyTypeId: duty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }],
    unavailabilities: [{ id: "u1", date: weekStart, weekStart, dayOfWeek: "MONDAY", shift: "TIME_RANGE", startHour: 8, endHour: 13, brokerId: "a", reason: null }]
  });

  expect(result.assignments[0].brokerId).toBe("b");
  expect(result.assignments[0].isViolation).toBe(false);
});

it("never suggests an unavailable broker when no duty can be covered", () => {
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "a", name: "Indisponivel", salesRank: 1 })],
    dutyTypes: [duty],
    windows: [{ id: "w1", weekStart, dayOfWeek: "MONDAY", shift: "MORNING", startHour: 8, quantity: 1, dutyTypeId: duty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }],
    unavailabilities: [{ id: "u1", date: weekStart, weekStart, dayOfWeek: "MONDAY", shift: "TIME_RANGE", startHour: 8, endHour: 12, brokerId: "a", reason: null }]
  });

  expect(result.assignments[0].brokerId).toBeNull();
  expect(result.conflicts[0].suggestions).toEqual([]);
});

it("does not privilege sales ranking when every broker has the same sales amount", () => {
  const topDuty = { ...duty, id: "top", name: "Sombreiros" };
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "r1", name: "Empatado carregado", salesRank: 1, salesAmountCents: BigInt(100), autoHistoryTotal: 30 }),
      broker({ id: "r2", name: "Empatado leve", salesRank: 1, salesAmountCents: BigInt(100) })
    ],
    dutyTypes: [topDuty],
    windows: [{ id: "w1", weekStart, dayOfWeek: "MONDAY", shift: "MORNING", quantity: 1, dutyTypeId: topDuty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }],
    unavailabilities: [],
    priorityByLocalName: new Map([["Sombreiros", 1]])
  });

  expect(result.assignments[0].brokerId).toBe("r2");
});

it("allows a broker when the duty starts exactly after the unavailable range ends", () => {
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "a", name: "Alta", salesRank: 1 }), broker({ id: "b", name: "Baixa", salesRank: 2 })],
    dutyTypes: [duty],
    windows: [{ id: "w1", weekStart, dayOfWeek: "MONDAY", shift: "AFTERNOON", startHour: 13, quantity: 1, dutyTypeId: duty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }],
    unavailabilities: [{ id: "u1", date: weekStart, weekStart, dayOfWeek: "MONDAY", shift: "TIME_RANGE", startHour: 8, endHour: 13, brokerId: "a", reason: null }]
  });

  expect(result.assignments[0].brokerId).toBe("a");
});

it("uses history balance after the reserved slots are filled", () => {
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "a", name: "Rank 1 carregado", salesRank: 1, autoHistoryTotal: 30 }),
      broker({ id: "b", name: "Rank 2 equilibrado", salesRank: 2 }),
      broker({ id: "c", name: "Rank 3 equilibrado", salesRank: 3 })
    ],
    dutyTypes: [duty],
    windows: [
      { id: "w1", weekStart, dayOfWeek: "MONDAY", shift: "MORNING", quantity: 1, dutyTypeId: duty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 },
      { id: "w2", weekStart, dayOfWeek: "TUESDAY", shift: "MORNING", quantity: 1, dutyTypeId: duty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 },
      { id: "w3", weekStart, dayOfWeek: "WEDNESDAY", shift: "MORNING", quantity: 1, dutyTypeId: duty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }
    ],
    unavailabilities: [],
    priorityByLocalName: new Map([["Casa MD", 1]])
  });

  expect(result.assignments[2].brokerId).toBe("b");
});

it("keeps weekend calling pair inside the same team", () => {
  const calling = { ...duty, id: "call", name: "Ligacao", requiresExternal: false, isCalling: true };
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "a", name: "A1", salesRank: 2, teamId: "team-a" }),
      broker({ id: "b", name: "A2", salesRank: 3, teamId: "team-a" }),
      broker({ id: "c", name: "B1", salesRank: 1, teamId: "team-b" })
    ],
    dutyTypes: [calling],
    windows: [{ id: "w1", weekStart, dayOfWeek: "SATURDAY", shift: "MORNING", quantity: 2, dutyTypeId: calling.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }],
    unavailabilities: []
  });

  expect(result.assignments.map((item) => item.brokerId).sort()).toEqual(["a", "b"]);
});

it("creates a conflict when no broker can work an external duty", () => {
  const result = generateSchedule({
    weekStart,
    brokers: [broker({ id: "a", name: "Sem externo", salesRank: 1, canExternalDuty: false })],
    dutyTypes: [duty],
    windows: [{ id: "w1", weekStart, dayOfWeek: "FRIDAY", shift: "AFTERNOON", quantity: 1, dutyTypeId: duty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }],
    unavailabilities: []
  });

  expect(result.assignments[0].brokerId).toBeNull();
  expect(result.assignments[0].isViolation).toBe(true);
  expect(result.conflicts).toHaveLength(1);
});

it("reserves 40 percent rounded up for the first two sales ranks on the top duty", () => {
  const topDuty = { ...duty, id: "top", name: "Sombreiros" };
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "r1", name: "Rank 1", salesRank: 1 }),
      broker({ id: "r2", name: "Rank 2", salesRank: 2 }),
      broker({ id: "r3", name: "Rank 3", salesRank: 3 }),
      broker({ id: "r4", name: "Rank 4", salesRank: 4 })
    ],
    dutyTypes: [topDuty],
    windows: [
      { id: "w1", weekStart, dayOfWeek: "MONDAY", shift: "MORNING", quantity: 1, dutyTypeId: topDuty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 },
      { id: "w2", weekStart, dayOfWeek: "TUESDAY", shift: "MORNING", quantity: 1, dutyTypeId: topDuty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 },
      { id: "w3", weekStart, dayOfWeek: "WEDNESDAY", shift: "MORNING", quantity: 1, dutyTypeId: topDuty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }
    ],
    unavailabilities: [],
    priorityByLocalName: new Map([["Sombreiros", 1]])
  });

  expect(result.assignments.slice(0, 2).map((item) => item.brokerId)).toEqual(["r1", "r2"]);
});

it("moves the reservation down the ranking when a reserved broker is unavailable", () => {
  const topDuty = { ...duty, id: "top", name: "Sombreiros" };
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "r1", name: "Rank 1", salesRank: 1 }),
      broker({ id: "r2", name: "Rank 2", salesRank: 2 }),
      broker({ id: "r3", name: "Rank 3", salesRank: 3 })
    ],
    dutyTypes: [topDuty],
    windows: [{ id: "w1", weekStart, dayOfWeek: "MONDAY", shift: "MORNING", startHour: 8, quantity: 1, dutyTypeId: topDuty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }],
    unavailabilities: [{ id: "u1", date: weekStart, weekStart, dayOfWeek: "MONDAY", shift: "TIME_RANGE", startHour: 8, endHour: 9, brokerId: "r1", reason: null }],
    priorityByLocalName: new Map([["Sombreiros", 1]])
  });

  expect(result.assignments[0].brokerId).toBe("r2");
});

it("gives the leader preference but includes every broker tied below inside the reserved group", () => {
  const topDuty = { ...duty, id: "top", name: "Sombreiros" };
  const secondPlaceAmount = BigInt(100);
  const result = generateSchedule({
    weekStart,
    brokers: [
      broker({ id: "r1", name: "Lider", salesRank: 1, salesAmountCents: BigInt(10_000) }),
      broker({ id: "r2", name: "Segundo A", salesRank: 2, salesAmountCents: secondPlaceAmount }),
      broker({ id: "r3", name: "Segundo B", salesRank: 2, salesAmountCents: secondPlaceAmount }),
      broker({ id: "r4", name: "Segundo C", salesRank: 2, salesAmountCents: secondPlaceAmount })
    ],
    dutyTypes: [topDuty],
    windows: [
      { id: "w1", weekStart, dayOfWeek: "MONDAY", shift: "MORNING", quantity: 1, dutyTypeId: topDuty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 },
      { id: "w2", weekStart, dayOfWeek: "TUESDAY", shift: "MORNING", quantity: 1, dutyTypeId: topDuty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 },
      { id: "w3", weekStart, dayOfWeek: "WEDNESDAY", shift: "MORNING", quantity: 1, dutyTypeId: topDuty.id, importCellId: null, sourceText: null, sourceColorHex: null, confidence: 1 }
    ],
    unavailabilities: [],
    priorityByLocalName: new Map([["Sombreiros", 1]])
  });

  expect(result.assignments[0].brokerId).toBe("r1");
  expect(["r2", "r3", "r4"]).toContain(result.assignments[1].brokerId);
});
