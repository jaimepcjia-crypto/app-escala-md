import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth";
import { aiScheduleWeekForCommand, generationWindowStatus, weeklyWorkflowStatus } from "@/lib/deadlines";
import { decideScheduleChangeRequest, invalidatePendingChangeRequests } from "@/lib/ai-schedule-changes";
import { directOperationalAction } from "@/lib/ai-command-intent";
import { runScheduleAgent } from "@/lib/ai-agent";

function textDecision(command: string) {
  const normalized = command.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  if (/^(sim|confirmo|confirme|pode confirmar|pode executar|execute|aplique)(\b|$)/.test(normalized)) return "CONFIRM" as const;
  if (/^(nao|cancele|cancelar|desista|nao confirme)(\b|$)/.test(normalized)) return "CANCEL" as const;
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  try {
    const body = await request.json();
    const command = String(body.command ?? "").trim();
    const weekStart = aiScheduleWeekForCommand(command);

    // 1) Decisão sobre proposta pendente (botão confirmar/cancelar ou "sim/não"). Único caminho que executa mutações.
    const explicitDecision = body.decision === "CONFIRM" || body.decision === "CANCEL" ? body.decision : null;
    const decision = explicitDecision ?? (command ? textDecision(command) : null);
    if (decision) {
      const result = await decideScheduleChangeRequest(weekStart, decision, body.requestId ? String(body.requestId) : null);
      return NextResponse.json({ ...result, data: result });
    }
    if (!command) return NextResponse.json({ error: "Digite uma ordem para a IA." }, { status: 400 });

    // 2) Cancelar publicação: ordem imperativa, determinística e protegida pela janela. Fora do agente para nunca ser auto-decidida.
    if (directOperationalAction(command) === "CANCEL_PUBLICATION") {
      const workflow = weeklyWorkflowStatus();
      const gate = generationWindowStatus(workflow.weekStartDate);
      if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 403 });
      const result = await prisma.schedule.updateMany({
        where: { weekStart: workflow.weekStartDate, status: "PUBLISHED" },
        data: { status: "DRAFT", publishedAt: null }
      });
      await invalidatePendingChangeRequests(workflow.weekStartDate);
      return NextResponse.json({
        message: result.count
          ? "IA: publicação cancelada. A escala saiu do ar e os corretores já podem editar as indisponibilidades desta semana de novo."
          : "IA: não havia escala publicada nesta semana para cancelar.",
        data: { canceled: result.count }
      });
    }

    // 3) IA central agêntica: recebe o estado completo (incl. nível de esforço, externo e histórico),
    //    analisa e responde qualquer pergunta sobre corretores/escala, e propõe ações (que exigem confirmação).
    const response = await runScheduleAgent(command, weekStart);
    return NextResponse.json(response);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na IA." }, { status });
  }
}
