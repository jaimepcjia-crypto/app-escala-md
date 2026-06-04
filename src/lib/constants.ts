export type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
export type Shift = "MORNING" | "AFTERNOON" | "NIGHT";

export const DAYS: { key: DayOfWeek; label: string; short: string }[] = [
  { key: "MONDAY", label: "Segunda", short: "Seg" },
  { key: "TUESDAY", label: "Terca", short: "Ter" },
  { key: "WEDNESDAY", label: "Quarta", short: "Qua" },
  { key: "THURSDAY", label: "Quinta", short: "Qui" },
  { key: "FRIDAY", label: "Sexta", short: "Sex" },
  { key: "SATURDAY", label: "Sabado", short: "Sab" },
  { key: "SUNDAY", label: "Domingo", short: "Dom" }
];

export const SHIFTS: { key: Shift; label: string }[] = [
  { key: "MORNING", label: "Manha" },
  { key: "AFTERNOON", label: "Tarde" },
  { key: "NIGHT", label: "Noite" }
];

export function normalizeWeekStart(input?: string | Date) {
  let date: Date;
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-").map(Number);
    date = new Date(Date.UTC(year, month - 1, day));
  } else {
    const source = input ? new Date(input) : new Date();
    date = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
  }
  const copy = new Date(date);
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export function formatWeekStart(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function labelsFor(dayOfWeek: DayOfWeek | string, shift: Shift | string) {
  const day = DAYS.find((item) => item.key === dayOfWeek)?.label ?? dayOfWeek;
  const shiftLabel = SHIFTS.find((item) => item.key === shift)?.label ?? shift;
  return `${day} / ${shiftLabel}`;
}

export function isWeekend(dayOfWeek: DayOfWeek | string) {
  return dayOfWeek === "SATURDAY" || dayOfWeek === "SUNDAY";
}
