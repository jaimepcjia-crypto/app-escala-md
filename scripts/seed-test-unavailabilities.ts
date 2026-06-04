import { prisma } from "../src/lib/prisma";
import { addDays, dateOnly, dayOfWeekForDate } from "../src/lib/deadlines";
import { normalizeWeekStart } from "../src/lib/constants";

const ranges = [
  { startHour: 8, endHour: 12 },
  { startHour: 12, endHour: 16 },
  { startHour: 16, endHour: 20 }
];

const startDate = new Date("2026-06-08T00:00:00.000Z");
const endDate = new Date("2026-06-30T00:00:00.000Z");

function rangeFor(brokerId: string, date: Date) {
  const seed = `${brokerId}:${dateOnly(date)}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return ranges[hash % ranges.length];
}

async function main() {
  const brokers = await prisma.broker.findMany({
    where: { active: true, team: { isFerreira: true } },
    include: { team: true },
    orderBy: { name: "asc" }
  });

  let upserted = 0;
  const touchedWeekBroker = new Set<string>();

  for (const broker of brokers) {
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      const range = rangeFor(broker.id, date);
      const weekStart = normalizeWeekStart(date);
      await prisma.unavailability.upsert({
        where: {
          date_shift_brokerId: {
            date,
            shift: "TIME_RANGE",
            brokerId: broker.id
          }
        },
        update: {
          weekStart,
          dayOfWeek: dayOfWeekForDate(date),
          startHour: range.startHour,
          endHour: range.endHour,
          reason: "Teste inicial gerado para validacao do app."
        },
        create: {
          brokerId: broker.id,
          date,
          weekStart,
          dayOfWeek: dayOfWeekForDate(date),
          shift: "TIME_RANGE",
          startHour: range.startHour,
          endHour: range.endHour,
          reason: "Teste inicial gerado para validacao do app."
        }
      });
      touchedWeekBroker.add(`${dateOnly(weekStart)}:${broker.id}`);
      upserted += 1;
    }
  }

  for (const item of touchedWeekBroker) {
    const [weekStartText, brokerId] = item.split(":");
    const weekStart = new Date(`${weekStartText}T00:00:00.000Z`);
    await prisma.unavailabilityConfirmation.upsert({
      where: { weekStart_brokerId: { weekStart, brokerId } },
      update: { confirmedAt: new Date() },
      create: { weekStart, brokerId }
    });
  }

  console.log(JSON.stringify({ brokers: brokers.length, unavailabilities: upserted, confirmations: touchedWeekBroker.size }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
