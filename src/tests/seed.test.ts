import { describe, expect, it } from "vitest";
import { shouldSeedInitialBrokers } from "@/lib/seed";

describe("initial broker seed guard", () => {
  it("cria corretores iniciais somente em banco sem nenhum corretor configurado", () => {
    expect(shouldSeedInitialBrokers(0)).toBe(true);
    expect(shouldSeedInitialBrokers(1)).toBe(false);
    expect(shouldSeedInitialBrokers(10)).toBe(false);
  });

  it("não recria um corretor inicial depois que ele foi renomeado ou excluído", () => {
    expect(shouldSeedInitialBrokers(9)).toBe(false);
    expect(shouldSeedInitialBrokers(11)).toBe(false);
  });
});
