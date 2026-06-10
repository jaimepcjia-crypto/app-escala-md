import { expect, it } from "vitest";
import { brokerAvailabilityAlertStatus, defaultAiScheduleWeek, generationWindowStatus, isWeekDayAfterDate, nextAvailabilityDeadline, unavailableDateStatus, weeklyWorkflowStatus } from "@/lib/deadlines";

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
  expect(weeklyWorkflowStatus(friday)).toMatchObject({ isOpen: false, currentWeekStart: "2026-06-01", weekStart: "2026-06-08", daysUntilOpen: 1 });
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

it("counts broker availability deadline down to Saturday midnight in Sao Paulo", () => {
  const tuesday = nextAvailabilityDeadline(new Date("2026-06-09T11:00:00.000Z"));
  expect(tuesday.fridayDate.toISOString().slice(0, 10)).toBe("2026-06-12");
  expect(tuesday.deadline.toISOString()).toBe("2026-06-13T03:00:00.000Z");

  const saturday = nextAvailabilityDeadline(new Date("2026-06-13T15:00:00.000Z"));
  expect(saturday.fridayDate.toISOString().slice(0, 10)).toBe("2026-06-19");
  expect(saturday.deadline.toISOString()).toBe("2026-06-20T03:00:00.000Z");
});

it("shows the broker deadline alert only from Monday 08:00 through Friday in Sao Paulo", () => {
  expect(brokerAvailabilityAlertStatus(new Date("2026-06-13T02:59:59.000Z")).visible).toBe(true);
  expect(brokerAvailabilityAlertStatus(new Date("2026-06-13T03:00:00.000Z")).visible).toBe(false);
  expect(brokerAvailabilityAlertStatus(new Date("2026-06-15T10:59:59.000Z")).visible).toBe(false);
  expect(brokerAvailabilityAlertStatus(new Date("2026-06-15T11:00:00.000Z")).visible).toBe(true);
});

it("freezes past days and the entire current day during a partial redistribution", () => {
  const weekStart = new Date("2026-06-08T00:00:00.000Z");
  const wednesday = new Date("2026-06-10T00:00:00.000Z");
  expect(isWeekDayAfterDate(weekStart, "MONDAY", wednesday)).toBe(false);
  expect(isWeekDayAfterDate(weekStart, "TUESDAY", wednesday)).toBe(false);
  expect(isWeekDayAfterDate(weekStart, "WEDNESDAY", wednesday)).toBe(false);
  expect(isWeekDayAfterDate(weekStart, "THURSDAY", wednesday)).toBe(true);
  expect(isWeekDayAfterDate(weekStart, "SUNDAY", wednesday)).toBe(true);
});
