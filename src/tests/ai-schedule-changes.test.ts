import { describe, expect, it } from "vitest";
import { hardConstraintReasons } from "@/lib/ai-schedule-changes";
import { PATCH } from "@/app/api/escala/ajustar/route";

describe("travas absolutas de mudancas pedidas pela IA", () => {
  it("bloqueia indisponibilidade sem permitir confirmacao", () => {
    const reasons = hardConstraintReasons({
      brokerName: "Ana",
      active: true,
      requiresExternal: false,
      canExternalDuty: true,
      unavailable: true,
      simultaneousCount: 1
    });
    expect(reasons).toEqual(["Ana: corretor marcou indisponibilidade nesse horario."]);
  });

  it("prioriza a indisponibilidade quando existem varias travas", () => {
    const reasons = hardConstraintReasons({
      brokerName: "Ana",
      active: false,
      requiresExternal: true,
      canExternalDuty: false,
      unavailable: true,
      simultaneousCount: 2
    });
    expect(reasons[0]).toContain("indisponibilidade");
  });

  it("bloqueia corretor inativo, externo sem autorizacao e choque de horario", () => {
    const reasons = hardConstraintReasons({
      brokerName: "Bruno",
      active: false,
      requiresExternal: true,
      canExternalDuty: false,
      unavailable: false,
      simultaneousCount: 2
    });
    expect(reasons).toHaveLength(3);
    expect(reasons.join(" ")).toContain("inativo");
    expect(reasons.join(" ")).toContain("sem autorizacao");
    expect(reasons.join(" ")).toContain("dois plantoes");
  });
});

it("desativa o antigo endpoint de edicao direta da escala", async () => {
  const response = await PATCH();
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    error: expect.stringContaining("IA")
  });
});
