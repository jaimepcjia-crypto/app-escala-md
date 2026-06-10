export const EFFORT_LEVELS = ["VERY_HIGH", "HIGH", "MEDIUM", "LOW"] as const;

export type EffortLevel = typeof EFFORT_LEVELS[number];

export const EFFORT_LEVEL_LABELS: Record<EffortLevel, string> = {
  VERY_HIGH: "Esforço Muito Alto",
  HIGH: "Esforço Alto",
  MEDIUM: "Esforço Médio",
  LOW: "Esforço Baixo"
};

export function isEffortLevel(value: unknown): value is EffortLevel {
  return EFFORT_LEVELS.includes(value as EffortLevel);
}

export function effortLevelLabel(value: string | null | undefined) {
  return isEffortLevel(value) ? EFFORT_LEVEL_LABELS[value] : "Não classificado";
}

export function missingEffortBrokerNames(brokers: Array<{ name: string; active: boolean; effortLevel?: string | null }>) {
  return brokers.filter((broker) => broker.active && !isEffortLevel(broker.effortLevel)).map((broker) => broker.name);
}
