import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DistributionMemorandum } from "@/components/DistributionMemorandum";

function textFor(isManager: boolean) {
  return renderToStaticMarkup(<DistributionMemorandum isManager={isManager} />)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("distribution memorandum by profile", () => {
  it("shows the complete private effort rules to the manager", () => {
    const text = textFor(true);
    expect(text).toContain("Nível de esforço");
    expect(text).toContain("Muito Alto:");
    expect(text).toContain("Alto:");
    expect(text).toContain("Baixo:");
    expect(text).toContain("Médio:");
    expect(text).toContain("Muito Alto → Alto → Baixo → Médio");
    expect(text).toContain("sem nível de esforço bloqueiam a geração");
  });

  it("shows only a generic confidential explanation to brokers", () => {
    const text = textFor(false);
    expect(text).toContain("metas internas definidas pelo gerente");
    expect(text).toContain("classificações individuais");
    expect(text).not.toContain("Muito Alto:");
    expect(text).not.toContain("Alto:");
    expect(text).not.toContain("Baixo:");
    expect(text).not.toContain("Médio:");
    expect(text).not.toContain("melhores plantões");
    expect(text).not.toContain("piores plantões");
  });

  it("documents the real order and deterministic tie-breaker", () => {
    const text = textFor(false);
    expect(text).toContain("1. Travas absolutas");
    expect(text).toContain("2. Metas internas definidas pelo gerente");
    expect(text).toContain("3. Equilíbrio histórico");
    expect(text).toContain("4. Evitar concentração no mesmo tipo");
    expect(text).toContain("5. Distribuição ao longo da semana");
    expect(text).toContain("6. Desempate determinístico");
    expect(text).not.toContain("sorteio leve");
    expect(text).not.toContain("vale o peso de cada critério");
  });
});
