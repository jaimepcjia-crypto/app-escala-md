import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth";
import { normalizeWeekStart } from "@/lib/constants";
import { getAdminSnapshot } from "@/lib/data";
import { requestLlmJson } from "@/lib/llm";
import { generateAndPublishSchedule } from "@/lib/schedule-actions";

async function interpretCommand(command: string) {
  const result = await requestLlmJson<{ action: string; focusBrokerName: string | null; shortReason: string }>({
    system:
      "Voce e a IA operacional do App Escala MD. O gerente Ferreira escreve ordens livres e voce decide autonomamente qual acao do app deve ser executada. Nao execute nada fora das acoes permitidas: apenas escolha uma acao e retorne JSON valido. Acoes permitidas: CHECK_UNAVAILABILITY verifica se todos informaram o NAO PODE; GENERATE_AND_PUBLISH gera e publica a escala; EXPLAIN_FAIRNESS explica por que a escala publicada esta justa; REGENERATE_MORE_BALANCED gera e publica outra versao buscando mais equilibrio; INVESTIGATE_BENEFIT_AND_REGENERATE investiga um corretor citado como possivelmente beneficiado e gera/publica outra versao; HELP responde quando a ordem nao pede uma acao executavel. Retorne somente JSON com action, focusBrokerName e shortReason.",
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
            "HELP"
          ]
        },
        focusBrokerName: { type: "STRING" },
        shortReason: { type: "STRING" }
      },
      required: ["action", "focusBrokerName", "shortReason"]
    }
  });
  const allowed = new Set([
    "CHECK_UNAVAILABILITY",
    "GENERATE_AND_PUBLISH",
    "EXPLAIN_FAIRNESS",
    "REGENERATE_MORE_BALANCED",
    "INVESTIGATE_BENEFIT_AND_REGENERATE",
    "HELP"
  ]);
  return {
    action: allowed.has(result.parsed.action) ? result.parsed.action : "HELP",
    focusBrokerName: result.parsed.focusBrokerName || null,
    shortReason: result.parsed.shortReason || "Comando interpretado pela IA."
  };
}

function reviewText(review: any) {
  if (!review) return "Ainda nao existe analise da IA para a escala publicada desta semana.";
  const recommendations = JSON.parse(review.recommendations || "[]") as string[];
  return [
    review.summary,
    review.meritocracy ? `Meritocracia: ${review.meritocracy}` : null,
    review.balance ? `Equilibrio: ${review.balance}` : null,
    review.conflicts ? `Conflitos: ${review.conflicts}` : null,
    recommendations.length ? `Sugestoes: ${recommendations.join(" | ")}` : null,
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
    if (!command) return NextResponse.json({ error: "Digite uma ordem para a IA." }, { status: 400 });

    const intent = await interpretCommand(command);

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
