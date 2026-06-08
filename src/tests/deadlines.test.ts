import { expect, it } from "vitest";
import { defaultAiScheduleWeek, generationWindowStatus, unavailableDateStatus, weeklyWorkflowStatus } from "@/lib/deadlines";

it("allows dates from today through the next 12 months", () => {
  const now = new Date("2026-06-03T15:00:00.000Z");

  expect(unavailableDateStatus("2026-06-02", now).status).toBe("past");
  expect(unavailableDateStatus("2026-06-03", now).status).toBe("editable");
  expect(unavailableDateStatus("2027-06-03", now).status).toBe("editable");
  expect(unavailableDateStatus("2027-06-04", now).status).toBe("locked");
});

it("opens the next-week workflow only on Saturday and Sunday in Sao Paulo", () => {
  const friday = new Date("2026-06-05T15:00:00.000Z");
  const saturday = new Date("2026-06-06T15:00:00.000Z");
  const sunday = new Date("2026-06-07T23:00:00.000Z");
  expect(weeklyWorkflowStatus(friday)).toMatchObject({ isOpen: false, weekStart: "2026-06-08", daysUntilOpen: 1 });
  expect(weeklyWorkflowStatus(saturday)).toMatchObject({ isOpen: true, weekStart: "2026-06-08" });
  expect(weeklyWorkflowStatus(sunday)).toMatchObject({ isOpen: true, weekStart: "2026-06-08" });
});

it("allows generation only for the immediate next week during the weekend", () => {
  const friday = new Date("2026-06-05T15:00:00.000Z");
  const saturday = new Date("2026-06-06T15:00:00.000Z");
  expect(generationWindowStatus("2026-06-08", friday).allowed).toBe(false);
  expect(generationWindowStatus("2026-06-08", saturday).allowed).toBe(true);
  expect(generationWindowStatus("2026-06-15", saturday).allowed).toBe(false);
});

it("targets current schedule on weekdays and next schedule on weekends for AI changes", () => {
  expect(defaultAiScheduleWeek(new Date("2026-06-03T15:00:00.000Z")).toISOString().slice(0, 10)).toBe("2026-06-01");
  expect(defaultAiScheduleWeek(new Date("2026-06-06T15:00:00.000Z")).toISOString().slice(0, 10)).toBe("2026-06-08");
});
