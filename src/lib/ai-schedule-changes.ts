import { prisma } from "@/lib/prisma";
import { dateForWeekDay } from "@/lib/deadlines";
import { DAYS } from "@/lib/constants";
import { getAdminSnapshot } from "@/lib/data";

export type RequestedScheduleChange = {
  localName: string | null;
  dayOfWeek: string | null;
  startHour: number | null;
  timeLabel: string | null;
  currentBrokerName: string | null;
  newBrokerName: string | null;
};

type ResolvedChange = {
  assignmentId: string;
  expectedBrokerId: string | null;
  expectedBrokerName: string | null;
  newBrokerId: string | null;
  newBrokerName: string | null;
  localName: string;
  dayOfWeek: string;
  startHour: number;
  timeLabel: string | null;
  warnings: string[];
};

export function hardConstraintReasons(input: {
  brokerName: string;
  active: boolean;
  requiresExternal: boolean;
  canExternalDuty: boolean;
  unavailable: boolean;
  simultaneousCount: number;
}) {
  const reasons: string[] = [];
  if (!input.active) reasons.push(`${input.brokerName}: corretor inativo.`);
  if (input.requiresExternal && !input.canExternalDuty) reasons.push(`${input.brokerName}: corretor sem autorizacao para plantao externo.`);
  if (input.unavailable) reasons.push(`${input.brokerName}: corretor marcou indisponibilidade nesse horario.`);
  if (input.simultaneousCount > 1) reasons.push(`${input.brokerName}: corretor ficaria em dois plantoes no mesmo horario.`);
  return reasons;
}

function normalize(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function assignmentLocalName(item: { importedCell?: { localName?: string | null } | null; dutyType: { name: string } }) {
  return item.importedCell?.localName || item.dutyType.name;
}

const dayOrder: string[] = DAYS.map((item) => item.key);

function assignmentStartHour(item: { startHour?: number | null; importedCell?: { startHour?: number | null } | null; shift: string }) {
  if (item.startHour !== null && item.startHour !== undefined) return item.startHour;
  if (item.importedCell?.startHour !== null && item.importedCell?.startHour !== undefined) return item.importedCell.startHour;
  return item.shift === "MORNING" ? 8 : item.shift === "AFTERNOON" ? 12 : 20;
}

function formatChange(change: ResolvedChange) {
  const day = DAYS.find((item) => item.key === change.dayOfWeek)?.label ?? change.dayOfWeek;
  const time = change.timeLabel || `${String(change.startHour).padStart(2, "0")}:00`;
  return `${change.localName}, ${day}, ${time}: ${change.expectedBrokerName ?? "sem cobertura"} -> ${change.newBrokerName ?? "sem cobertura"}`;
}

async function publishedSchedule(weekStart: Date) {
  return prisma.schedule.findFirst({
    where: { weekStart, status: "PUBLISHED" },
    include: {
      assignments: {
        include: { broker: true, dutyType: true, importedCell: true }
      }
    },
    orderBy: { publishedAt: "desc" }
  });
}

function resolveBroker(
  brokers: Array<{ id: string; name: string; active: boolean; canExternalDuty: boolean }>,
  name: string | null
) {
  if (!name) return { broker: null, error: null };
  const wanted = normalize(name);
  const exact = brokers.filter((broker) => normalize(broker.name) === wanted);
  if (exact.length === 1) return { broker: exact[0], error: null };
  const partial = brokers.filter((broker) => normalize(broker.name).includes(wanted) || wanted.includes(normalize(broker.name)));
  if (partial.length === 1) return { broker: partial[0], error: null };
  return { broker: null, error: exact.length + partial.length === 0 ? `Corretor "${name}" nao encontrado.` : `O nome "${name}" identifica mais de um corretor.` };
}

export async function analyzeScheduleChangeRequest(weekStart: Date, command: string, requested: RequestedScheduleChange[]) {
  const schedule = await publishedSchedule(weekStart);
  if (!schedule) return { state: "BLOCKED" as const, message: "IA: nao existe escala publicada nesta semana para alterar." };
  if (!requested.length) return { state: "BLOCKED" as const, message: "IA: nao consegui identificar nenhuma alteracao pontual. Informe local, dia/horario e corretor." };
  requested = requested.map((item) => ({
    localName: item.localName || null,
    dayOfWeek: item.dayOfWeek || null,
    startHour: item.startHour !== null && item.startHour !== undefined && Number.isFinite(Number(item.startHour)) ? Number(item.startHour) : null,
    timeLabel: item.timeLabel || null,
    currentBrokerName: item.currentBrokerName || null,
    newBrokerName: item.newBrokerName || null
  }));

  const brokers = await prisma.broker.findMany({ where: { team: { isFerreira: true } }, include: { team: true } });
  const resolved: ResolvedChange[] = [];
  const errors: string[] = [];

  for (const change of requested) {
    const wantedLocal = normalize(change.localName);
    const wantedCurrent = normalize(change.currentBrokerName);
    const matches = schedule.assignments.filter((assignment) => {
      if (assignment.assignmentType === "EXTERNAL_IMPORTED") return false;
      if (wantedLocal && !normalize(assignmentLocalName(assignment)).includes(wantedLocal) && !wantedLocal.includes(normalize(assignmentLocalName(assignment)))) return false;
      if (change.dayOfWeek && assignment.dayOfWeek !== change.dayOfWeek) return false;
      if (change.startHour !== null && assignmentStartHour(assignment) !== change.startHour) return false;
      if (change.timeLabel) {
        const actualTime = normalize(assignment.importedCell?.timeLabel);
        const wantedTime = normalize(change.timeLabel);
        if (!actualTime.includes(wantedTime) && !wantedTime.includes(actualTime)) return false;
      }
      if (wantedCurrent && normalize(assignment.broker?.name) !== wantedCurrent) return false;
      return true;
    });
    if (matches.length !== 1) {
      errors.push(matches.length === 0
        ? `Nao encontrei uma janela para ${change.localName ?? "local nao informado"}, ${change.dayOfWeek ?? "dia nao informado"}, ${change.timeLabel ?? change.startHour ?? "horario nao informado"}.`
        : `O pedido para ${change.localName ?? "local nao informado"} e ambiguo: encontrei ${matches.length} janelas. Informe tambem o corretor atual ou o horario exato.`);
      continue;
    }
    const assignment = matches[0];
    const brokerResult = resolveBroker(brokers, change.newBrokerName);
    if (brokerResult.error) {
      errors.push(brokerResult.error);
      continue;
    }
    if (assignment.brokerId === (brokerResult.broker?.id ?? null)) {
      errors.push(`${assignmentLocalName(assignment)} ja esta atribuido a ${assignment.broker?.name ?? "sem cobertura"}.`);
      continue;
    }
    resolved.push({
      assignmentId: assignment.id,
      expectedBrokerId: assignment.brokerId,
      expectedBrokerName: assignment.broker?.name ?? null,
      newBrokerId: brokerResult.broker?.id ?? null,
      newBrokerName: brokerResult.broker?.name ?? null,
      localName: assignmentLocalName(assignment),
      dayOfWeek: assignment.dayOfWeek,
      startHour: assignmentStartHour(assignment),
      timeLabel: assignment.importedCell?.timeLabel ?? null,
      warnings: []
    });
  }

  if (errors.length) return { state: "BLOCKED" as const, message: `IA: nao posso preparar o pedido:\n- ${errors.join("\n- ")}` };
  if (new Set(resolved.map((item) => item.assignmentId)).size !== resolved.length) {
    return { state: "BLOCKED" as const, message: "IA: o pedido tenta alterar a mesma janela mais de uma vez. Reformule o pedido." };
  }

  const validation = await validateResolvedChanges(schedule, brokers, resolved);
  if (validation.hardBlocks.length) {
    return {
      state: "BLOCKED" as const,
      message: `IA: pedido bloqueado por trava absoluta:\n- ${validation.hardBlocks.join("\n- ")}${validation.hasUnavailability ? "\nA indisponibilidade somente pode ser alterada pelo proprio corretor. Depois disso, faca um novo pedido a IA." : ""}`
    };
  }

  const request = await prisma.$transaction(async (tx) => {
    await tx.aiScheduleChangeRequest.updateMany({
      where: { weekStart, status: "PENDING" },
      data: { status: "CANCELED", canceledAt: new Date() }
    });
    return tx.aiScheduleChangeRequest.create({
      data: {
        scheduleId: schedule.id,
        weekStart,
        command,
        proposedJson: JSON.stringify(validation.changes),
        analysisJson: JSON.stringify({ warnings: validation.changes.flatMap((item) => item.warnings) }),
        summary: validation.changes.map(formatChange).join("\n")
      }
    });
  });
  const warningLines = validation.changes.flatMap((item) => item.warnings.map((warning) => `${formatChange(item)} - ${warning}`));
  return {
    state: "CONFIRMATION_REQUIRED" as const,
    requestId: request.id,
    message: `IA: analise concluida. Nenhuma mudanca foi aplicada ainda.\n${validation.changes.map((item) => `- ${formatChange(item)}`).join("\n")}${warningLines.length ? `\n\nRessalvas aos criterios de distribuicao:\n- ${warningLines.join("\n- ")}` : "\n\nO pedido nao contraria os criterios flexiveis atuais."}\n\nConfirme ou cancele o pedido.`
  };
}

async function validateResolvedChanges(
  schedule: Awaited<ReturnType<typeof publishedSchedule>> & {},
  brokers: Array<{ id: string; name: string; active: boolean; canExternalDuty: boolean }>,
  inputChanges: ResolvedChange[]
) {
  const changes = inputChanges.map((item) => ({ ...item, warnings: [] as string[] }));
  const changeByAssignment = new Map(changes.map((change) => [change.assignmentId, change]));
  const hardBlocks: string[] = [];
  let hasUnavailability = false;
  const unavailabilities = await prisma.unavailability.findMany({
    where: { date: { gte: schedule.weekStart, lte: new Date(schedule.weekStart.getTime() + 6 * 86400000) } }
  });
  const brokerById = new Map(brokers.map((broker) => [broker.id, broker]));
  const finalRows = schedule.assignments
    .filter((item) => item.assignmentType !== "EXTERNAL_IMPORTED")
    .map((assignment) => {
      const change = changeByAssignment.get(assignment.id);
      return { assignment, brokerId: change ? change.newBrokerId : assignment.brokerId };
    });

  for (const change of changes) {
    if (!change.newBrokerId) continue;
    const assignment = schedule.assignments.find((item) => item.id === change.assignmentId)!;
    const broker = brokerById.get(change.newBrokerId);
    const date = dateForWeekDay(schedule.weekStart, assignment.dayOfWeek);
    const unavailable = unavailabilities.some((item) =>
      item.brokerId === change.newBrokerId &&
      item.date.getTime() === date.getTime() &&
      item.startHour !== null && item.endHour !== null &&
      change.startHour >= item.startHour && change.startHour < item.endHour
    );
    if (unavailable) {
      hasUnavailability = true;
      hardBlocks.push(`${formatChange(change)}: corretor marcou indisponibilidade nesse horario.`);
    }
    const simultaneous = finalRows.filter((row) =>
      row.brokerId === change.newBrokerId &&
      row.assignment.dayOfWeek === assignment.dayOfWeek &&
      assignmentStartHour(row.assignment) === change.startHour
    );
    hardBlocks.push(...hardConstraintReasons({
      brokerName: formatChange(change),
      active: Boolean(broker?.active),
      requiresExternal: assignment.dutyType.requiresExternal,
      canExternalDuty: Boolean(broker?.canExternalDuty),
      unavailable,
      simultaneousCount: simultaneous.length
    }));
  }

  const counts = new Map<string, number>();
  for (const row of finalRows) if (row.brokerId) counts.set(row.brokerId, (counts.get(row.brokerId) ?? 0) + 1);
  const activeIds = brokers.filter((broker) => broker.active).map((broker) => broker.id);
  const average = activeIds.length ? finalRows.filter((row) => row.brokerId).length / activeIds.length : 0;
  const snapshot = await getAdminSnapshot(schedule.weekStart.toISOString());
  const activeFerreiraSales = new Set(snapshot.brokers.filter((item) => item.team.isFerreira && item.active).map((item) => item.salesAmountCents));
  for (const change of changes) {
    if (!change.newBrokerId) continue;
    const broker = brokerById.get(change.newBrokerId)!;
    const count = counts.get(change.newBrokerId) ?? 0;
    if (count > average + 1) change.warnings.push(`Equilibrio contrariado: ${broker.name} ficara com ${count} plantoes, acima da media ${average.toFixed(1)}.`);
    const sameLocal = finalRows.filter((row) => row.brokerId === change.newBrokerId && assignmentLocalName(row.assignment) === change.localName).length;
    if (sameLocal > 1) change.warnings.push(`Concentracao por tipo: ${broker.name} ficara com ${sameLocal} plantoes em ${change.localName}.`);
    const sameDay = finalRows.filter((row) => row.brokerId === change.newBrokerId && row.assignment.dayOfWeek === change.dayOfWeek).length;
    if (sameDay > 1) change.warnings.push(`Distribuicao semanal contrariada: ${broker.name} ficara com ${sameDay} plantoes no mesmo dia.`);
    const priorityIndex = snapshot.plantaoPriorities.findIndex((item) => item.localName === change.localName);
    const brokerSnapshot = snapshot.brokers.find((item) => item.id === change.newBrokerId);
    if (activeFerreiraSales.size > 1 && priorityIndex >= 0 && priorityIndex < 3 && brokerSnapshot?.salesOrdinalStart) {
      const sameLocalRows = schedule.assignments.filter((item) => item.assignmentType !== "EXTERNAL_IMPORTED" && assignmentLocalName(item) === change.localName);
      const reservedCount = Math.ceil(sameLocalRows.length * 0.4);
      const ordered = [...sameLocalRows].sort((a, b) => dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek) || assignmentStartHour(a) - assignmentStartHour(b) || a.slot - b.slot);
      const index = ordered.findIndex((item) => item.id === change.assignmentId);
      const expectedStart = priorityIndex * 2 + 1;
      const expectedEnd = expectedStart + 1;
      if (index >= 0 && index < reservedCount && (
        (brokerSnapshot.salesOrdinalEnd ?? brokerSnapshot.salesOrdinalStart) < expectedStart ||
        brokerSnapshot.salesOrdinalStart > expectedEnd
      )) {
        change.warnings.push(`Meritocracia contrariada: esta vaga reservada prioriza a faixa ${expectedStart}o a ${expectedEnd}o.`);
      }
    }
  }
  return { changes, hardBlocks: [...new Set(hardBlocks)], hasUnavailability };
}

export async function decideScheduleChangeRequest(weekStart: Date, decision: "CONFIRM" | "CANCEL", requestId?: string | null) {
  const request = await prisma.aiScheduleChangeRequest.findFirst({
    where: { ...(requestId ? { id: requestId } : { weekStart, status: "PENDING" }) },
    orderBy: { createdAt: "desc" }
  });
  if (!request || request.status !== "PENDING") return { state: "BLOCKED" as const, message: "IA: nao existe pedido pendente valido para esta semana." };
  if (decision === "CANCEL") {
    await prisma.aiScheduleChangeRequest.update({ where: { id: request.id }, data: { status: "CANCELED", canceledAt: new Date() } });
    return { state: "CANCELED" as const, requestId: request.id, message: "IA: pedido cancelado. Nenhuma mudanca foi aplicada." };
  }

  const proposed = JSON.parse(request.proposedJson) as ResolvedChange[];
  const schedule = await publishedSchedule(weekStart);
  if (!schedule || schedule.id !== request.scheduleId) {
    await prisma.aiScheduleChangeRequest.update({ where: { id: request.id }, data: { status: "STALE" } });
    return { state: "BLOCKED" as const, message: "IA: a escala mudou desde a analise. Faca um novo pedido." };
  }
  const brokers = await prisma.broker.findMany({ where: { team: { isFerreira: true } }, include: { team: true } });
  const stale = proposed.some((change) => schedule.assignments.find((item) => item.id === change.assignmentId)?.brokerId !== change.expectedBrokerId);
  if (stale) {
    await prisma.aiScheduleChangeRequest.update({ where: { id: request.id }, data: { status: "STALE" } });
    return { state: "BLOCKED" as const, message: "IA: uma das janelas mudou desde a analise. Faca um novo pedido." };
  }
  const validation = await validateResolvedChanges(schedule, brokers, proposed);
  if (validation.hardBlocks.length) {
    await prisma.aiScheduleChangeRequest.update({ where: { id: request.id }, data: { status: "BLOCKED" } });
    return { state: "BLOCKED" as const, message: `IA: a confirmacao foi bloqueada porque surgiu uma trava absoluta:\n- ${validation.hardBlocks.join("\n- ")}` };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const currentSchedule = await tx.schedule.findUnique({
        where: { id: schedule.id },
        include: { assignments: { include: { dutyType: true, importedCell: true } } }
      });
      if (!currentSchedule || currentSchedule.status !== "PUBLISHED") throw new Error("STALE: a escala nao esta mais publicada.");
      const targetBrokerIds = validation.changes.map((item) => item.newBrokerId).filter(Boolean) as string[];
      const currentBrokers = await tx.broker.findMany({ where: { id: { in: targetBrokerIds }, team: { isFerreira: true } } });
      const currentBrokerById = new Map(currentBrokers.map((broker) => [broker.id, broker]));
      const currentChangeByAssignment = new Map(validation.changes.map((item) => [item.assignmentId, item]));
      const finalRows = currentSchedule.assignments
        .filter((item) => item.assignmentType !== "EXTERNAL_IMPORTED")
        .map((assignment) => ({
          assignment,
          brokerId: currentChangeByAssignment.has(assignment.id) ? currentChangeByAssignment.get(assignment.id)!.newBrokerId : assignment.brokerId
        }));

      for (const change of validation.changes) {
        const assignment = currentSchedule.assignments.find((item) => item.id === change.assignmentId);
        if (!assignment || assignment.brokerId !== change.expectedBrokerId) throw new Error("STALE: uma janela mudou desde a analise.");
        if (!change.newBrokerId) continue;
        const broker = currentBrokerById.get(change.newBrokerId);
        const unavailable = await tx.unavailability.findFirst({
          where: {
            brokerId: change.newBrokerId,
            date: dateForWeekDay(currentSchedule.weekStart, assignment.dayOfWeek),
            startHour: { lte: change.startHour },
            endHour: { gt: change.startHour }
          }
        });
        const simultaneous = finalRows.filter((row) =>
          row.brokerId === change.newBrokerId &&
          row.assignment.dayOfWeek === assignment.dayOfWeek &&
          assignmentStartHour(row.assignment) === change.startHour
        );
        const reasons = hardConstraintReasons({
          brokerName: change.newBrokerName ?? "Corretor",
          active: Boolean(broker?.active),
          requiresExternal: assignment.dutyType.requiresExternal,
          canExternalDuty: Boolean(broker?.canExternalDuty),
          unavailable: Boolean(unavailable),
          simultaneousCount: simultaneous.length
        });
        if (reasons.length) throw new Error(`HARD: ${reasons[0]}`);
      }

      for (const change of validation.changes) {
        const reasons = [
          `Mudanca confirmada pelo gerente via IA: ${change.expectedBrokerName ?? "sem cobertura"} -> ${change.newBrokerName ?? "sem cobertura"}.`,
          ...change.warnings
        ];
        await tx.manualAdjustmentAlert.deleteMany({ where: { assignmentId: change.assignmentId } });
        await tx.scheduleAssignment.update({
          where: { id: change.assignmentId },
          data: {
            brokerId: change.newBrokerId,
            assignmentType: "FERREIRA_MANAGER_AI",
            isViolation: false,
            violationReason: null,
            balanceAlert: change.warnings.join(" | ") || null
          }
        });
        for (const reason of reasons) await tx.manualAdjustmentAlert.create({ data: { assignmentId: change.assignmentId, reason } });
        await tx.scheduleChangeNotice.create({
          data: {
            scheduleId: schedule.id,
            requestId: request.id,
            assignmentId: change.assignmentId,
            previousBrokerName: change.expectedBrokerName,
            newBrokerName: change.newBrokerName,
            localName: change.localName,
            dayOfWeek: change.dayOfWeek,
            timeLabel: change.timeLabel,
            startHour: change.startHour,
            warningsJson: JSON.stringify(change.warnings)
          }
        });
      }
      await tx.aiScheduleChangeRequest.update({ where: { id: request.id }, data: { status: "EXECUTED", confirmedAt: new Date() } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A confirmacao falhou.";
    if (message.startsWith("HARD:") || message.startsWith("STALE:")) {
      await prisma.aiScheduleChangeRequest.update({ where: { id: request.id }, data: { status: message.startsWith("STALE:") ? "STALE" : "BLOCKED" } });
      return { state: "BLOCKED" as const, message: `IA: confirmacao bloqueada. ${message.replace(/^(HARD|STALE):\s*/, "")}` };
    }
    throw error;
  }
  return { state: "EXECUTED" as const, requestId: request.id, message: `IA: pedido confirmado e aplicado.\n- ${validation.changes.map(formatChange).join("\n- ")}` };
}

export async function invalidatePendingChangeRequests(weekStart: Date) {
  await prisma.aiScheduleChangeRequest.updateMany({
    where: { weekStart, status: "PENDING" },
    data: { status: "STALE" }
  });
}
