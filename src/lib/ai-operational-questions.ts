type OperationalBroker = {
  name: string;
  active: boolean;
  team: { isFerreira: boolean };
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function answerBrokerOperationalQuestion(command: string, brokers: OperationalBroker[]) {
  const normalized = normalize(command);
  const asksForBrokers = /\bcorretor(es)?\b/.test(normalized);
  const asksForCount = /\bquantos?\b|\bquantidade\b|\bnumero\b|\beram\s+\d+\b/.test(normalized);
  const asksForNames = /\bquais\b|\bquem\b|\bnomes?\b|\bliste\b/.test(normalized);
  if (!asksForBrokers || (!asksForCount && !asksForNames)) return null;

  const ferreira = brokers.filter((broker) => broker.team.isFerreira);
  const active = ferreira.filter((broker) => broker.active).sort((left, right) => left.name.localeCompare(right.name));
  const inactive = ferreira.length - active.length;
  const previousCount = normalized.match(/\beram\s+(\d+)\b/)?.[1];
  const previous = previousCount ? Number(previousCount) : null;
  const difference = previous === null ? 0 : Math.abs(active.length - previous);
  const comparison = previous === null
    ? ""
    : active.length === previous
      ? ` A quantidade permanece igual aos ${previous} citados.`
      : ` Em relação aos ${previous} citados, há ${difference} ${difference === 1 ? "corretor" : "corretores"} ${active.length > previous ? "a mais" : "a menos"}.`;
  const inactiveText = inactive ? ` Há também ${inactive} ${inactive === 1 ? "corretor inativo" : "corretores inativos"}.` : "";

  return `IA: agora há ${active.length} corretores ativos na equipe Ferreira.${comparison}${inactiveText}\nAtivos: ${active.map((broker) => broker.name).join(", ")}.`;
}
