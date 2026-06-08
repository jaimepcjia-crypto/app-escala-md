import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth";
import { normalizeWeekStart } from "@/lib/constants";
import { getAdminSnapshot } from "@/lib/data";
import { requestLlmJson } from "@/lib/llm";
import { generateAndPublishSchedule } from "@/lib/schedule-actions";
import { analyzeScheduleChangeRequest, decideScheduleChangeRequest, invalidatePendingChangeRequests, type RequestedScheduleChange } from "@/lib/ai-schedule-changes";

async function interpretCommand(command: string) {
  const result = await requestLlmJson<{ action: string; focusBrokerName: string | null; shortReason: string; changes?: RequestedScheduleChange[] }>({
    system:
      "Voce e a IA operacional do App Escala MD. Escolha somente uma acao permitida e retorne JSON valido. CHANGE_ASSIGNMENTS representa pedidos pontuais para colocar, retirar ou trocar corretores em uma ou varias janelas. Para cada mudanca, extraia localName, dayOfWeek (MONDAY a SUNDAY), startHour numerico quando informado, timeLabel quando informado, currentBrokerName quando informado e newBrokerName; para retirar deixe newBrokerName nulo. Nao invente detalhes ausentes. Outras acoes: CHECK_UNAVAILABILITY, GENERATE_AND_PUBLISH, EXPLAIN_FAIRNESS, REGENERATE_MORE_BALANCED, INVESTIGATE_BENEFIT_AND_REGENERATE, CANCEL_PUBLICATION e HELP. Retorne somente JSON com action, focusBrokerName, shortReason e changes.",
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
    review.meritocracy ? `Meritocracia: ${review.meritocracy}` : null,
    review.balance ? `Equilibrio: ${review.balance}` : null,
    review.conflicts ? `Conflitos: ${review.conflicts}` : null,
    review.error ? `Erro da IA: ${review.error}` : null
  ].filter(Boolean).join("\n");
}

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  try {
    const body = await request.json();
    const command = String(body.command ?? "").trim();
    const weekStart = normalizeWeekStart(body.weekStart);

    const explicitDecision = body.decision === "CONFIRM" || body.decision === "CANCEL" ? body.decision : null;
    const decision = explicitDecision ?? (command ? textDecision(command) : null);
    if (decision) {
      const result = await decideScheduleChangeRequest(weekStart, decision, body.requestId ? String(body.requestId) : null);
      return NextResponse.json({ ...result, data: result });
    }
    if (!command) return NextResponse.json({ error: "Digite uma ordem para a IA." }, { status: 400 });

    const intent = await interpretCommand(command);

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
      const result = await generateAndPublishSchedule(weekStart);
      return NextResponse.json({
        intent,
        message: result.conflicts.length
          ? `IA: escala gerada e publicada com ${result.conflicts.length} conflito(s).`
          : "IA: escala gerada e publicada sem conflitos.",
        data: result
      });
    }

    if (intent.action === "CANCEL_PUBLICATION") {
      // Tira a escala da semana do ar: PUBLISHED -> DRAFT (1 schedule por semana).
      const result = await prisma.schedule.updateMany({
        where: { weekStart, status: "PUBLISHED" },
        data: { status: "DRAFT", publishedAt: null }
      });
      await invalidatePendingChangeRequests(weekStart);
      return NextResponse.json({
        intent,
        message: result.count
          ? "IA: publicação cancelada. A escala saiu do ar e os corretores já podem editar as indisponibilidades desta semana de novo."
          : "IA: não havia escala publicada nesta semana para cancelar.",
        data: { canceled: result.count }
      });
    }

    if (intent.action === "REGENERATE_MORE_BALANCED") {
      const result = await generateAndPublishSchedule(weekStart, { balanceMode: "MORE_BALANCED" });
      return NextResponse.json({
        intent,
        message: result.conflicts.length
          ? `IA: gerei e publiquei uma nova versao buscando mais equilibrio, com ${result.conflicts.length} conflito(s).`
          : "IA: gerei e publiquei uma nova versao buscando mais equilibrio.",
        data: result
      });
    }

    if (intent.action === "INVESTIGATE_BENEFIT_AND_REGENERATE") {
      const result = await generateAndPublishSchedule(weekStart, { balanceMode: "MORE_BALANCED", focusBrokerName: intent.focusBrokerName });
      return NextResponse.json({
        intent,
        message: intent.focusBrokerName
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

    return NextResponse.json({
      intent,
      message:
        "IA: posso verificar o NAO PODE, gerar/publicar escala, explicar a justica da escala, gerar novamente com mais equilibrio ou revisar um corretor possivelmente beneficiado."
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na IA." }, { status });
  }
}
