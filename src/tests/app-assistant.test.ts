import { describe, expect, it } from "vitest";
import { APP_KNOWLEDGE } from "@/lib/app-assistant";

describe("app assistant knowledge", () => {
  it("explica as travas absolutas e a confirmação da IA", () => {
    const knowledge = APP_KNOWLEDGE.join(" ");
    expect(knowledge).toContain("indisponibilidade é uma trava absoluta");
    expect(knowledge).toContain("toda proposta válida exige confirmação");
    expect(knowledge).toContain("Pedidos múltiplos de alteração são atômicos");
  });

  it("para o gerente, o nível de esforço deixa de ser oculto", () => {
    const knowledge = APP_KNOWLEDGE.join(" ");
    expect(knowledge).not.toContain("classificação interna nunca deve ser exposta");
    expect(knowledge.toLocaleLowerCase("pt-BR")).toContain("nível de esforço");
  });

  it("não introduz ranking, vendas ou meritocracia no conhecimento", () => {
    const knowledge = APP_KNOWLEDGE.join(" ").toLocaleLowerCase("pt-BR");
    expect(knowledge).not.toContain("ranking");
    expect(knowledge).not.toContain("vendas");
    expect(knowledge).not.toContain("meritocracia");
  });
});
