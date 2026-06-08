import { describe, expect, it } from "vitest";
import { answerBrokerOperationalQuestion } from "@/lib/ai-operational-questions";

const brokers = [
  { name: "Ana", active: true, team: { isFerreira: true } },
  { name: "Bruno", active: true, team: { isFerreira: true } },
  { name: "Carla", active: false, team: { isFerreira: true } },
  { name: "Externo", active: true, team: { isFerreira: false } }
];

describe("answerBrokerOperationalQuestion", () => {
  it("responde quantidade atual e compara com o número citado", () => {
    expect(answerBrokerOperationalQuestion("eram 10 corretores, quantos são agora?", brokers)).toBe(
      "IA: agora há 2 corretores ativos na equipe Ferreira. Em relação aos 10 citados, há 8 corretores a menos. Há também 1 corretor inativo.\nAtivos: Ana, Bruno."
    );
  });

  it("lista os corretores ativos da equipe Ferreira", () => {
    expect(answerBrokerOperationalQuestion("quais são os corretores?", brokers)).toContain("Ativos: Ana, Bruno.");
  });

  it("não intercepta comandos que não são perguntas sobre corretores", () => {
    expect(answerBrokerOperationalQuestion("publique a próxima escala", brokers)).toBeNull();
  });
});
