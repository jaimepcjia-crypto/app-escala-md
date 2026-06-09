import { describe, expect, it } from "vitest";
import { availabilityReadiness, brokerIdentityChanged } from "@/lib/availability-readiness";

describe("next schedule availability readiness", () => {
  it("considera apenas confirmações dos corretores ativos atuais", () => {
    expect(availabilityReadiness(["a", "b", "c"], ["a", "b", "old"])).toEqual({
      total: 3,
      confirmed: 2,
      allConfirmed: false
    });
  });

  it("detecta renomeação que deve invalidar preparações futuras herdadas", () => {
    expect(brokerIdentityChanged("Ana", "Jaime")).toBe(true);
    expect(brokerIdentityChanged(" Jaime ", "jaime")).toBe(false);
  });
});
