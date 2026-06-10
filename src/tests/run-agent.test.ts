import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type AgentTool } from "@/lib/llm";

function mockFetchSequence(responses: unknown[]) {
  let index = 0;
  const fn = vi.fn(async () => {
    const body = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return { ok: true, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const toolCallResponse = (name: string, id = "c1") => ({
  choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] } }]
});
const answerResponse = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });

const readTool: AgentTool = {
  definition: { type: "function", function: { name: "ler", description: "leitura", parameters: { type: "object", properties: {} } } },
  handler: async () => ({ data: { ok: true } })
};
const mutateTool: AgentTool = {
  definition: { type: "function", function: { name: "agir", description: "muta", parameters: { type: "object", properties: {} } } },
  handler: async () => ({ terminal: true, response: { message: "IA: proposta pronta", state: "CONFIRMATION_REQUIRED", requestId: "r1", hasWarnings: false } })
};

describe("runAgent — loop de tool-calling", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("responde direto quando não há chamada de ferramenta", async () => {
    const fetchMock = mockFetchSequence([answerResponse("tudo certo")]);
    const result = await runAgent({ system: "s", user: "u", tools: [readTool] });
    expect(result.message).toBe("tudo certo");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("executa ferramenta de leitura, realimenta o loop e devolve a resposta final", async () => {
    const fetchMock = mockFetchSequence([toolCallResponse("ler"), answerResponse("resposta com dados")]);
    const result = await runAgent({ system: "s", user: "u", tools: [readTool] });
    expect(result.message).toBe("resposta com dados");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("encerra o turno quando uma ferramenta de mutação retorna terminal (proposta pendente)", async () => {
    const fetchMock = mockFetchSequence([toolCallResponse("agir"), answerResponse("não deveria chegar aqui")]);
    const result = await runAgent({ system: "s", user: "u", tools: [mutateTool] });
    expect(result.state).toBe("CONFIRMATION_REQUIRED");
    expect(result.requestId).toBe("r1");
    expect(result.message).toBe("IA: proposta pronta");
    // não houve segunda chamada ao modelo: a proposta encerra o turno aguardando confirmação
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propaga erro de ferramenta como mensagem bloqueante, sem executar nada", async () => {
    mockFetchSequence([toolCallResponse("agir")]);
    const throwingTool: AgentTool = {
      definition: { type: "function", function: { name: "agir", description: "muta", parameters: { type: "object", properties: {} } } },
      handler: async () => {
        throw new Error("fora da janela de geração");
      }
    };
    const result = await runAgent({ system: "s", user: "u", tools: [throwingTool] });
    expect(result.state).toBe("BLOCKED");
    expect(result.message).toContain("fora da janela de geração");
  });
});
