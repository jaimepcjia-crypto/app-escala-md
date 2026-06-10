import { describe, expect, it } from "vitest";
import {
  buildImportChangeSummary,
  classifyImportedPlantoes,
  isSmallChange,
  normalizeName
} from "@/lib/plantao-reconciliation";

describe("normalizeName", () => {
  it("ignora acento, caixa e espaços extras", () => {
    expect(normalizeName("  Sede  Móura   ")).toBe("SEDE MOURA");
  });
});

describe("isSmallChange", () => {
  it("aceita grafia, acento e espaço como pequena mudança", () => {
    expect(isSmallChange("BARRA", "BARA")).toBe(true);
    expect(isSmallChange("SEDE MD", "SEDE  MD")).toBe(false); // mesmo após normalizar (igual) -> não é "mudança"
    expect(isSmallChange("QUIOSQUE", "QUIOSKE")).toBe(true);
  });

  it("rejeita nomes claramente distintos", () => {
    expect(isSmallChange("BARRA", "QUIOSQUE")).toBe(false);
    expect(isSmallChange("SEDE MOURA DUBEUX", "PLANTAO NOTURNO")).toBe(false);
  });
});

describe("classifyImportedPlantoes", () => {
  const knownNames = ["SEDE MOURA DUBEUX", "BARRA", "QUIOSQUE"];

  it("reconhece conhecido, alias, ambíguo e novo", () => {
    const aliases = new Map([["BARRA SHOPPING", "BARRA"]]);
    const result = classifyImportedPlantoes({
      parsedNames: ["BARRA", "BARRA SHOPPING", "QUIOSKE", "STAND PRAIA"],
      knownNames,
      aliases
    });
    const byRaw = new Map(result.map((item) => [item.rawName, item]));

    expect(byRaw.get("BARRA")?.status).toBe("KNOWN");
    expect(byRaw.get("BARRA SHOPPING")).toMatchObject({ status: "ALIAS", canonicalName: "BARRA" });
    expect(byRaw.get("QUIOSKE")).toMatchObject({ status: "AMBIGUOUS", suggestion: "QUIOSQUE" });
    expect(byRaw.get("STAND PRAIA")?.status).toBe("NEW");
  });
});

describe("buildImportChangeSummary", () => {
  it("detecta novos, removidos e horário alterado", () => {
    const previous = [
      { localName: "BARRA", startHour: 8 },
      { localName: "QUIOSQUE", startHour: 12 }
    ];
    const current = [
      { localName: "BARRA", startHour: 14 },
      { localName: "SEDE MOURA DUBEUX", startHour: 20 }
    ];
    const summary = buildImportChangeSummary(previous, current);

    expect(summary.added).toEqual(["SEDE MOURA DUBEUX"]);
    expect(summary.removed).toEqual(["QUIOSQUE"]);
    expect(summary.timeChanged).toEqual([{ localName: "BARRA", from: [8], to: [14] }]);
  });
});
