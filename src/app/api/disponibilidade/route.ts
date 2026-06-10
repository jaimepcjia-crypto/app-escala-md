import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSeedData } from "@/lib/seed";
import { requireUser } from "@/lib/auth";
import { currentSaoPauloDate, currentSaoPauloWeekStart, dateOnly, dayLabel, dayOfWeekForDate, monthDays, monthFromDate, monthRange, unavailableDateStatus, weeklyWorkflowStatus } from "@/lib/deadlines";
import { normalizeWeekStart } from "@/lib/constants";
import { availabilityReadiness } from "@/lib/availability-readiness";
import { invalidatePendingChangeRequests } from "@/lib/ai-schedule-changes";

function uniqueDates(dates: Date[]) {
  return [...new Map(dates.map((date) => [dateOnly(date), date])).values()];
}

function weekStartForDate(date: Date) {
  return normalizeWeekStart(date);
}

function weekKey(date: Date) {
  return weekStartForDate(date).toISOString();
}

// Semanas (weekStart) com escala PUBLICADA — bloqueiam a edicao do corretor.
// (Editavel a qualquer hora; trava so quando a escala da semana esta publicada.)
async function publishedWeekKeys(days: Date[]) {
  const weekStarts = [...new Map(days.map((date) => [weekKey(date), weekStartForDate(date)] as const)).values()];
  const published = await prisma.schedule.findMany({
    where: { status: "PUBLISHED", weekStart: { in: weekStarts } },
    select: { weekStart: true }
  });
  return new Set(published.map((schedule) => schedule.weekStart.toISOString()));
}

export async function GET(request: NextRequest) {
  await ensureSeedData();
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") ?? monthFromDate();
  const requestedBrokerId = request.nextUrl.searchParams.get("brokerId") ?? "";
  const { start, end } = monthRange(month);
  const workflow = weeklyWorkflowStatus();
  const currentWeekStart = currentSaoPauloWeekStart();

  const brokerWhere = auth.user.role === "BROKER"
    ? { id: auth.user.brokerId ?? "" }
    : {
        active: true,
        team: { isFerreira: true },
        ...(requestedBrokerId ? { id: requestedBrokerId } : {})
      };

  const [brokers, unavailabilities, currentSchedule, activeFerreiraBrokers, nextWeekConfirmations] = await Promise.all([
    prisma.broker.findMany({ where: brokerWhere, include: { team: true }, orderBy: { name: "asc" } }),
    prisma.unavailability.findMany({
      where: {
        date: { gte: start, lte: end },
        broker: auth.user.role === "BROKER" ? { id: auth.user.brokerId ?? "" } : { active: true, team: { isFerreira: true } }
      },
      include: { broker: { include: { team: true } } },
      orderBy: [{ date: "asc" }, { startHour: "asc" }]
    }),
    prisma.schedule.findFirst({ where: { weekStart: currentWeekStart, status: "PUBLISHED" }, select: { id: true, publishedAt: true } }),
    prisma.broker.findMany({ where: { active: true, team: { isFerreira: true } }, select: { id: true } }),
    prisma.unavailabilityConfirmation.findMany({ where: { weekStart: workflow.weekStartDate }, select: { brokerId: true } })
  ]);

  const visibleBrokerIds = new Set(brokers.map((broker) => broker.id));
  const filteredUnavailabilities = unavailabilities.filter((item) => visibleBrokerIds.has(item.brokerId));
  const nextWeekReadiness = availabilityReadiness(activeFerreiraBrokers.map((broker) => broker.id), nextWeekConfirmations.map((item) => item.brokerId));

  const days = monthDays(month);
  const publishedSet = await publishedWeekKeys(days);
  const today = currentSaoPauloDate();
  const maxDate = new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate()));

  return NextResponse.json({
    month,
    minMonth: monthFromDate(today),
    maxMonth: monthFromDate(maxDate),
    role: auth.user.role,
    canEdit: auth.user.role === "BROKER",
    liveStatus: {
      currentSchedule: {
        weekStart: workflow.currentWeekStart,
        weekEnd: workflow.currentWeekEnd,
        published: Boolean(currentSchedule),
        publishedAt: currentSchedule?.publishedAt?.toISOString() ?? null
      },
      nextWeekAvailability: {
        weekStart: workflow.weekStart,
        weekEnd: workflow.weekEnd,
        confirmed: nextWeekReadiness.confirmed,
        total: nextWeekReadiness.total
      }
    },
    brokers: brokers.map(({ effortLevel: _effortLevel, ...broker }) => broker),
    days: days.map((date) => {
      const rangeStatus = unavailableDateStatus(date);
      const published = publishedSet.has(weekKey(date));
      const editable = auth.user.role === "BROKER" && rangeStatus.editable && !published;
      return {
        date: dateOnly(date),
        dayOfWeek: dayOfWeekForDate(date),
        dayLabel: dayLabel(dayOfWeekForDate(date)),
        status: rangeStatus.status === "past" ? "past" : editable ? "editable" : "locked",
        editable,
        reason: published ? "Escala desta semana ja publicada." : rangeStatus.reason
      };
    }),
    unavailabilities: filteredUnavailabilities.map((item) => ({
      id: item.id,
      brokerId: item.brokerId,
      brokerName: item.broker.name,
      teamName: item.broker.team.name,
      date: dateOnly(item.date),
      startHour: item.startHour,
      endHour: item.endHour
    }))
  });
}

function parseHour(value: unknown) {
  const hour = Number(value);
  return Number.isInteger(hour) ? hour : null;
}

export async function POST(request: NextRequest) {
  await ensureSeedData();
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  if (auth.user.role !== "BROKER") {
    return NextResponse.json({ error: "Somente o corretor pode alterar o proprio NAO PODE." }, { status: 403 });
  }

  const body = await request.json();
  const brokerId = auth.user.brokerId;
  if (!brokerId) return NextResponse.json({ error: "Corretor nao encontrado na sessao." }, { status: 400 });

  const broker = await prisma.broker.findUnique({ where: { id: brokerId } });
  if (!broker) return NextResponse.json({ error: "Corretor nao encontrado." }, { status: 404 });

  const month = String(body.month ?? monthFromDate());
  const { start, end } = monthRange(month);
  const rawRanges: unknown[] = Array.isArray(body.ranges) ? body.ranges : [];
  const ranges = rawRanges
    .map((range: unknown) => {
      if (!range || typeof range !== "object") return null;
      const item = range as { date?: string; startHour?: unknown; endHour?: unknown };
      const startHour = parseHour(item.startHour);
      const endHour = parseHour(item.endHour);
      if (!item.date || startHour === null || endHour === null) return null;
      return { date: new Date(`${item.date}T00:00:00.000Z`), startHour, endHour };
    })
    .filter(Boolean) as Array<{ date: Date; startHour: number; endHour: number }>;

  const monthDaysList = monthDays(month);
  const publishedSet = await publishedWeekKeys(monthDaysList);
  const editableDates = monthDaysList.filter((date) => unavailableDateStatus(date).editable && !publishedSet.has(weekKey(date)));
  const editableDateKeys = new Set(editableDates.map(dateOnly));

  for (const range of ranges) {
    const key = dateOnly(range.date);
    if (range.date < start || range.date > end) {
      return NextResponse.json({ error: "Todas as datas enviadas precisam pertencer ao mes selecionado." }, { status: 400 });
    }
    if (range.startHour < 0 || range.startHour > 23 || range.endHour < 1 || range.endHour > 24 || range.startHour >= range.endHour) {
      return NextResponse.json({ error: `Horario invalido em ${key}. Use hora cheia, com inicio menor que termino.` }, { status: 400 });
    }
    if (!editableDateKeys.has(key)) {
      return NextResponse.json({ error: `A data ${key} esta fora da faixa editavel ou pertence a uma semana ja publicada.` }, { status: 409 });
    }
  }

  const touchedWeeks = uniqueDates(editableDates.map((date) => weekStartForDate(date)));
  await prisma.$transaction(async (tx) => {
    await tx.unavailability.deleteMany({
      where: {
        brokerId,
        date: { in: editableDates }
      }
    });
    for (const range of ranges) {
      const date = new Date(`${dateOnly(range.date)}T00:00:00.000Z`);
      await tx.unavailability.create({
        data: {
          brokerId,
          date,
          weekStart: weekStartForDate(date),
          dayOfWeek: dayOfWeekForDate(date),
          shift: "TIME_RANGE",
          startHour: range.startHour,
          endHour: range.endHour,
          reason: String(body.reason ?? "").trim() || null
        }
      });
    }
    for (const touchedWeek of touchedWeeks) {
      await tx.unavailabilityConfirmation.upsert({
        where: { weekStart_brokerId: { weekStart: touchedWeek, brokerId } },
        update: { confirmedAt: new Date() },
        create: { weekStart: touchedWeek, brokerId }
      });
    }
  });
  await Promise.all(touchedWeeks.map((weekStart) => invalidatePendingChangeRequests(weekStart)));

  return NextResponse.json({ ok: true, count: ranges.length });
}
