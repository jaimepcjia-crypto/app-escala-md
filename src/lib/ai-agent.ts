import { prisma } from "@/lib/prisma";
import { labelsFor } from "@/lib/constants";
import { effortLevelLabel } from "@/lib/effort-level";
import { currentSaoPauloWeekStart, weeklyWorkflowStatus } from "@/lib/deadlines";
import { getAdminSnapshot } from "@/lib/data";
import { runAgent, type AgentResponse, type AgentTool } from "@/lib/llm";
import { APP_KNOWLEDGE } from "@/lib/app-assistant";
import { analyzeScheduleChangeRequest, type RequestedScheduleChange } from "@/lib/ai-schedule-changes";
import { analyzeInitialGenerationRequest, analyzeRemainderRedistributionRequest } from "@/lib/ai-schedule-proposals";
import { queryHistoricalAssignments, type HistoricalAssignmentFilters } from "@/lib/historical-assignments";

type SnapshotBroker = {
  name: string;
  active: boolean;
  canExternalDuty: boolean;
  effortLevel?: string | null;
  team: { isFerreira: boolean };
  autoHistoryTotal?: number;
  historyTotal?: {
    totalAssignments: number;
    externalAssignments: number;
    headquartersPositionOne: number;
    headquartersPositionTwo: number;
    callingAssignments: number;
  } | null;
};

// Projeta o corretor para a IA SEM credenciais. passwordPlain/passwordHash/user nunca entram no payload do LLM.
export function sanitizeBrokerForAi(broker: SnapshotBroker) {
  return {
    nome: broker.name,
    ativo: broker.active,
    equipeFerreira: broker.team.isFerreira,
    autorizadoExterno: broker.canExternalDuty,
    nivelEsforco: effortLevelLabel(broker.effortLevel),
    nivelEsforcoCodigo: broker.effortLevel ?? null,
    historicoPublicado: broker.autoHistoryTotal ?? 0,
    historicoDetalhado: broker.historyTotal
      ? {
          total: broker.historyTotal.totalAssignments,
          externos: broker.historyTotal.externalAssignments,
          sede: broker.historyTotal.headquartersPositionOne + broker.historyTotal.headquartersPositionTwo,
          ligacoes: broker.historyTotal.callingAssignments
        }
      : null
  };
}

// Estado operacional COMPLETO entregue à IA (semana atual + próxima), sem dados sensíveis de login.
export async function buildFullAiContext() {
  const snapshot = await getAdminSnapshot();
  const workflow = weeklyWorkflowStatus();
  const currentSchedule = await prisma.schedule.findFirst({
    where: { weekStart: workflow.currentWeekStartDate, status: "PUBLISHED" },
    include: {
      assignments: { include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true } },
      aiReview: true
    },
    orderBy: { publishedAt: "desc" }
  });

  const currentAssignments = currentSchedule?.assignments ?? [];
  const atribuicoesAtuais = currentAssignments.map((assignment) => ({
    corretor: assignment.broker?.name ?? "Sem cobertura",
    plantao: assignment.importedCell?.localName || assignment.dutyType.name,
    diaTurno: labelsFor(assignment.dayOfWeek, assignment.shift),
    tipo: assignment.assignmentType,
    violacao: assignment.isViolation ? assignment.violationReason || "violação" : null,
    avisoEquilibrio: assignment.balanceAlert ?? null,
    avisosManuais: assignment.manualAlerts.map((alert) => alert.reason)
  }));
  const review = currentSchedule?.aiReview ?? null;

  return {
    hoje: snapshot.workflow,
    janelaDeGeracao: snapshot.generationGate,
    prontidaoIndisponibilidades: snapshot.readiness,
    prioridadesPlantoes: snapshot.plantaoPriorities.map((item) => item.localName),
    propostaPendente: snapshot.pendingChangeRequest
      ? { resumo: snapshot.pendingChangeRequest.summary, status: snapshot.pendingChangeRequest.status }
      : null,
    corretores: (snapshot.brokers as SnapshotBroker[]).map(sanitizeBrokerForAi),
    semanaAtual: {
      publicada: Boolean(currentSchedule),
      inicio: workflow.currentWeekStart,
      fim: workflow.currentWeekEnd,
      totalAtribuicoes: atribuicoesAtuais.length,
      semCobertura: atribuicoesAtuais.filter((item) => item.corretor === "Sem cobertura" && item.tipo !== "EXTERNAL_IMPORTED").length,
      atribuicoes: atribuicoesAtuais,
      analiseIa: review
        ? { resumo: review.summary, equilibrio: review.balance, conflitos: review.conflicts, status: review.status }
        : null
    },
    proximaSemana: {
      inicio: workflow.weekStart,
      fim: workflow.weekEnd,
      importacao: snapshot.imports[0]?.status ?? "NOT_SENT",
      arquivo: snapshot.imports[0]?.fileName ?? null,
      publicada: snapshot.schedules.some((schedule) => schedule.status === "PUBLISHED")
    }
  };
}

function agentSystemPrompt() {
  return [
    "Você é a IA central e operadora do App Escala MD, atendendo EXCLUSIVAMENTE o gerente Ferreira (a rota é protegida; corretores não acessam esta IA).",
    "Você recebe o estado operacional COMPLETO do app em estadoAtual e deve usá-lo para analisar e responder qualquer pergunta com dados reais. Não invente dados nem números.",
    "Como atende somente o gerente, você PODE explicar livremente o nível de esforço de cada corretor, o equilíbrio, o histórico e os critérios internos. Não existe classificação oculta para o gerente.",
    "Nunca exponha senhas, e-mails de login, hashes, IDs internos, detalhes de banco, código ou configuração — esses dados não estão no estado e não devem ser inferidos.",
    "Para AGIR no motor (gerar/publicar a próxima escala, redistribuir os dias futuros da escala em vigor, ou trocar/retirar corretores), chame a ferramenta correspondente. Toda ação cria uma PROPOSTA que exige confirmação expressa do gerente antes de executar — você nunca executa nem confirma sozinho.",
    "Faça no máximo UMA proposta de mudança por resposta. Se faltar informação para a proposta, peça o detalhe em vez de chamar a ferramenta.",
    "Para contagens em todo o histórico publicado (além da semana atual), use a ferramenta de histórico.",
    "Respeite as travas absolutas (indisponibilidade, corretor inativo, plantão externo sem autorização, dois plantões no mesmo horário): o motor as garante e você nunca deve prometer ultrapassá-las.",
    "Responda em português do Brasil, de forma objetiva e completa, com linguagem de gerente. Não use nomes técnicos de campos (assignmentType, null, JSON).",
    `REGRAS DO APP:\n- ${APP_KNOWLEDGE.join("\n- ")}`
  ].join("\n");
}

function toResponse(result: { state?: string; message: string; requestId?: string; hasWarnings?: boolean }): AgentResponse {
  return { message: result.message, state: result.state, requestId: result.requestId, hasWarnings: result.hasWarnings, data: result };
}

function normalizeChange(raw: Record<string, unknown>): RequestedScheduleChange {
  const startHour = Number(raw?.startHour);
  return {
    localName: typeof raw?.localName === "string" ? raw.localName : null,
    dayOfWeek: typeof raw?.dayOfWeek === "string" ? raw.dayOfWeek : null,
    startHour: Number.isFinite(startHour) ? startHour : null,
    timeLabel: typeof raw?.timeLabel === "string" ? raw.timeLabel : null,
    currentBrokerName: typeof raw?.currentBrokerName === "string" ? raw.currentBrokerName : null,
    newBrokerName: typeof raw?.newBrokerName === "string" ? raw.newBrokerName : null
  };
}

// Ferramentas expostas à IA. Observação de segurança: NÃO existe ferramenta de confirmar/executar/cancelar —
// confirmação fica no caminho determinístico (decideScheduleChangeRequest) fora do loop.
export function buildAgentTools(command: string, weekStart: Date): AgentTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "consultar_historico",
          description:
            "Conta plantões no histórico publicado (todas as semanas já publicadas), com filtros opcionais. Use para perguntas de quantidade/comparação histórica que vão além da semana atual já presente no estado.",
          parameters: {
            type: "object",
            properties: {
              brokerName: { type: "string", description: "Nome do corretor (opcional)" },
              localName: { type: "string", description: "Nome do plantão/local (opcional)" },
              startDate: { type: "string", description: "Data inicial YYYY-MM-DD (opcional)" },
              endDate: { type: "string", description: "Data final YYYY-MM-DD (opcional)" }
            }
          }
        }
      },
      handler: async (args) => {
        const isoDate = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
        const filters: HistoricalAssignmentFilters = {
          brokerName: typeof args?.brokerName === "string" ? args.brokerName : null,
          localName: typeof args?.localName === "string" ? args.localName : null,
          startDate: isoDate(args?.startDate),
          endDate: isoDate(args?.endDate)
        };
        const result = await queryHistoricalAssignments(filters);
        return { data: result };
      }
    },
    {
      definition: {
        type: "function",
        function: {
          name: "propor_geracao_e_publicacao",
          description:
            "Prepara uma PRÉVIA exata da próxima escala (a publicação ocorre só após confirmação do gerente). Use quando o gerente pedir para gerar/montar/publicar a escala da próxima semana.",
          parameters: {
            type: "object",
            properties: { maisEquilibrada: { type: "boolean", description: "Priorizar o máximo equilíbrio na geração." } }
          }
        }
      },
      handler: async (args) => {
        const result = await analyzeInitialGenerationRequest(
          weeklyWorkflowStatus().weekStartDate,
          command,
          args?.maisEquilibrada === true ? { balanceMode: "MORE_BALANCED" } : {}
        );
        return { terminal: true, response: toResponse(result) };
      }
    },
    {
      definition: {
        type: "function",
        function: {
          name: "propor_redistribuicao",
          description:
            "Simula a redistribuição dos DIAS FUTUROS da escala em vigor, preservando o que já foi trabalhado. Use para reorganizar/equilibrar a semana atual.",
          parameters: {
            type: "object",
            properties: {
              maisEquilibrada: { type: "boolean", description: "Forçar modo de máximo equilíbrio (padrão: sim)." },
              focoCorretor: { type: "string", description: "Nome do corretor a desonerar/investigar (opcional)." }
            }
          }
        }
      },
      handler: async (args) => {
        const result = await analyzeRemainderRedistributionRequest(currentSaoPauloWeekStart(), command, {
          balanceMode: args?.maisEquilibrada === false ? "NORMAL" : "MORE_BALANCED",
          focusBrokerName: typeof args?.focoCorretor === "string" ? args.focoCorretor : null
        });
        return { terminal: true, response: toResponse(result) };
      }
    },
    {
      definition: {
        type: "function",
        function: {
          name: "propor_alteracoes",
          description:
            "Prepara troca ou retirada de corretores em uma ou mais janelas da escala publicada (pedido atômico). Informe local, dia (MONDAY..SUNDAY) e o novo corretor; deixe newBrokerName vazio para apenas retirar.",
          parameters: {
            type: "object",
            properties: {
              changes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    localName: { type: "string" },
                    dayOfWeek: {
                      type: "string",
                      enum: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
                    },
                    startHour: { type: "number" },
                    timeLabel: { type: "string" },
                    currentBrokerName: { type: "string" },
                    newBrokerName: { type: "string" }
                  }
                }
              }
            },
            required: ["changes"]
          }
        }
      },
      handler: async (args) => {
        const changes = Array.isArray(args?.changes) ? args.changes.map((item) => normalizeChange(item as Record<string, unknown>)) : [];
        const result = await analyzeScheduleChangeRequest(weekStart, command, changes);
        return { terminal: true, response: toResponse(result) };
      }
    }
  ];
}

export async function runScheduleAgent(command: string, weekStart: Date): Promise<AgentResponse> {
  const context = await buildFullAiContext();
  const response = await runAgent({
    system: agentSystemPrompt(),
    user: JSON.stringify({ pergunta: command, estadoAtual: context }),
    tools: buildAgentTools(command, weekStart),
    maxSteps: 6
  });
  const message = response.message.startsWith("IA:") ? response.message : `IA: ${response.message}`;
  return { ...response, message };
}
