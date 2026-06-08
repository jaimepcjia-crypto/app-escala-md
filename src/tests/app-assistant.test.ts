import { describe, expect, it } from "vitest";
import { APP_KNOWLEDGE, appAssistantSystemPrompt } from "@/lib/app-assistant";

describe("app assistant knowledge", () => {
  it("explica as travas absolutas e a confirmação da IA", () => {
    const knowledge = APP_KNOWLEDGE.join(" ");
    expect(knowledge).toContain("indisponibilidade é uma trava absoluta");
    expect(knowledge).toContain("toda proposta válida exige confirmação");
    expect(knowledge).toContain("Pedidos múltiplos de alteração são atômicos");
  });

  it("separa respostas informativas de ações no motor", () => {
    const prompt = appAssistantSystemPrompt();
    expect(prompt).toContain("Esta etapa é somente informativa");
    expect(prompt).toContain("não execute");
    expect(prompt).toContain("Não exponha senhas");
  });
});
