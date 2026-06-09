import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSessionToken, getRequestSession, passwordCredentialData, verifyStoredPassword } from "@/lib/auth";

describe("broker credentials", () => {
  it("salva texto e hash correspondentes", () => {
    const credentials = passwordCredentialData("102030");
    expect(credentials.passwordPlain).toBe("102030");
    expect(verifyStoredPassword("102030", credentials)).toEqual({ valid: true, needsHashRepair: false });
  });

  it("identifica e recupera credencial antiga com hash divergente", () => {
    const oldCredentials = passwordCredentialData("1234");
    expect(verifyStoredPassword("102030", { passwordHash: oldCredentials.passwordHash, passwordPlain: "102030" })).toEqual({
      valid: true,
      needsHashRepair: true
    });
  });

  it("rejeita senha realmente incorreta", () => {
    const credentials = passwordCredentialData("102030");
    expect(verifyStoredPassword("1020", credentials).valid).toBe(false);
  });

  it("prioriza a sessão enviada pela aba sobre o cookie compartilhado", () => {
    const manager = createSessionToken({ id: "manager", role: "MANAGER", brokerId: null });
    const broker = createSessionToken({ id: "broker", role: "BROKER", brokerId: "broker-id" });
    const request = new NextRequest("https://app.local/api/me", {
      headers: {
        authorization: `Bearer ${manager}`,
        cookie: `escala_md_session=${broker}`
      }
    });
    expect(getRequestSession(request)).toMatchObject({ userId: "manager", role: "MANAGER" });
  });
});
