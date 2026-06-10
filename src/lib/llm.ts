import type { ScheduleAssignment } from "@prisma/client";
import { labelsFor } from "@/lib/constants";
import { effortLevelLabel } from "@/lib/effort-level";

type ReviewAssignment = ScheduleAssignment & {
  broker?: { name: string; team?: { name: string }; effortLevel?: string | null } | null;
  dutyType: { name: string; requiresExternal: boolean; isHeadquarters: boolean; isCalling: boolean };
  importedCell?: { localName?: string | null; colorHex?: string | null } | null;
};

type LlmReviewInput = {
  weekStart: Date;
  assignments: ReviewAssignment[];
  conflicts: Array<{ dutyType: string; dayOfWeek: string; shift: string; reason: string; suggestions: string[] }>;
  brokerStats: Array<{ name: string; total: number; external: number; headquarters: number; calling: number; nivelEsforco: string }>;
};

type LlmReviewResult = {
  model: string | null;
  status: "OK" | "DISABLED" | "ERROR";
  summary: string;
  balance?: string | null;
  conflicts?: string | null;
  rawJson?: string | null;
  error?: string | null;
};

export function getLlmConfig() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  // Default mais forte: a IA central analisa o estado operacional completo e usa tool-calling.
  // Defina OPENAI_MODEL para sobrescrever; o modelo precisa suportar function calling.
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  return { apiKey, baseUrl, model };
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("A IA retornou uma resposta vazia.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
    throw new Error("A IA nao retornou JSON valido.");
  }
}

export async function requestLlmJson<T>(input: {
  system: string;
  user: string;
  temperature?: number;
  schema?: unknown;
}): Promise<{ model: string; rawJson: string; parsed: T }> {
  const { apiKey, baseUrl, model } = getLlmConfig();
  if (!apiKey) {
    throw Object.assign(new Error("IA nao configurada. Defina OPENAI_API_KEY para ativar a IA."), { status: 503 });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: input.temperature ?? 0.1,
      // JSON mode: garante resposta em JSON valido (os prompts ja descrevem as chaves).
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user }
      ]
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message || "Falha ao consultar a IA."), { status: 502, body });
  }

  const rawJson = String(body?.choices?.[0]?.message?.content ?? "");
  return { model, rawJson, parsed: extractJson(rawJson) as T };
}

// Resposta final da IA central para o frontend. state "CONFIRMATION_REQUIRED" liga o botão de confirmar.
export type AgentResponse = {
  message: string;
  state?: string;
  requestId?: string;
  hasWarnings?: boolean;
  data?: unknown;
};

// Resultado de uma ferramenta: terminal encerra o turno (ex.: proposta que pede confirmação);
// caso contrário, data é devolvido ao modelo para continuar o raciocínio.
export type AgentToolResult = { terminal?: boolean; response?: AgentResponse; data?: unknown };

export type AgentTool = {
  definition: { type: "function"; function: { name: string; description: string; parameters: unknown } };
  handler: (args: Record<string, unknown>) => Promise<AgentToolResult>;
};

// Loop de tool-calling (OpenAI chat completions). O modelo decide quais ferramentas chamar;
// ferramentas de leitura realimentam o loop, ferramentas de mutação encerram pedindo confirmação.
export async function runAgent(input: {
  system: string;
  user: string;
  tools: AgentTool[];
  maxSteps?: number;
  temperature?: number;
}): Promise<AgentResponse> {
  const { apiKey, baseUrl, model } = getLlmConfig();
  if (!apiKey) {
    throw Object.assign(new Error("IA nao configurada. Defina OPENAI_API_KEY para ativar a IA."), { status: 503 });
  }

  const toolDefs = input.tools.map((tool) => tool.definition);
  const handlers = new Map(input.tools.map((tool) => [tool.definition.function.name, tool.handler]));
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: input.system },
    { role: "user", content: input.user }
  ];
  const maxSteps = input.maxSteps ?? 6;

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: input.temperature ?? 0.2,
        messages,
        tools: toolDefs,
        tool_choice: "auto"
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(body?.error?.message || "Falha ao consultar a IA."), { status: 502, body });
    }
    const message = body?.choices?.[0]?.message;
    if (!message) throw new Error("A IA retornou uma resposta vazia.");
    messages.push(message);

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!toolCalls.length) {
      const text = String(message.content ?? "").trim();
      return { message: text || "Não consegui formular uma resposta.", data: { agent: true } };
    }

    for (const call of toolCalls) {
      const handler = handlers.get(call.function?.name);
      if (!handler) {
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: `Ferramenta desconhecida: ${call.function?.name}` }) });
        continue;
      }
      let args: Record<string, unknown> = {};
      try { args = call.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = {}; }
      let result: AgentToolResult;
      try {
        result = await handler(args);
      } catch (error) {
        // Erro de uma proposta (fora de janela, esforço não classificado, etc.) encerra o turno com a mensagem exata.
        return { message: `IA: ${error instanceof Error ? error.message : "falha ao executar a ação."}`, state: "BLOCKED", data: { error: true } };
      }
      if (result.terminal && result.response) return result.response;
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data ?? {}) });
    }
  }

  return { message: "IA: não consegui concluir a análise em tempo hábil. Refaça o pedido de forma mais específica.", data: { agent: true } };
}

function compactAssignment(assignment: ReviewAssignment) {
  return {
    corretor: assignment.broker?.name ?? "Sem cobertura",
    equipe: assignment.broker?.team?.name ?? null,
    plantao: assignment.importedCell?.localName || assignment.dutyType.name,
    diaTurno: labelsFor(assignment.dayOfWeek as any, assignment.shift as any),
    tipo: assignment.assignmentType,
    violacao: assignment.isViolation ? assignment.violationReason || "violacao sem detalhe" : null,
    externo: assignment.dutyType.requiresExternal,
    sede: assignment.dutyType.isHeadquarters,
    ligacao: assignment.dutyType.isCalling
  };
}

export function buildBrokerStats(assignments: ReviewAssignment[]) {
  const rows = new Map<string, { name: string; total: number; external: number; headquarters: number; calling: number; nivelEsforco: string }>();
  for (const assignment of assignments) {
    if (!assignment.brokerId || !assignment.broker || assignment.assignmentType === "EXTERNAL_IMPORTED") continue;
    const current = rows.get(assignment.brokerId) ?? {
      name: assignment.broker.name,
      total: 0,
      external: 0,
      headquarters: 0,
      calling: 0,
      nivelEsforco: effortLevelLabel(assignment.broker.effortLevel)
    };
    current.total += 1;
    if (assignment.dutyType.requiresExternal) current.external += 1;
    if (assignment.dutyType.isHeadquarters) current.headquarters += 1;
    if (assignment.dutyType.isCalling) current.calling += 1;
    rows.set(assignment.brokerId, current);
  }
  return [...rows.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
}

export async function reviewScheduleWithLlm(input: LlmReviewInput): Promise<LlmReviewResult> {
  const { apiKey, model } = getLlmConfig();
  if (!apiKey) {
    return {
      model: null,
      status: "DISABLED",
      summary: "IA nao configurada. Defina OPENAI_API_KEY para ativar a analise da escala.",
      balance: null,
      conflicts: null,
      rawJson: null,
      error: null
    };
  }

  const payload = {
    semana: input.weekStart.toISOString().slice(0, 10),
    regras: [
      "Disponibilidade e permissao externa sao travas duras.",
      "A escala ja foi gerada pelo motor deterministico; a LLM deve auditar e sugerir melhorias, nao inventar regras.",
      "Cores/janelas roxas sao do gerente Ferreira; demais plantões importados sao externos e preservados.",
      "O gerente somente pode alterar atribuicoes por pedido a IA, com analise e confirmacao; mudancas confirmadas devem mostrar o impacto no balanceamento.",
      "O nivel de esforco de cada corretor (nivelEsforco) e a classificacao interna do gerente; esta analise e vista apenas pelo gerente, entao voce PODE considera-lo e menciona-lo ao explicar o equilibrio.",
      "Nao use nomes tecnicos de campos do sistema, como assignmentType, null ou JSON."
    ],
    estatisticasCorretores: input.brokerStats,
    conflitosDoMotor: input.conflicts,
    atribuicoes: input.assignments
      .filter((assignment) => assignment.assignmentType !== "EXTERNAL_IMPORTED" || assignment.isViolation)
      .slice(0, 220)
      .map(compactAssignment)
  };

  try {
    const result = await requestLlmJson<{
      summary: string;
      balance: string;
      conflicts: string;
    }>({
      system:
        "Voce e a IA auditora de escala imobiliaria do gerente Ferreira e responde apenas ao gerente. Responda em portugues do Brasil, com linguagem de gerente, sem termos tecnicos de banco ou codigo. Voce pode considerar e mencionar o nivel de esforco dos corretores ao explicar o equilibrio. A primeira frase de summary deve deixar claro se a escala foi publicada, se ha pendencias e quantas. balance deve falar da distribuicao dos corretores da equipe Ferreira, podendo relacionar com o nivel de esforco. conflicts deve ser curto e operacional. Retorne somente JSON valido com as chaves: summary, balance, conflicts.",
      user: JSON.stringify(payload),
      schema: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          balance: { type: "STRING" },
          conflicts: { type: "STRING" }
        },
        required: ["summary", "balance", "conflicts"]
      }
    });
    return {
      model: result.model,
      status: "OK",
      summary: result.parsed.summary,
      balance: result.parsed.balance,
      conflicts: result.parsed.conflicts,
      rawJson: result.rawJson,
      error: null
    };
  } catch (error) {
    return {
      model,
      status: "ERROR",
      summary: "A escala foi publicada, mas a IA nao conseguiu analisar esta geracao.",
      rawJson: null,
      error: error instanceof Error ? error.message : "Falha desconhecida na IA."
    };
  }
}
