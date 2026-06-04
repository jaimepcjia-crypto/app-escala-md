import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth";
import { getAdminSnapshot } from "@/lib/data";
import { dateForWeekDay } from "@/lib/deadlines";

const dayOrder = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

function fallbackStartHour(shift: string) {
  if (shift === "MORNING") return 8;
  if (shift === "AFTERNOON") return 12;
  return 20;
}

function assignmentLocalName(item: { importedCell?: { localName?: string | null } | null; dutyType: { name: string } }) {
  return item.importedCell?.localName || item.dutyType.name;
}

export async function PATCH(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();

  const assignment = await prisma.scheduleAssignment.findUnique({
    where: { id: body.assignmentId },
    include: {
      dutyType: true,
      importedCell: true,
      schedule: { include: { assignments: { include: { dutyType: true, importedCell: true } } } }
    }
  });
  if (!assignment) return NextResponse.json({ error: "Plantao nao encontrado." }, { status: 404 });

  const brokerId = body.brokerId ? String(body.brokerId) : null;
  let isViolation = false;
  let violationReason: string | null = null;
  const alerts: string[] = [];

  if (brokerId) {
    const [broker, unavailable] = await Promise.all([
      prisma.broker.findUnique({ where: { id: brokerId } }),
      prisma.unavailability.findFirst({
        where: {
          date: dateForWeekDay(assignment.schedule.weekStart, assignment.dayOfWeek),
          brokerId,
          startHour: { lte: assignment.startHour ?? fallbackStartHour(assignment.shift) },
          endHour: { gt: assignment.startHour ?? fallbackStartHour(assignment.shift) }
        }
      })
    ]);

    if (!broker) return NextResponse.json({ error: "Corretor nao encontrado." }, { status: 404 });
    const violations = [];
    if (unavailable) violations.push("corretor marcou indisponibilidade");
    if (assignment.dutyType.requiresExternal && !broker.canExternalDuty) violations.push("sem permissao para plantao externo");
    if (violations.length > 0) {
      isViolation = true;
      violationReason = violations.join("; ");
      alerts.push(`Violacao: ${violationReason}`);
    }

    const ferreiraAssignments = assignment.schedule.assignments.filter((item) => item.assignmentType !== "EXTERNAL_IMPORTED");
    const counts = new Map<string, number>();
    for (const item of ferreiraAssignments) {
      if (item.id === assignment.id) continue;
      if (!item.brokerId) continue;
      counts.set(item.brokerId, (counts.get(item.brokerId) ?? 0) + 1);
    }
    counts.set(brokerId, (counts.get(brokerId) ?? 0) + 1);
    const values = [...counts.values()];
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const selectedCount = counts.get(brokerId) ?? 0;
    if (selectedCount > average + 1) {
      alerts.push(`Desbalanceamento: ${broker.name} ficara com ${selectedCount} plantoes, acima da media ${average.toFixed(1)}.`);
    }

    const snapshot = await getAdminSnapshot(assignment.schedule.weekStart.toISOString());
    const brokerRank = snapshot.brokers.find((item) => item.id === brokerId)?.salesRank ?? null;
    const localName = assignmentLocalName(assignment);
    const priorityIndex = snapshot.plantaoPriorities.findIndex((item) => item.localName === localName);
    if (brokerRank && priorityIndex >= 0 && priorityIndex < 3) {
      const sameLocal = ferreiraAssignments
        .filter((item) => assignmentLocalName(item) === localName)
        .sort((left, right) =>
          dayOrder.indexOf(left.dayOfWeek) - dayOrder.indexOf(right.dayOfWeek) ||
          (left.startHour ?? fallbackStartHour(left.shift)) - (right.startHour ?? fallbackStartHour(right.shift)) ||
          left.slot - right.slot
        );
      const reservedCount = Math.ceil(sameLocal.length * 0.4);
      const currentIndex = sameLocal.findIndex((item) => item.id === assignment.id);
      const isReservedSlot = currentIndex >= 0 && currentIndex < reservedCount;
      const expectedStart = priorityIndex * 2 + 1;
      const expectedEnd = expectedStart + 1;
      if (isReservedSlot && (brokerRank < expectedStart || brokerRank > expectedEnd)) {
        alerts.push(`Reserva meritocratica quebrada: ${localName} prioriza rankings ${expectedStart}o e ${expectedEnd}o nas vagas reservadas; ${broker.name} esta em ${brokerRank}o.`);
      }
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.manualAdjustmentAlert.deleteMany({ where: { assignmentId: assignment.id } });
    const row = await tx.scheduleAssignment.update({
      where: { id: assignment.id },
      data: {
        brokerId,
        isViolation,
        violationReason,
        assignmentType: "FERREIRA_MANUAL",
        balanceAlert: alerts.join(" | ") || null
      },
      include: { broker: { include: { team: true } }, dutyType: true, importedCell: true, manualAlerts: true }
    });
    for (const reason of alerts) {
      await tx.manualAdjustmentAlert.create({ data: { assignmentId: assignment.id, reason } });
    }
    return row;
  });

  return NextResponse.json({ assignment: updated });
}
