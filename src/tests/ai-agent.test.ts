import { describe, expect, it } from "vitest";
import { buildAgentTools, sanitizeBrokerForAi } from "@/lib/ai-agent";

describe("ai agent — segurança do contexto", () => {
  it("nunca inclui credenciais do corretor no payload da IA", () => {
    const broker = {
      name: "Ana",
      active: true,
      canExternalDuty: true,
      effortLevel: "HIGH",
      team: { isFerreira: true },
      autoHistoryTotal: 12,
      historyTotal: {
        totalAssignments: 12,
        externalAssignments: 2,
        headquartersPositionOne: 1,
        headquartersPositionTwo: 0,
        callingAssignments: 3
      },
      // campos sensíveis que NÃO podem vazar
      user: { email: "ana@x.com", passwordPlain: "1234", passwordHash: "$2a$hash" },
      passwordPlain: "1234"
    } as never;

    const sanitized = sanitizeBrokerForAi(broker);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("$2a$hash");
    expect(serialized).not.toContain("ana@x.com");
    expect(sanitized).not.toHaveProperty("user");
    expect(sanitized).not.toHaveProperty("passwordPlain");
    expect(sanitized).not.toHaveProperty("passwordHash");
    // o que importa para análise permanece
    expect(sanitized.nivelEsforco).toBe("Esforço Alto");
    expect(sanitized.historicoPublicado).toBe(12);
  });
});

describe("ai agent — guardrails das ferramentas", () => {
  const names = buildAgentTools("teste", new Date()).map((tool) => tool.definition.function.name);

  it("expõe as ferramentas de leitura e de proposta esperadas", () => {
    expect(names).toContain("consultar_historico");
    expect(names).toContain("propor_geracao_e_publicacao");
    expect(names).toContain("propor_redistribuicao");
    expect(names).toContain("propor_alteracoes");
  });

  it("não expõe nenhuma ferramenta que execute, confirme ou cancele diretamente", () => {
    expect(names.some((name) => /confirm|execut|aplica|cancel|publicar_direto/i.test(name))).toBe(false);
  });
});
