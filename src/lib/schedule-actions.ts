import { prisma } from "@/lib/prisma";
import { listPlanningData } from "@/lib/data";
import { normalizeWeekStart } from "@/lib/constants";
import { generateSchedule } from "@/lib/scheduler";
import { latestConfirmedImport } from "@/lib/import-workflow";
import { generationWindowStatus } from "@/lib/deadlines";
import { buildBrokerStatsWithRanks, reviewScheduleWithLlm } from "@/lib/llm";
import { invalidatePendingChangeRequests } from "@/lib/ai-schedule-changes";

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
    brokerStats: buildBrokerStatsWithRanks(
      schedule.assignments,
      new Map(planningData.brokers.map((broker) => [broker.id, broker.salesRank]))
    )
  });
  const savedReview = await prisma.aiScheduleReview.create({
    data: {
      scheduleId: schedule.id,
      model: aiReview.model,
      status: aiReview.status,
      summary: aiReview.summary,
      meritocracy: aiReview.meritocracy,
      balance: aiReview.balance,
      conflicts: aiReview.conflicts,
      rawJson: aiReview.rawJson,
      error: aiReview.error
    }
  });

  return { schedule: { ...schedule, aiReview: savedReview }, conflicts: result.conflicts, aiReview: savedReview };
}
