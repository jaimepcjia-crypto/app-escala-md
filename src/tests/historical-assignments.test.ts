import { describe, expect, it } from "vitest";
import { isHistoricalAssignmentQuestion, summarizeHistoricalAssignments } from "@/lib/historical-assignments";

const weekStart = new Date("2026-06-08T00:00:00.000Z");
const rows = [
  { schedule: { weekStart }, dayOfWeek: "MONDAY", assignmentType: "FERREIRA_AI", broker: { name: "Ana" }, dutyType: { name: "SEDE" }, importedCell: { localName: "Sombreiros" } },
  { schedule: { weekStart }, dayOfWeek: "TUESDAY", assignmentType: "FERREIRA_MANAGER_AI", broker: { name: "Ana" }, dutyType: { name: "SEDE" }, importedCell: { localName: "Sombreiros" } },
  { schedule: { weekStart }, dayOfWeek: "WEDNESDAY", assignmentType: "FERREIRA_AI", broker: { name: "Bruno" }, dutyType: { name: "SEDE" }, importedCell: { localName: "Sombreiros" } },
  { schedule: { weekStart }, dayOfWeek: "THURSDAY", assignmentType: "EXTERNAL_IMPORTED", broker: null, dutyType: { name: "SEDE" }, importedCell: { localName: "Sombreiros" } }
];

describe("historical assignment queries", () => {
  it("detecta perguntas históricas sobre plantões", () => {
    expect(isHistoricalAssignmentQuestion("quantos plantões Ana teve no Sombreiros?")).toBe(true);
    expect(isHistoricalAssignmentQuestion("como funciona a escala?")).toBe(false);
  });

  it("conta por corretor, plantão e período usando somente atribuições Ferreira", () => {
    const result = summarizeHistoricalAssignments(rows, {
      brokerName: "Ana",
      localName: "Sombreiros",
      startDate: "2026-06-08",
      endDate: "2026-06-09"
    });
    expect(result.state).toBe("ANSWERED");
    expect(result.data?.count).toBe(2);
  });

  it("solicita correção quando o nome não existe no histórico", () => {
    const result = summarizeHistoricalAssignments(rows, { brokerName: "Carla", localName: "Sombreiros" });
    expect(result.state).toBe("BLOCKED");
    expect(result.message).toContain("não encontrado");
  });
});
