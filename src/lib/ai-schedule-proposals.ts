import { prisma } from "@/lib/prisma";
import { normalizeWeekStart } from "@/lib/constants";
import { listPlanningData } from "@/lib/data";
import { generateSchedule, type GeneratedAssignment, type SchedulingConflict } from "@/lib/scheduler";
import { latestConfirmedImport } from "@/lib/import-workflow";
import { currentSaoPauloDate, currentSaoPauloWeekStart, dateForWeekDay, generationWindowStatus, isWeekDayAfterDate } from "@/lib/deadlines";
import { missingEffortBrokerNames } from "@/lib/effort-level";
import { auditDistributionScenarios, publishedFerreiraHistory, type AuditRow } from "@/lib/distribution-audit";
import { scheduleStateFingerprint } from "@/lib/proposal-state";
import { buildBrokerStats, reviewScheduleWithLlm } from "@/lib/llm";

type ProposalOptions = { balanceMode?: "NORMAL" | "MORE_BALANCED"; focusBrokerName?: string | null };

type InitialProposal = {
  kind: "INITIAL_GENERATION";
  importId: string;
  assignments: GeneratedAssignment[];
  externalCells: Array<{ id: string; localName: string | null; dayOfWeek: string; shift: string; startHour: number | null; text: string | null; colorHex: string | null }>;
  conflicts: SchedulingConflict[];
};

type RemainderProposal = {
  kind: "REMAINDER_REDISTRIBUTION";
  scheduleId: string;
  replaceAssignmentIds: string[];
  assignments: GeneratedAssignment[];
  conflicts: SchedulingConflict[];
  preservedThrough: string;
  notices: Array<{ previousBrokerName: string | null; newBrokerName: string | null; localName: string; dayOfWeek: string; timeLabel: string | null; startHour: number | null }>;
};

export type GeneratedScheduleProposal = InitialProposal | RemainderProposal;

function localName(assignment: { importedCell?: { localName?: string | null } | null; dutyType: { name: string } }) {
  return assignment.importedCell?.localName || assignment.dutyType.name;
}

function startHour(assignment: { startHour?: number | null; importedCell?: { startHour?: number | null } | null; shift: string }) {
  return assignment.startHour ?? assignment.importedCell?.startHour ?? (assignment.shift === "MORNING" ? 8 : assignment.shift === "AFTERNOON" ? 12 : 20);
}

function assignmentKey(assignment: { dutyTypeId: string; dayOfWeek: string; shift: string; startHour?: number | null; slot: number; importedCellId?: string | null }) {
  return [assignment.dutyTypeId, assignment.dayOfWeek, assignment.shift, assignment.startHour ?? "", assignment.slot, assignment.importedCellId ?? ""].join(":");
}

function auditRowsFromGenerated(
  assignments: GeneratedAssignment[],
  weekStart: Date,
  brokerById: Map<string, string>,
  dutyById: Map<string, string>,
  importedLocalById: Map<string, string>
): AuditRow[] {
  return assignments.flatMap((assignment) => {
    if (!assignment.brokerId) return [];
    return [{
      brokerId: assignment.brokerId,
      brokerName: brokerById.get(assignment.brokerId) ?? "Corretor",
      localName: (assignment.importedCellId ? importedLocalById.get(assignment.importedCellId) : null) || dutyById.get(assignment.dutyTypeId) || "Plantão",
      date: dateForWeekDay(weekStart, assignment.dayOfWeek).toISOString().slice(0, 10)
    }];
  });
}

async function auditProposal(weekStart: Date, beforeRows: AuditRow[], afterRows: AuditRow[]) {
  const [history, brokers, priorities] = await Promise.all([
    publishedFerreiraHistory(),
    prisma.broker.findMany({ where: { active: true, team: { isFerreira: true } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.dutyPriority.findMany({ select: { localName: true }, orderBy: [{ position: "asc" }, { localName: "asc" }] })
  ]);
  return auditDistributionScenarios({
    history,
    before: beforeRows,
    after: afterRows,
    brokers,
    priorityLocalNames: priorities.map((item) => item.localName),
    today: currentSaoPauloDate().toISOString().slice(0, 10)
  });
}

async function createRequest(input: {
  weekStart: Date;
  scheduleId?: string | null;
  command: string;
  requestType: "INITIAL_GENERATION" | "REMAINDER_REDISTRIBUTION";
  proposal: GeneratedScheduleProposal;
  warnings: string[];
  facts: unknown;
  summary: string;
  publicSummary: string;
}) {
  const fingerprint = await scheduleStateFingerprint(input.weekStart);
  const request = await prisma.$transaction(async (tx) => {
    await tx.aiScheduleChangeRequest.updateMany({
      where: { status: "PENDING" },
      data: { status: "CANCELED", canceledAt: new Date() }
    });
    return tx.aiScheduleChangeRequest.create({
      data: {
        scheduleId: input.scheduleId ?? null,
        weekStart: input.weekStart,
        command: input.command,
        requestType: input.requestType,
        proposedJson: JSON.stringify(input.proposal),
        analysisJson: JSON.stringify({ warnings: input.warnings, facts: input.facts }),
        summary: input.summary,
        publicSummary: input.publicSummary,
        stateFingerprint: fingerprint
      }
    });
  });
  return {
    state: "CONFIRMATION_REQUIRED" as const,
    requestId: request.id,
    hasWarnings: input.warnings.length > 0,
    message: `${input.summary}\n\n${input.warnings.length ? `Ressalvas privadas da auditoria histórica:\n- ${input.warnings.join("\n- ")}\n\nVocê deseja confirmar apesar das ressalvas?` : "A auditoria não detectou aumento mensurável de desequilíbrio. Confirme para executar a proposta."}`
  };
}

export async function analyzeInitialGenerationRequest(weekStartInput: string | Date, command: string, options: ProposalOptions = {}) {
  const weekStart = normalizeWeekStart(weekStartInput);
  const gate = generationWindowStatus(weekStart);
  if (!gate.allowed) throw Object.assign(new Error(gate.reason ?? "Geração fora da janela permitida."), { status: 403 });
  const confirmedImport = await latestConfirmedImport(weekStart);
  if (!confirmedImport) throw Object.assign(new Error("Importe e confirme o arquivo semanal antes de gerar a escala."), { status: 400 });
  const planning = await listPlanningData(weekStart);
  const missingEffort = missingEffortBrokerNames(planning.brokers);
  if (missingEffort.length) throw Object.assign(new Error(`Classifique o nível de esforço de todos os corretores ativos antes de gerar a escala: ${missingEffort.join(", ")}.`), { status: 409 });
  const focus = options.focusBrokerName ? planning.brokers.find((broker) => broker.name.toLowerCase() === options.focusBrokerName!.trim().toLowerCase()) : null;
  const result = generateSchedule({ ...planning, weekStart, balanceMode: options.balanceMode ?? "NORMAL", deprioritizeBrokerIds: focus ? [focus.id] : [] });
  const brokerById = new Map(planning.brokers.map((broker) => [broker.id, broker.name]));
  const dutyById = new Map(planning.dutyTypes.map((duty) => [duty.id, duty.name]));
  const importedLocalById = new Map(confirmedImport.cells.map((cell) => [cell.id, cell.localName || "Plantão importado"]));
  const afterRows = auditRowsFromGenerated(result.assignments, weekStart, brokerById, dutyById, importedLocalById);
  const audit = await auditProposal(weekStart, [], afterRows);
  const externalCells = confirmedImport.cells.filter((cell) => cell.ownerType === "EXTERNAL_IMPORTED" && cell.dayOfWeek && cell.shift).map((cell) => ({
    id: cell.id, localName: cell.localName, dayOfWeek: cell.dayOfWeek!, shift: cell.shift!, startHour: cell.startHour, text: cell.text, colorHex: cell.colorHex
  }));
  return createRequest({
    weekStart,
    command,
    requestType: "INITIAL_GENERATION",
    proposal: { kind: "INITIAL_GENERATION", importId: confirmedImport.id, assignments: result.assignments, externalCells, conflicts: result.conflicts },
    warnings: audit.warnings,
    facts: audit.facts,
    summary: `IA: preparei uma prévia exata da próxima escala com ${result.assignments.length} atribuições Ferreira e ${externalCells.length} plantões definidos no arquivo. Nada foi publicado ainda.`,
    publicSummary: "Escala gerada e publicada após confirmação expressa do gerente."
  });
}

export async function analyzeRemainderRedistributionRequest(weekStartInput: string | Date, command: string, options: ProposalOptions = {}) {
  const weekStart = normalizeWeekStart(weekStartInput);
  const today = currentSaoPauloDate();
  if (weekStart.getTime() !== currentSaoPauloWeekStart().getTime()) throw Object.assign(new Error("A redistribuição parcial somente pode ser feita na escala em vigor."), { status: 400 });
  const schedule = await prisma.schedule.findFirst({
    where: { weekStart, status: "PUBLISHED" },
    include: { assignments: { include: { broker: true, dutyType: true, importedCell: true } } },
    orderBy: { publishedAt: "desc" }
  });
  if (!schedule) throw Object.assign(new Error("Não existe escala publicada em vigor para redistribuir."), { status: 404 });
  const planning = await listPlanningData(weekStart);
  const missingEffort = missingEffortBrokerNames(planning.brokers);
  if (missingEffort.length) throw Object.assign(new Error(`Classifique o nível de esforço de todos os corretores ativos antes de redistribuir a escala: ${missingEffort.join(", ")}.`), { status: 409 });
  const future = schedule.assignments.filter((assignment) => assignment.assignmentType !== "EXTERNAL_IMPORTED" && isWeekDayAfterDate(weekStart, assignment.dayOfWeek, today));
  if (!future.length) throw Object.assign(new Error("Não existem dias futuros nesta semana para redistribuir."), { status: 400 });
  const preserved = schedule.assignments.filter((assignment) => assignment.assignmentType !== "EXTERNAL_IMPORTED" && !isWeekDayAfterDate(weekStart, assignment.dayOfWeek, today) && assignment.brokerId);
  const focus = options.focusBrokerName ? planning.brokers.find((broker) => broker.name.toLowerCase() === options.focusBrokerName!.trim().toLowerCase()) : null;
  const result = generateSchedule({
    ...planning,
    windows: planning.windows.filter((window) => isWeekDayAfterDate(weekStart, window.dayOfWeek, today)),
    weekStart,
    balanceMode: options.balanceMode ?? "MORE_BALANCED",
    deprioritizeBrokerIds: focus ? [focus.id] : [],
    initialAssignments: preserved.map((assignment) => ({ brokerId: assignment.brokerId!, dayOfWeek: assignment.dayOfWeek, startHour: startHour(assignment), localName: localName(assignment) }))
  });
  const beforeRows: AuditRow[] = future.flatMap((assignment) => !assignment.brokerId || !assignment.broker ? [] : [{
    brokerId: assignment.brokerId, brokerName: assignment.broker.name, localName: localName(assignment), date: dateForWeekDay(weekStart, assignment.dayOfWeek).toISOString().slice(0, 10)
  }]);
  const brokerById = new Map(planning.brokers.map((broker) => [broker.id, broker.name]));
  const dutyById = new Map(planning.dutyTypes.map((duty) => [duty.id, duty.name]));
  const importedLocalById = new Map(planning.windows.flatMap((window) => window.importedCell ? [[window.importedCell.id, window.importedCell.localName || "Plantão"]] : []));
  const afterRows = auditRowsFromGenerated(result.assignments, weekStart, brokerById, dutyById, importedLocalById);
  const audit = await auditProposal(weekStart, beforeRows, afterRows);
  const preservedThrough = today.toISOString().slice(0, 10);
  const futureByKey = new Map(future.map((assignment) => [assignmentKey(assignment), assignment]));
  const notices = result.assignments.flatMap((assignment) => {
    const previous = futureByKey.get(assignmentKey(assignment));
    if (!previous || previous.brokerId === assignment.brokerId) return [];
    return [{
      previousBrokerName: previous.broker?.name ?? null,
      newBrokerName: assignment.brokerId ? brokerById.get(assignment.brokerId) ?? null : null,
      localName: localName(previous),
      dayOfWeek: assignment.dayOfWeek,
      timeLabel: previous.importedCell?.timeLabel ?? null,
      startHour: assignment.startHour
    }];
  });
  return createRequest({
    weekStart,
    scheduleId: schedule.id,
    command,
    requestType: "REMAINDER_REDISTRIBUTION",
    proposal: { kind: "REMAINDER_REDISTRIBUTION", scheduleId: schedule.id, replaceAssignmentIds: future.map((item) => item.id), assignments: result.assignments, conflicts: result.conflicts, preservedThrough, notices },
    warnings: audit.warnings,
    facts: audit.facts,
    summary: `IA: simulei a redistribuição exata de ${result.assignments.length} atribuições futuras. Todos os plantões até o fim de ${preservedThrough} permanecem intocados.`,
    publicSummary: "Dias futuros redistribuídos após confirmação expressa do gerente."
  });
}

async function saveReview(scheduleId: string, weekStart: Date, conflicts: SchedulingConflict[]) {
  const schedule = await prisma.schedule.findUniqueOrThrow({
    where: { id: scheduleId },
    include: { assignments: { include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true } } }
  });
  const review = await reviewScheduleWithLlm({ weekStart, assignments: schedule.assignments, conflicts, brokerStats: buildBrokerStats(schedule.assignments) });
  await prisma.aiScheduleReview.deleteMany({ where: { scheduleId } });
  await prisma.aiScheduleReview.create({ data: { scheduleId, model: review.model, status: review.status, summary: review.summary, balance: review.balance, conflicts: review.conflicts, rawJson: review.rawJson, error: review.error } });
}

export async function executeGeneratedScheduleProposal(request: { id: string; weekStart: Date; scheduleId: string | null; proposedJson: string }) {
  const proposal = JSON.parse(request.proposedJson) as GeneratedScheduleProposal;
  let scheduleId = request.scheduleId;
  await prisma.$transaction(async (tx) => {
    if (proposal.kind === "INITIAL_GENERATION") {
      const existing = await tx.schedule.findFirst({ where: { weekStart: request.weekStart } });
      if (existing) throw new Error("STALE: a semana já possui uma escala.");
      const externalAssignments = [];
      let priority = 100;
      for (const cell of proposal.externalCells) {
        const name = cell.localName || "PLANTÃO IMPORTADO";
        const upper = name.toUpperCase();
        const duty = await tx.dutyType.upsert({
          where: { name },
          update: { priority },
          create: { name, priority, requiresExternal: !upper.includes("SEDE") && !upper.includes("LIGAC"), isHeadquarters: upper.includes("SEDE"), isCalling: upper.includes("LIGAC") }
        });
        priority += 1;
        externalAssignments.push({ brokerId: null, dutyTypeId: duty.id, dayOfWeek: cell.dayOfWeek, shift: cell.shift, startHour: cell.startHour, slot: 1, assignmentType: "EXTERNAL_IMPORTED", importedCellId: cell.id, sourceText: cell.text, sourceColorHex: cell.colorHex, isViolation: false });
      }
      const created = await tx.schedule.create({
        data: { weekStart: request.weekStart, status: "PUBLISHED", importId: proposal.importId, publishedAt: new Date(), assignments: { create: [...externalAssignments, ...proposal.assignments] } }
      });
      scheduleId = created.id;
    } else {
      const schedule = await tx.schedule.findUnique({ where: { id: proposal.scheduleId } });
      if (!schedule || schedule.status !== "PUBLISHED") throw new Error("STALE: a escala não está mais publicada.");
      await tx.aiScheduleReview.deleteMany({ where: { scheduleId: proposal.scheduleId } });
      await tx.scheduleAssignment.deleteMany({ where: { id: { in: proposal.replaceAssignmentIds } } });
      await tx.scheduleAssignment.createMany({ data: proposal.assignments.map((assignment) => ({ ...assignment, scheduleId: proposal.scheduleId })) });
      for (const notice of proposal.notices) {
        await tx.scheduleChangeNotice.create({
          data: {
            scheduleId: proposal.scheduleId,
            requestId: request.id,
            previousBrokerName: notice.previousBrokerName,
            newBrokerName: notice.newBrokerName,
            localName: notice.localName,
            dayOfWeek: notice.dayOfWeek,
            timeLabel: notice.timeLabel,
            startHour: notice.startHour,
            warningsJson: "[]"
          }
        });
      }
      scheduleId = proposal.scheduleId;
    }
    await tx.aiScheduleChangeRequest.update({ where: { id: request.id }, data: { scheduleId, status: "EXECUTED", confirmedAt: new Date() } });
  }, { isolationLevel: "Serializable" });
  if (!scheduleId) throw new Error("Falha ao publicar a proposta.");
  await saveReview(scheduleId, request.weekStart, proposal.conflicts);
  return { scheduleId, conflicts: proposal.conflicts };
}
