import { describe, expect, it } from "vitest";
import { auditDistributionScenarios, type AuditRow } from "@/lib/distribution-audit";

const brokers = [{ id: "a", name: "Ana" }, { id: "b", name: "Bruno" }];
const priorities = ["Melhor", "Segundo", "Regular"];

function row(brokerId: string, localName: string, date = "2026-05-01"): AuditRow {
  return { brokerId, brokerName: brokerId === "a" ? "Ana" : "Bruno", localName, date };
}

describe("auditoria histórica privada", () => {
  it("questiona uma piora de apenas um plantão", () => {
    const result = auditDistributionScenarios({
      history: [row("a", "Regular"), row("b", "Regular")],
      before: [],
      after: [row("a", "Regular", "2026-06-12")],
      brokers,
      priorityLocalNames: priorities,
      today: "2026-06-09"
    });
    expect(result.warnings.join(" ")).toContain("aumenta de 0 para 1");
  });

  it("questiona benefício repetido nos melhores plantões e cita recorte recente", () => {
    const result = auditDistributionScenarios({
      history: [row("a", "Melhor", "2026-06-01"), row("b", "Regular", "2026-06-01")],
      before: [],
      after: [row("a", "Segundo", "2026-06-12")],
      brokers,
      priorityLocalNames: priorities,
      today: "2026-06-09"
    });
    expect(result.warnings.join(" ")).toContain("dois melhores");
    expect(result.warnings.join(" ")).toContain("últimas 8 semanas");
  });

  it("questiona concentração crescente no mesmo local", () => {
    const result = auditDistributionScenarios({
      history: [row("a", "Regular")],
      before: [],
      after: [row("a", "Regular", "2026-06-12")],
      brokers,
      priorityLocalNames: priorities,
      today: "2026-06-09"
    });
    expect(result.warnings.join(" ")).toContain("concentração em Regular");
  });

  it("questiona retirada de corretor abaixo da média", () => {
    const result = auditDistributionScenarios({
      history: [row("a", "Regular"), row("a", "Melhor"), row("a", "Segundo"), row("b", "Regular")],
      before: [row("b", "Segundo", "2026-06-12")],
      after: [],
      brokers,
      priorityLocalNames: priorities,
      today: "2026-06-09"
    });
    expect(result.warnings.join(" ")).toContain("estava abaixo da média");
  });
});
