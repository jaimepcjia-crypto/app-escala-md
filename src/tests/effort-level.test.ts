import { describe, expect, it } from "vitest";
import { effortLevelLabel, isEffortLevel, missingEffortBrokerNames } from "@/lib/effort-level";

describe("private effort levels", () => {
  it("accepts only the four configured levels", () => {
    expect(isEffortLevel("VERY_HIGH")).toBe(true);
    expect(isEffortLevel("HIGH")).toBe(true);
    expect(isEffortLevel("MEDIUM")).toBe(true);
    expect(isEffortLevel("LOW")).toBe(true);
    expect(isEffortLevel("RANK_1")).toBe(false);
  });

  it("blocks active brokers without a level and ignores inactive brokers", () => {
    expect(missingEffortBrokerNames([
      { name: "Ana", active: true, effortLevel: null },
      { name: "Bruno", active: true, effortLevel: "HIGH" },
      { name: "Carla", active: false, effortLevel: null }
    ])).toEqual(["Ana"]);
  });

  it("uses manager-facing labels", () => {
    expect(effortLevelLabel("VERY_HIGH")).toBe("Esforço Muito Alto");
    expect(effortLevelLabel(null)).toBe("Não classificado");
  });
});
