import type { ScheduleAssignment } from "@prisma/client";
import { labelsFor } from "@/lib/constants";

type ReviewAssignment = ScheduleAssignment & {
  broker?: { name: string; team?: { name: string } } | null;
  dutyType: { name: string; requiresExternal: boolean; isHeadquarters: boolean; isCalling: boolean };
  importedCell?: { localName?: string | null; colorHex?: string | null } | null;
};

type LlmReviewInput = {
  weekStart: Date;
  assignments: ReviewAssignment[];
  conflicts: Array<{ dutyType: string; dayOfWeek: string; shift: string; reason: string; suggestions: string[] }>;
  brokerStats: Array<{ name: string; salesRank: number | null; total: number; external: number; headquarters: number; calling: number }>;
};

type LlmReviewResult = {
  model: string | null;
  status: "OK" | "DISABLED" | "ERROR";
  summary: string;
  meritocracy?: string | null;
  balance?: string | null;
  conflicts?: string | null;
  recommendations: string[];
  rawJson?: string | null;
  error?: string | null;
};

export function getLlmConfig() {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
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
    throw Object.assign(new Error("IA nao configurada. Defina GEMINI_API_KEY para ativar a IA."), { status: 503 });
  }

  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const response = await fetch(`${baseUrl}/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: input.system }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: input.user }]
        }
      ],
      generationConfig: {
        temperature: input.temperature ?? 0.1,
        responseMimeType: "application/json",
        ...(input.schema ? { responseSchema: input.schema } : {})
      }
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message || "Falha ao consultar a IA."), { status: 502, body });
  }

  const rawJson = String(
    (body?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? "")
      .filter(Boolean)
      .join("")
  );
  return { model, rawJson, parsed: extractJson(rawJson) as T };
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
  const rows = new Map<string, { name: string; salesRank: number | null; total: number; external: number; headquarters: number; calling: number }>();
  for (const assignment of assignments) {
    if (!assignment.brokerId || !assignment.broker || assignment.assignmentType === "EXTERNAL_IMPORTED") continue;
    const current = rows.get(assignment.brokerId) ?? {
      name: assignment.broker.name,
      salesRank: null,
      total: 0,
      external: 0,
      headquarters: 0,
      calling: 0
    };
    current.total += 1;
    if (assignment.dutyType.requiresExternal) current.external += 1;
    if (assignment.dutyType.isHeadquarters) current.headquarters += 1;
    if (assignment.dutyType.isCalling) current.calling += 1;
    rows.set(assignment.brokerId, current);
  }
  return [...rows.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
}

export function buildBrokerStatsWithRanks(assignments: ReviewAssignment[], rankByBrokerId: Map<string, number>) {
  const rows = new Map<string, { name: string; salesRank: number | null; total: number; external: number; headquarters: number; calling: number }>();
  for (const assignment of assignments) {
    if (!assignment.brokerId || !assignment.broker || assignment.assignmentType === "EXTERNAL_IMPORTED") continue;
    const current = rows.get(assignment.brokerId) ?? {
      name: assignment.broker.name,
      salesRank: rankByBrokerId.get(assignment.brokerId) ?? null,
      total: 0,
      external: 0,
      headquarters: 0,
      calling: 0
    };
    current.total += 1;
    if (assignment.dutyType.requiresExternal) current.external += 1;
    if (assignment.dutyType.isHeadquarters) current.headquarters += 1;
    if (assignment.dutyType.isCalling) current.calling += 1;
    rows.set(assignment.brokerId, current);
  }
  return [...rows.values()].sort((left, right) => (left.salesRank ?? 9999) - (right.salesRank ?? 9999) || right.total - left.total || left.name.localeCompare(right.name));
}

export async function reviewScheduleWithLlm(input: LlmReviewInput): Promise<LlmReviewResult> {
  const { apiKey, model } = getLlmConfig();
  if (!apiKey) {
    return {
      model: null,
      status: "DISABLED",
      summary: "IA nao configurada. Defina GEMINI_API_KEY para ativar a analise da escala.",
      meritocracy: null,
      balance: null,
      conflicts: null,
      recommendations: [],
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
      "Meritocracia usa faixas reais de vendas e reservas nos tres melhores plantoes.",
      "O gerente pode editar manualmente, mas deve ver impacto no balanceamento.",
      "Se todos estiverem com venda padrao R$ 1,00 ou empatados, explique que vendas nao favorecem nenhum corretor individualmente.",
      "Nao use nomes tecnicos de campos do sistema, como salesRank, assignmentType, null ou JSON."
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
      meritocracy: string;
      balance: string;
      conflicts: string;
      recommendations: string[];
    }>({
      system:
        "Voce e a IA auditora de escala imobiliaria do gerente Ferreira. Responda em portugues do Brasil, com linguagem de gerente, sem termos tecnicos de banco ou codigo. A primeira frase de summary deve deixar claro se a escala foi publicada, se ha pendencias e quantas. meritocracy deve explicar se a regra de vendas foi aplicada ou se houve empate real, caso em que vendas nao favorecem nenhum corretor individualmente. balance deve falar apenas da distribuicao dos corretores da equipe Ferreira. conflicts deve ser curto e operacional. recommendations deve ter no maximo 3 acoes praticas, sem sugerir violar indisponibilidade. Retorne somente JSON valido com as chaves: summary, meritocracy, balance, conflicts, recommendations.",
      user: JSON.stringify(payload),
      schema: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          meritocracy: { type: "STRING" },
          balance: { type: "STRING" },
          conflicts: { type: "STRING" },
          recommendations: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["summary", "meritocracy", "balance", "conflicts", "recommendations"]
      }
    });
    return {
      model: result.model,
      status: "OK",
      summary: result.parsed.summary,
      meritocracy: result.parsed.meritocracy,
      balance: result.parsed.balance,
      conflicts: result.parsed.conflicts,
      recommendations: Array.isArray(result.parsed.recommendations) ? result.parsed.recommendations : [],
      rawJson: result.rawJson,
      error: null
    };
  } catch (error) {
    return {
      model,
      status: "ERROR",
      summary: "A escala foi publicada, mas a IA nao conseguiu analisar esta geracao.",
      recommendations: [],
      rawJson: null,
      error: error instanceof Error ? error.message : "Falha desconhecida na IA."
    };
  }
}
