import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth";
import { aiScheduleWeekForCommand, currentSaoPauloDate, dateOnly, generationWindowStatus, weeklyWorkflowStatus } from "@/lib/deadlines";
import { getAdminSnapshot } from "@/lib/data";
import { requestLlmJson } from "@/lib/llm";
import { generateAndPublishSchedule, redistributePublishedScheduleRemainder } from "@/lib/schedule-actions";
import { analyzeScheduleChangeRequest, decideScheduleChangeRequest, invalidatePendingChangeRequests, type RequestedScheduleChange } from "@/lib/ai-schedule-changes";
import { answerBrokerOperationalQuestion } from "@/lib/ai-operational-questions";
import { answerAppQuestion, type AppAssistantContext } from "@/lib/app-assistant";
import { directOperationalAction } from "@/lib/ai-command-intent";
import { isHistoricalAssignmentQuestion, queryHistoricalAssignments, type HistoricalAssignmentFilters } from "@/lib/historical-assignments";

function normalizedText(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
}

async function extractHistoricalFilters(command: string) {
  const today = dateOnly(currentSaoPauloDate());
  const [brokers, assignments] = await Promise.all([
    prisma.broker.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.scheduleAssignment.findMany({
      where: { schedule: { status: "PUBLISHED" }, assignmentType: { not: "EXTERNAL_IMPORTED" } },
      select: { dutyType: { select: { name: true } }, importedCell: { select: { localName: true } } }
    })
  ]);
  const brokerNames = brokers.map((item) => item.name);
  const localNames = [...new Set(assignments.map((item) => item.importedCell?.localName || item.dutyType.name))].sort();
  const result = await requestLlmJson<HistoricalAssignmentFilters & { needsClarification: boolean; clarification: string | null }>({
    system:
      `Extraia filtros para consultar o historico de plantoes publicados do App Escala MD. Hoje e ${today}. Corretores existentes: ${brokerNames.join(", ")}. Plantoes existentes: ${localNames.join(", ")}. brokerName e localName sao opcionais; nunca solicite esclarecimento apenas porque um deles foi omitido. Converta periodos relativos como ultimos 30 dias, ultimos 6 meses, este ano ou mes passado em startDate e endDate no formato YYYY-MM-DD. "Todo o historico" significa datas nulas e needsClarification false. Somente marque needsClarification true quando o usuario mencionar explicitamente um periodo, mas nao disser qual. Nao invente corretor, plantao ou periodo. Retorne somente um objeto json valido com brokerName, localName, startDate, endDate, needsClarification e clarification.`,
    user: command,
    schema: {
      type: "OBJECT",
      properties: {
        brokerName: { type: "STRING" },
        localName: { type: "STRING" },
        startDate: { type: "STRING" },
        endDate: { type: "STRING" },
        needsClarification: { type: "BOOLEAN" },
        clarification: { type: "STRING" }
      },
      required: ["brokerName", "localName", "startDate", "endDate", "needsClarification", "clarification"]
    }
  });
  const value = result.parsed;
  const validDate = (date: unknown) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const normalizedCommand = normalizedText(command);
  const brokerName = brokerNames.find((name) => normalizedCommand.includes(normalizedText(name))) ?? value.brokerName ?? null;
  const localName = [...localNames].sort((left, right) => right.length - left.length).find((name) => normalizedCommand.includes(normalizedText(name))) ?? value.localName ?? null;
  const allHistory = /\b(todo|todo o|desde o inicio)\s+(historico|periodo)\b/.test(normalizedCommand);
  const vaguePeriod = /\b(por|em|durante)\s+(um|algum|certo)\s+periodo\b/.test(normalizedCommand);
  const startDate = validDate(value.startDate);
  const endDate = validDate(value.endDate);
  const needsClarification = !allHistory && vaguePeriod && !startDate && !endDate;
  return {
    brokerName,
    localName,
    startDate: allHistory ? null : startDate,
    endDate: allHistory ? null : endDate,
    needsClarification,
    clarification: needsClarification ? value.clarification || "Qual período você deseja consultar?" : null
  };
}

async function interpretCommand(command: string) {
  const result = await requestLlmJson<{ action: string; focusBrokerName: string | null; shortReason: string; changes?: RequestedScheduleChange[] }>({
    system:
      "Voce classifica mensagens do gerente no App Escala MD. Acoes no motor so podem ser escolhidas quando o gerente der uma ordem inequívoca para executar ou analisar uma operacao. Perguntas, duvidas, pedidos de explicacao e frases interrogativas devem ser ANSWER_APP_QUESTION, mesmo quando mencionarem publicar, gerar, cancelar ou alterar. CHANGE_ASSIGNMENTS representa ordens pontuais para colocar, retirar ou trocar corretores em uma ou varias janelas. Para cada mudanca, extraia localName, dayOfWeek (MONDAY a SUNDAY), startHour numerico quando informado, timeLabel quando informado, currentBrokerName quando informado e newBrokerName; para retirar deixe newBrokerName nulo. Nao invente detalhes ausentes. Outras acoes operacionais: CHECK_UNAVAILABILITY, GENERATE_AND_PUBLISH, EXPLAIN_FAIRNESS, REGENERATE_MORE_BALANCED, INVESTIGATE_BENEFIT_AND_REGENERATE e CANCEL_PUBLICATION. Use ANSWER_APP_QUESTION para qualquer duvida sobre o app e HELP apenas para mensagens sem sentido. Retorne somente um objeto json valido com action, focusBrokerName, shortReason e changes.",
    user: command,
    schema: {
      type: "OBJECT",
      properties: {
        action: {
          type: "STRING",
          enum: [
            "CHECK_UNAVAILABILITY",
            "GENERATE_AND_PUBLISH",
            "EXPLAIN_FAIRNESS",
            "REGENERATE_MORE_BALANCED",
            "INVESTIGATE_BENEFIT_AND_REGENERATE",
            "CANCEL_PUBLICATION",
            "CHANGE_ASSIGNMENTS",
            "ANSWER_APP_QUESTION",
            "HELP"
          ]
        },
        focusBrokerName: { type: "STRING" },
        shortReason: { type: "STRING" }
        ,
        changes: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              localName: { type: "STRING" },
              dayOfWeek: { type: "STRING" },
              startHour: { type: "NUMBER" },
              timeLabel: { type: "STRING" },
              currentBrokerName: { type: "STRING" },
              newBrokerName: { type: "STRING" }
            }
          }
        }
      },
      required: ["action", "focusBrokerName", "shortReason", "changes"]
    }
  });
  const allowed = new Set([
    "CHECK_UNAVAILABILITY",
    "GENERATE_AND_PUBLISH",
    "EXPLAIN_FAIRNESS",
    "REGENERATE_MORE_BALANCED",
    "INVESTIGATE_BENEFIT_AND_REGENERATE",
    "CANCEL_PUBLICATION",
    "CHANGE_ASSIGNMENTS",
    "ANSWER_APP_QUESTION",
    "HELP"
  ]);
  return {
    action: allowed.has(result.parsed.action) ? result.parsed.action : "HELP",
    focusBrokerName: result.parsed.focusBrokerName || null,
    shortReason: result.parsed.shortReason || "Comando interpretado pela IA.",
    changes: Array.isArray(result.parsed.changes) ? result.parsed.changes : []
  };
}

function textDecision(command: string) {
  const normalized = command.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  if (/^(sim|confirmo|confirme|pode confirmar|pode executar|execute|aplique)(\b|$)/.test(normalized)) return "CONFIRM" as const;
  if (/^(nao|cancele|cancelar|desista|nao confirme)(\b|$)/.test(normalized)) return "CANCEL" as const;
  return null;
}

function reviewText(review: any) {
  if (!review) return "Ainda nao existe analise da IA para a escala publicada desta semana.";
  return [
    review.summary,
    review.balance ? `Equilibrio: ${review.balance}` : null,
    review.conflicts ? `Conflitos: ${review.conflicts}` : null,
    review.error ? `Erro da IA: ${review.error}` : null
  ].filter(Boolean).join("\n");
}

async function buildAppAssistantContext(): Promise<AppAssistantContext> {
  const workflow = weeklyWorkflowStatus();
  const [brokers, nextImport, currentSchedule, nextSchedule, priorities, confirmations] = await Promise.all([
    prisma.broker.findMany({ include: { team: true } }),
    prisma.scheduleImport.findFirst({ where: { weekStart: workflow.weekStartDate }, orderBy: { createdAt: "desc" } }),
    prisma.schedule.findFirst({
      where: { weekStart: workflow.currentWeekStartDate, status: "PUBLISHED" },
      include: { assignments: { include: { manualAlerts: true } } },
      orderBy: { publishedAt: "desc" }
    }),
    prisma.schedule.findFirst({ where: { weekStart: workflow.weekStartDate, status: "PUBLISHED" }, select: { id: true } }),
    prisma.dutyPriority.findMany({ orderBy: [{ position: "asc" }, { localName: "asc" }] }),
    prisma.unavailabilityConfirmation.findMany({ where: { weekStart: workflow.weekStartDate }, select: { brokerId: true } })
  ]);
  const activeFerreira = brokers.filter((broker) => broker.active && broker.team.isFerreira);
  const currentAssignments = currentSchedule?.assignments ?? [];
  return {
    workflow: {
      isOpen: workflow.isOpen,
      currentWeekStart: workflow.currentWeekStart,
      currentWeekEnd: workflow.currentWeekEnd,
      nextWeekStart: workflow.weekStart,
      nextWeekEnd: workflow.weekEnd,
      opensOn: workflow.opensOn,
      daysUntilOpen: workflow.daysUntilOpen
    },
    brokers: {
      activeFerreira: activeFerreira.length,
      inactiveFerreira: brokers.filter((broker) => !broker.active && broker.team.isFerreira).length,
      authorizedForExternal: activeFerreira.filter((broker) => broker.canExternalDuty).length
    },
    nextWeek: {
      availabilityConfirmed: new Set(confirmations.map((item) => item.brokerId)).size,
      availabilityTotal: activeFerreira.length,
      importStatus: nextImport?.status ?? "NOT_SENT",
      importFileName: nextImport?.fileName ?? null,
      published: Boolean(nextSchedule)
    },
    currentWeek: {
      published: Boolean(currentSchedule),
      totalAssignments: currentAssignments.length,
      ferreiraAssignments: currentAssignments.filter((item) => item.assignmentType !== "EXTERNAL_IMPORTED").length,
      externalImportedAssignments: currentAssignments.filter((item) => item.assignmentType === "EXTERNAL_IMPORTED").length,
      uncoveredAssignments: currentAssignments.filter((item) => item.assignmentType !== "EXTERNAL_IMPORTED" && !item.brokerId).length,
      alerts: currentAssignments.reduce((total, item) => total + item.manualAlerts.length + (item.isViolation ? 1 : 0), 0)
    },
    priorities: priorities.map((item) => item.localName)
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  try {
    const body = await request.json();
    const command = String(body.command ?? "").trim();
    const weekStart = aiScheduleWeekForCommand(command);

    const explicitDecision = body.decision === "CONFIRM" || body.decision === "CANCEL" ? body.decision : null;
    const decision = explicitDecision ?? (command ? textDecision(command) : null);
    if (decision) {
      const result = await decideScheduleChangeRequest(weekStart, decision, body.requestId ? String(body.requestId) : null);
      return NextResponse.json({ ...result, data: result });
    }
    if (!command) return NextResponse.json({ error: "Digite uma ordem para a IA." }, { status: 400 });

    if (isHistoricalAssignmentQuestion(command)) {
      const filters = await extractHistoricalFilters(command);
      if (filters.needsClarification) {
        return NextResponse.json({
          intent: { action: "HISTORICAL_ASSIGNMENT_QUERY", focusBrokerName: filters.brokerName, shortReason: "Consulta histórica precisa de mais detalhes.", changes: [] },
          state: "BLOCKED",
          message: `IA: ${filters.clarification ?? "informe o período desejado para a consulta histórica."}`,
          data: { filters }
        });
      }
      const result = await queryHistoricalAssignments(filters);
      return NextResponse.json({
        intent: { action: "HISTORICAL_ASSIGNMENT_QUERY", focusBrokerName: filters.brokerName, shortReason: "Consulta calculada diretamente no histórico publicado.", changes: [] },
        ...result,
        data: "data" in result ? result.data : { filters }
      });
    }

    const operationalBrokers = await prisma.broker.findMany({ include: { team: true }, orderBy: { name: "asc" } });
    const operationalAnswer = answerBrokerOperationalQuestion(command, operationalBrokers);
    if (operationalAnswer) {
      const activeFerreiraBrokers = operationalBrokers.filter((broker) => broker.active && broker.team.isFerreira).length;
      return NextResponse.json({
        intent: { action: "ANSWER_OPERATIONAL_QUESTION", focusBrokerName: null, shortReason: "Pergunta respondida com os dados atuais do cadastro.", changes: [] },
        message: operationalAnswer,
        data: { activeFerreiraBrokers }
      });
    }

    const directAction = directOperationalAction(command);
    const intent = directAction
      ? { action: directAction, focusBrokerName: null, shortReason: "Ordem operacional inequívoca.", changes: [] }
      : await interpretCommand(command);

    if (intent.action === "CHANGE_ASSIGNMENTS") {
      const result = await analyzeScheduleChangeRequest(weekStart, command, intent.changes);
      return NextResponse.json({ intent, ...result, data: result });
    }

    if (intent.action === "CHECK_UNAVAILABILITY") {
      const snapshot = await getAdminSnapshot(weekStart.toISOString());
      const pending = snapshot.brokers
        .filter((broker) => broker.team.isFerreira && broker.active)
        .filter((broker) => !snapshot.confirmations.some((confirmation) => confirmation.brokerId === broker.id))
        .map((broker) => broker.name);
      return NextResponse.json({
        intent,
        message: snapshot.readiness.allConfirmed
          ? "IA: todos os corretores ativos da equipe Ferreira ja informaram o NAO PODE desta semana."
          : `IA: ainda faltam ${pending.length} corretor(es): ${pending.join(", ")}.`,
        data: { readiness: snapshot.readiness, pending }
      });
    }

    if (intent.action === "GENERATE_AND_PUBLISH") {
      const result = await generateAndPublishSchedule(weeklyWorkflowStatus().weekStartDate);
      return NextResponse.json({
        intent,
        message: result.conflicts.length
          ? `IA: escala gerada e publicada com ${result.conflicts.length} conflito(s).`
          : "IA: escala gerada e publicada sem conflitos.",
        data: result
      });
    }

    if (intent.action === "CANCEL_PUBLICATION") {
      const workflow = weeklyWorkflowStatus();
      const gate = generationWindowStatus(workflow.weekStartDate);
      if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 403 });
      // Tira a escala da semana do ar: PUBLISHED -> DRAFT (1 schedule por semana).
      const result = await prisma.schedule.updateMany({
        where: { weekStart: workflow.weekStartDate, status: "PUBLISHED" },
        data: { status: "DRAFT", publishedAt: null }
      });
      await invalidatePendingChangeRequests(workflow.weekStartDate);
      return NextResponse.json({
        intent,
        message: result.count
          ? "IA: publicação cancelada. A escala saiu do ar e os corretores já podem editar as indisponibilidades desta semana de novo."
          : "IA: não havia escala publicada nesta semana para cancelar.",
        data: { canceled: result.count }
      });
    }

    if (intent.action === "REGENERATE_MORE_BALANCED") {
      const workflow = weeklyWorkflowStatus();
      const isCurrentWeek = weekStart.getTime() === workflow.currentWeekStartDate.getTime();
      const result = isCurrentWeek
        ? await redistributePublishedScheduleRemainder(weekStart, { balanceMode: "MORE_BALANCED" })
        : await generateAndPublishSchedule(weekStart, { balanceMode: "MORE_BALANCED" });
      return NextResponse.json({
        intent,
        message: isCurrentWeek
          ? `IA: preservei integralmente todos os plantoes ate o fim de hoje e redistribui somente os dias seguintes usando a prioridade atual dos plantoes.${result.conflicts.length ? ` Existem ${result.conflicts.length} conflito(s).` : ""}`
          : result.conflicts.length
            ? `IA: gerei e publiquei uma nova versao buscando mais equilibrio, com ${result.conflicts.length} conflito(s).`
            : "IA: gerei e publiquei uma nova versao buscando mais equilibrio.",
        data: result
      });
    }

    if (intent.action === "INVESTIGATE_BENEFIT_AND_REGENERATE") {
      const workflow = weeklyWorkflowStatus();
      const isCurrentWeek = weekStart.getTime() === workflow.currentWeekStartDate.getTime();
      const result = isCurrentWeek
        ? await redistributePublishedScheduleRemainder(weekStart, { balanceMode: "MORE_BALANCED", focusBrokerName: intent.focusBrokerName })
        : await generateAndPublishSchedule(weekStart, { balanceMode: "MORE_BALANCED", focusBrokerName: intent.focusBrokerName });
      return NextResponse.json({
        intent,
        message: isCurrentWeek
          ? `IA: preservei integralmente todos os plantoes ate o fim de hoje e redistribui somente os dias seguintes${intent.focusBrokerName ? ` considerando o possivel beneficio de ${intent.focusBrokerName}` : ""}.`
          : intent.focusBrokerName
            ? `IA: revisei o possivel beneficio de ${intent.focusBrokerName}, gerei outra escala com maior equilibrio e publiquei.`
            : "IA: gerei outra escala com maior equilibrio, mas nao identifiquei o nome do corretor citado.",
        data: result
      });
    }

    if (intent.action === "EXPLAIN_FAIRNESS") {
      const schedule = await prisma.schedule.findFirst({
        where: { weekStart, status: "PUBLISHED" },
        include: { aiReview: true },
        orderBy: { publishedAt: "desc" }
      });
      return NextResponse.json({
        intent,
        message: `IA:\n${reviewText(schedule?.aiReview)}`,
        data: { aiReview: schedule?.aiReview ?? null }
      });
    }

    if (intent.action === "ANSWER_APP_QUESTION" || intent.action === "HELP") {
      const answer = await answerAppQuestion(command, await buildAppAssistantContext());
      return NextResponse.json({
        intent,
        message: `IA: ${answer}`,
        data: { informational: true }
      });
    }

    return NextResponse.json({
      intent,
      message:
        "IA: não consegui identificar o que você deseja. Informe o pedido com mais detalhes. Exemplos: “quantos corretores estão ativos?”, “verifique o NÃO PODE” ou “troque Ana por Bruno na segunda às 8h”."
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na IA." }, { status });
  }
}
