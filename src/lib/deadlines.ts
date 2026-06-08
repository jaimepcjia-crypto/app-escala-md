import { DAYS, normalizeWeekStart, type DayOfWeek, type Shift } from "@/lib/constants";

const TIME_ZONE = "America/Sao_Paulo";

const dayByJsDay: DayOfWeek[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const dayOffset: Record<DayOfWeek, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6
};

function saoPauloParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const hourPart = value("hour");
  const hour = hourPart === 24 ? 0 : hourPart;
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour,
    minute: value("minute"),
    second: value("second")
  };
}

export function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function parseDateOnly(value: string | Date) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export function dayOfWeekForDate(date: Date): DayOfWeek {
  return dayByJsDay[date.getUTCDay()];
}

export function dateForWeekDay(weekStart: Date, dayOfWeek: DayOfWeek | string) {
  return addDays(weekStart, dayOffset[dayOfWeek as DayOfWeek] ?? 0);
}

export function currentSaoPauloDate(now = new Date()) {
  const parts = saoPauloParts(now);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function currentSaoPauloWeekStart(now = new Date()) {
  return normalizeWeekStart(currentSaoPauloDate(now));
}

export function nextSaoPauloWeekStart(now = new Date()) {
  return addDays(currentSaoPauloWeekStart(now), 7);
}

export function isInsideRange(date: Date, start: Date, end: Date) {
  return date >= start && date <= end;
}

export function unavailableDateStatus(dateInput: string | Date, now = new Date()) {
  const target = parseDateOnly(dateInput);
  const today = currentSaoPauloDate(now);
  if (target < today) {
    return { status: "past" as const, editable: false, reason: "Data passada." };
  }

  const maxDate = new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate()));
  if (target > maxDate) {
    return { status: "locked" as const, editable: false, reason: "Data fora da faixa dos proximos 12 meses." };
  }

  return { status: "editable" as const, editable: true, reason: null };
}

export function generationWindowStatus(weekStartInput: string | Date, now = new Date()) {
  const weekStart = normalizeWeekStart(weekStartInput);
  const workflow = weeklyWorkflowStatus(now);
  const isTargetWeek = weekStart.getTime() === workflow.weekStartDate.getTime();
  return {
    allowed: workflow.isOpen && isTargetWeek,
    reason: !isTargetWeek
      ? `Somente a escala da proxima semana (${workflow.weekStart}) pode ser publicada.`
      : workflow.isOpen ? null : `A montagem e publicacao abrem no sabado, ${workflow.opensOn}.`,
    allowedWeekStart: workflow.weekStart
  };
}

export function weeklyWorkflowStatus(now = new Date()) {
  const today = currentSaoPauloDate(now);
  const weekStartDate = nextSaoPauloWeekStart(now);
  const weekEndDate = addDays(weekStartDate, 6);
  const opensOnDate = addDays(weekStartDate, -2);
  const day = dayOfWeekForDate(today);
  const isOpen = day === "SATURDAY" || day === "SUNDAY";
  const daysUntilOpen = isOpen ? 0 : Math.max(0, Math.round((opensOnDate.getTime() - today.getTime()) / 86400000));
  return {
    isOpen,
    daysUntilOpen,
    weekStartDate,
    weekEndDate,
    opensOnDate,
    weekStart: dateOnly(weekStartDate),
    weekEnd: dateOnly(weekEndDate),
    opensOn: dateOnly(opensOnDate),
    closesOn: dateOnly(addDays(weekStartDate, -1))
  };
}

export function defaultAiScheduleWeek(now = new Date()) {
  const workflow = weeklyWorkflowStatus(now);
  return workflow.isOpen ? workflow.weekStartDate : currentSaoPauloWeekStart(now);
}

export function aiScheduleWeekForCommand(command: string, now = new Date()) {
  const normalized = command.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/\b(proxima|seguinte|futura)\b/.test(normalized)) return nextSaoPauloWeekStart(now);
  if (/\b(atual|em vigor|desta semana)\b/.test(normalized)) return currentSaoPauloWeekStart(now);
  return defaultAiScheduleWeek(now);
}

export function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 0));
  return { start, end };
}

export function monthDays(month: string) {
  const { start, end } = monthRange(month);
  const days: Date[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) {
    days.push(current);
  }
  return days;
}

export function monthFromDate(date = currentSaoPauloDate()) {
  return dateOnly(date).slice(0, 7);
}

export function shiftLabel(shift: Shift | string) {
  return shift === "MORNING" ? "Manha" : shift === "AFTERNOON" ? "Tarde" : shift === "NIGHT" ? "Noite" : shift;
}

export function dayLabel(dayOfWeek: DayOfWeek | string) {
  return DAYS.find((day) => day.key === dayOfWeek)?.label ?? dayOfWeek;
}
