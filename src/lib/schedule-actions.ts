import { prisma } from "@/lib/prisma";
import { listPlanningData } from "@/lib/data";
import { normalizeWeekStart } from "@/lib/constants";
import { generateSchedule } from "@/lib/scheduler";
import { latestConfirmedImport } from "@/lib/import-workflow";
import { currentSaoPauloDate, currentSaoPauloWeekStart, dateForWeekDay, generationWindowStatus, isWeekDayAfterDate } from "@/lib/deadlines";
import { buildBrokerStats, reviewScheduleWithLlm } from "@/lib/llm";
import { invalidatePendingChangeRequests } from "@/lib/ai-schedule-changes";
import { missingEffortBrokerNames } from "@/lib/effort-level";

export async function generateAndPublishSchedule(
  weekStartInput: string | Date,
  options: { balanceMode?: "NORMAL" | "MORE_BALANCED"; focusBrokerName?: string | null } = {}
) {
  const weekStart = normalizeWeekStart(weekStartInput);
  const generationGate = generationWindowStatus(weekStart);
  if (!generationGate.allowed) {
    throw Object.assign(new Error(generationGate.reason ?? "Geracao fora da janela permitida."), { status: 403, generationGate });
  }

  const confirmedImport = await latestConfirmedImport(weekStart);
  if (!confirmedImport) {
    throw Object.assign(new Error("Importe e confirme o arquivo semanal antes de gerar a escala."), { status: 400 });
  }

  const planningData = await listPlanningData(weekStart);
  const missingEffort = missingEffortBrokerNames(planningData.brokers);
  if (missingEffort.length) {
    throw Object.assign(
      new Error(`Classifique o nivel de esforco de todos os corretores ativos antes de gerar a escala: ${missingEffort.join(", ")}.`),
      { status: 409 }
    );
  }
  await invalidatePendingChangeRequests(weekStart);
  const focusBroker = options.focusBrokerName
    ? planningData.brokers.find((broker) => broker.name.toLowerCase() === options.focusBrokerName!.trim().toLowerCase())
    : null;
  const result = generateSchedule({
    ...planningData,
    weekStart,
    balanceMode: options.balanceMode ?? "NORMAL",
    deprioritizeBrokerIds: focusBroker ? [focusBroker.id] : []
  });
  const externalCells = confirmedImport.cells.filter((cell) => cell.ownerType === "EXTERNAL_IMPORTED" && cell.dayOfWeek && cell.shift);

  const schedule = await prisma.$transaction(async (tx) => {
    await tx.schedule.deleteMany({ where: { weekStart } });
    const externalCreates: {
      brokerId: null;
      dutyTypeId: string;
      dayOfWeek: string;
      shift: string;
      slot: number;
      assignmentType: string;
      importedCellId: string;
      sourceText: string | null;
      sourceColorHex: string | null;
      startHour: number | null;
      isViolation: boolean;
    }[] = [];
    let priority = 100;
    for (const cell of externalCells) {
      const name = cell.localName || "PLANTAO IMPORTADO";
      const upperName = name.toUpperCase();
      const isHeadquarters = upperName.includes("SEDE");
      const isCalling = upperName.includes("LIGAC");
      const duty = await tx.dutyType.upsert({
        where: { name },
        update: { name, priority, requiresExternal: !isHeadquarters && !isCalling, isHeadquarters, isCalling },
        create: {
          name,
          priority,
          requiresExternal: !isHeadquarters && !isCalling,
          isHeadquarters,
          headquartersSlot: null,
          isCalling
        }
      });
      priority += 1;
      externalCreates.push({
        brokerId: null,
        dutyTypeId: duty.id,
        dayOfWeek: cell.dayOfWeek ?? "MONDAY",
        shift: cell.shift ?? "MORNING",
        startHour: cell.startHour,
        slot: 1,
        assignmentType: "EXTERNAL_IMPORTED",
        importedCellId: cell.id,
        sourceText: cell.text,
        sourceColorHex: cell.colorHex,
        isViolation: false
      });
    }

    return tx.schedule.create({
      data: {
        weekStart,
        status: "PUBLISHED",
        importId: confirmedImport.id,
        publishedAt: new Date(),
        assignments: {
          create: [
            ...externalCreates,
            ...result.assignments.map((assignment) => ({
              brokerId: assignment.brokerId,
              dutyTypeId: assignment.dutyTypeId,
              dayOfWeek: assignment.dayOfWeek,
              shift: assignment.shift,
              startHour: assignment.startHour,
              slot: assignment.slot,
              assignmentType: assignment.assignmentType,
              importedCellId: assignment.importedCellId,
              sourceText: assignment.sourceText,
              sourceColorHex: assignment.sourceColorHex,
              isViolation: assignment.isViolation,
              violationReason: assignment.violationReason
            }))
          ]
        }
      },
      include: {
        assignments: { include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true } }
      }
    });
  });

  const aiReview = await reviewScheduleWithLlm({
    weekStart,
    assignments: schedule.assignments,
    conflicts: result.conflicts,
    brokerStats: buildBrokerStats(schedule.assignments)
  });
  const savedReview = await prisma.aiScheduleReview.create({
    data: {
      scheduleId: schedule.id,
      model: aiReview.model,
      status: aiReview.status,
      summary: aiReview.summary,
      balance: aiReview.balance,
      conflicts: aiReview.conflicts,
      rawJson: aiReview.rawJson,
      error: aiReview.error
    }
  });

  return { schedule: { ...schedule, aiReview: savedReview }, conflicts: result.conflicts, aiReview: savedReview };
}

function assignmentLocalName(assignment: { importedCell?: { localName?: string | null } | null; dutyType: { name: string } }) {
  return assignment.importedCell?.localName || assignment.dutyType.name;
}

function assignmentStartHour(assignment: { startHour?: number | null; importedCell?: { startHour?: number | null } | null; shift: string }) {
  return assignment.startHour ?? assignment.importedCell?.startHour ?? (assignment.shift === "MORNING" ? 8 : assignment.shift === "AFTERNOON" ? 12 : 20);
}

export async function redistributePublishedScheduleRemainder(
  weekStartInput: string | Date,
  options: { balanceMode?: "NORMAL" | "MORE_BALANCED"; focusBrokerName?: string | null } = {}
) {
  const weekStart = normalizeWeekStart(weekStartInput);
  const today = currentSaoPauloDate();
  if (weekStart.getTime() !== currentSaoPauloWeekStart().getTime()) {
    throw Object.assign(new Error("A redistribuicao parcial somente pode ser feita na escala em vigor."), { status: 400 });
  }

  const schedule = await prisma.schedule.findFirst({
    where: { weekStart, status: "PUBLISHED" },
    include: {
      assignments: { include: { dutyType: true, importedCell: true } }
    },
    orderBy: { publishedAt: "desc" }
  });
  if (!schedule) throw Object.assign(new Error("Nao existe escala publicada em vigor para redistribuir."), { status: 404 });

  const planningData = await listPlanningData(weekStart);
  const missingEffort = missingEffortBrokerNames(planningData.brokers);
  if (missingEffort.length) {
    throw Object.assign(
      new Error(`Classifique o nivel de esforco de todos os corretores ativos antes de redistribuir a escala: ${missingEffort.join(", ")}.`),
      { status: 409 }
    );
  }

  const futureAssignments = schedule.assignments.filter((assignment) =>
    assignment.assignmentType !== "EXTERNAL_IMPORTED" &&
    isWeekDayAfterDate(weekStart, assignment.dayOfWeek, today)
  );
  if (!futureAssignments.length) {
    throw Object.assign(new Error("Nao existem dias futuros nesta semana para redistribuir. O passado e o dia atual permanecem inalterados."), { status: 400 });
  }
  const preservedAssignments = schedule.assignments.filter((assignment) =>
    assignment.assignmentType !== "EXTERNAL_IMPORTED" &&
    !isWeekDayAfterDate(weekStart, assignment.dayOfWeek, today) &&
    assignment.brokerId
  );
  const publishedAssignments = await prisma.scheduleAssignment.findMany({
    where: {
      brokerId: { not: null },
      isViolation: false,
      assignmentType: { not: "EXTERNAL_IMPORTED" },
      schedule: { status: "PUBLISHED" }
    },
    select: { brokerId: true, dayOfWeek: true, schedule: { select: { weekStart: true } } }
  });
  const workedCounts = new Map<string, number>();
  for (const assignment of publishedAssignments) {
    if (!assignment.brokerId || dateForWeekDay(assignment.schedule.weekStart, assignment.dayOfWeek) > today) continue;
    workedCounts.set(assignment.brokerId, (workedCounts.get(assignment.brokerId) ?? 0) + 1);
  }
  const brokers = planningData.brokers.map((broker) => ({
    ...broker,
    autoHistoryTotal: workedCounts.get(broker.id) ?? 0
  }));
  const focusBroker = options.focusBrokerName
    ? brokers.find((broker) => broker.name.toLowerCase() === options.focusBrokerName!.trim().toLowerCase())
    : null;
  const result = generateSchedule({
    ...planningData,
    brokers,
    windows: planningData.windows.filter((window) => isWeekDayAfterDate(weekStart, window.dayOfWeek, today)),
    weekStart,
    balanceMode: options.balanceMode ?? "MORE_BALANCED",
    deprioritizeBrokerIds: focusBroker ? [focusBroker.id] : [],
    initialAssignments: preservedAssignments.map((assignment) => ({
      brokerId: assignment.brokerId!,
      dayOfWeek: assignment.dayOfWeek,
      startHour: assignmentStartHour(assignment),
      localName: assignmentLocalName(assignment)
    }))
  });

  await invalidatePendingChangeRequests(weekStart);
  const updatedSchedule = await prisma.$transaction(async (tx) => {
    await tx.aiScheduleReview.deleteMany({ where: { scheduleId: schedule.id } });
    await tx.scheduleAssignment.deleteMany({ where: { id: { in: futureAssignments.map((assignment) => assignment.id) } } });
    await tx.scheduleAssignment.createMany({
      data: result.assignments.map((assignment) => ({
        scheduleId: schedule.id,
        brokerId: assignment.brokerId,
        dutyTypeId: assignment.dutyTypeId,
        dayOfWeek: assignment.dayOfWeek,
        shift: assignment.shift,
        startHour: assignment.startHour,
        slot: assignment.slot,
        assignmentType: assignment.assignmentType,
        importedCellId: assignment.importedCellId,
        sourceText: assignment.sourceText,
        sourceColorHex: assignment.sourceColorHex,
        isViolation: assignment.isViolation,
        violationReason: assignment.violationReason
      }))
    });
    return tx.schedule.findUniqueOrThrow({
      where: { id: schedule.id },
      include: {
        assignments: { include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true } }
      }
    });
  }, { isolationLevel: "Serializable" });

  const aiReview = await reviewScheduleWithLlm({
    weekStart,
    assignments: updatedSchedule.assignments,
    conflicts: result.conflicts,
    brokerStats: buildBrokerStats(updatedSchedule.assignments)
  });
  const savedReview = await prisma.aiScheduleReview.create({
    data: {
      scheduleId: schedule.id,
      model: aiReview.model,
      status: aiReview.status,
      summary: aiReview.summary,
      balance: aiReview.balance,
      conflicts: aiReview.conflicts,
      rawJson: aiReview.rawJson,
      error: aiReview.error
    }
  });

  return {
    schedule: { ...updatedSchedule, aiReview: savedReview },
    conflicts: result.conflicts,
    aiReview: savedReview,
    preservedThrough: today.toISOString().slice(0, 10),
    redistributedAssignments: result.assignments.length
  };
}
