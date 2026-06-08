import { describe, expect, it } from "vitest";
import { directOperationalAction } from "@/lib/ai-command-intent";

describe("directOperationalAction", () => {
  it("reconhece ordens inequívocas ao motor", () => {
    expect(directOperationalAction("publique a próxima escala")).toBe("GENERATE_AND_PUBLISH");
    expect(directOperationalAction("verifique o NÃO PODE")).toBe("CHECK_UNAVAILABILITY");
    expect(directOperationalAction("cancele a publicação")).toBe("CANCEL_PUBLICATION");
  });

  it("não transforma dúvidas em ações", () => {
    expect(directOperationalAction("posso publicar hoje?")).toBeNull();
    expect(directOperationalAction("como funciona a publicação?")).toBeNull();
    expect(directOperationalAction("o gerente pode alterar indisponibilidade?")).toBeNull();
  });
});
