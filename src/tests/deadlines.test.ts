import { expect, it } from "vitest";
import { generationWindowStatus, unavailableDateStatus } from "@/lib/deadlines";

it("blocks past dates and the current in-force week", () => {
  const now = new Date("2026-06-03T15:00:00.000Z");

  expect(unavailableDateStatus("2026-06-02", now).status).toBe("past");
  expect(unavailableDateStatus("2026-06-05", now).status).toBe("locked");
  expect(unavailableDateStatus("2026-06-08", now).status).toBe("editable");
});

it("blocks the next week after Sunday 18h in Sao Paulo", () => {
  const beforeCutoff = new Date("2026-06-07T20:59:00.000Z");
  const afterCutoff = new Date("2026-06-07T21:00:00.000Z");

  expect(unavailableDateStatus("2026-06-08", beforeCutoff).status).toBe("editable");
  expect(unavailableDateStatus("2026-06-08", afterCutoff).status).toBe("locked");
  expect(unavailableDateStatus("2026-06-15", afterCutoff).status).toBe("editable");
});

it("temporarily allows generation at any time", () => {
  const beforeWindow = new Date("2026-06-07T21:00:00.000Z");
  const openWindow = new Date("2026-06-07T21:01:00.000Z");
  const wrongWeek = new Date("2026-06-07T21:30:00.000Z");

  expect(generationWindowStatus("2026-06-08", beforeWindow).allowed).toBe(true);
  expect(generationWindowStatus("2026-06-08", openWindow).allowed).toBe(true);
  expect(generationWindowStatus("2026-06-15", wrongWeek).allowed).toBe(true);
});
