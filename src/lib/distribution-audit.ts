import { prisma } from "@/lib/prisma";
import { addDays, currentSaoPauloDate, dateForWeekDay, parseDateOnly } from "@/lib/deadlines";
import { normalizeWeekStart } from "@/lib/constants";

export type AuditRow = {
  brokerId: string;
  brokerName: string;
  localName: string;
  date: string;
};

export type AuditBroker = {
  id: string;
  name: string;
};

type Metrics = {
  total: Map<string, number>;
  top: Map<string, number>;
  local: Map<string, number>;
  average: number;
  range: number;
};

function count(rows: AuditRow[], key: (row: AuditRow) => string) {
  const result = new Map<string, number>();
  for (const row of rows) result.set(key(row), (result.get(key(row)) ?? 0) + 1);
  return result;
}

function metrics(rows: AuditRow[], brokers: AuditBroker[], topLocals: Set<string>): Metrics {
  const total = count(rows, (row) => row.brokerId);
  const top = count(rows.filter((row) => topLocals.has(row.localName)), (row) => row.brokerId);
  const local = count(rows, (row) => `${row.brokerId}:${row.localName}`);
  const values = brokers.map((broker) => total.get(broker.id) ?? 0);
  return {
    total,
    top,
    local,
    average: brokers.length ? rows.length / brokers.length : 0,
    range: values.length ? Math.max(...values) - Math.min(...values) : 0
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

export function auditDistributionScenarios(input: {
  history: AuditRow[];
  before: AuditRow[];
  after: AuditRow[];
  brokers: AuditBroker[];
  priorityLocalNames: string[];
  today: string;
}) {
  const topLocals = new Set(input.priorityLocalNames.slice(0, 2));
  const currentWeekStart = normalizeWeekStart(parseDateOnly(input.today));
  const recentStart = addDays(currentWeekStart, -56).toISOString().slice(0, 10);
  const recentEnd = addDays(currentWeekStart, -1).toISOString().slice(0, 10);
  const recentHistory = input.history.filter((row) => row.date >= recentStart && row.date <= recentEnd);
  const allBefore = [...input.history, ...input.before];
  const allAfter = [...input.history, ...input.after];
  const recentBeforeRows = [...recentHistory, ...input.before];
  const recentAfterRows = [...recentHistory, ...input.after];
  const before = metrics(allBefore, input.brokers, topLocals);
  const after = metrics(allAfter, input.brokers, topLocals);
  const recentBefore = metrics(recentBeforeRows, input.brokers, topLocals);
  const recentAfter = metrics(recentAfterRows, input.brokers, topLocals);
  const brokerById = new Map(input.brokers.map((broker) => [broker.id, broker]));
  const warnings: string[] = [];

  if (after.range > before.range) {
    warnings.push(`A diferença entre quem tem mais e menos plantões aumenta de ${before.range} para ${after.range} no histórico completo.`);
  }
  if (recentAfter.range > recentBefore.range) {
    warnings.push(`Nas últimas 8 semanas concluídas, a diferença projetada aumenta de ${recentBefore.range} para ${recentAfter.range}.`);
  }

  for (const broker of input.brokers) {
    const beforeTotal = before.total.get(broker.id) ?? 0;
    const afterTotal = after.total.get(broker.id) ?? 0;
    const beforeTop = before.top.get(broker.id) ?? 0;
    const afterTop = after.top.get(broker.id) ?? 0;
    const recentTotal = recentBefore.total.get(broker.id) ?? 0;
    const recentTop = recentBefore.top.get(broker.id) ?? 0;
    if (afterTotal > beforeTotal && beforeTotal > before.average) {
      warnings.push(`${broker.name} já estava acima da média histórica (${beforeTotal} plantões contra média ${before.average.toFixed(1)}) e receberá ${afterTotal - beforeTotal} a mais.`);
    }
    if (afterTop > beforeTop && (beforeTop > 0 || recentTop > 0)) {
      warnings.push(`${broker.name} receberá mais plantão entre os dois melhores: histórico ${beforeTop} -> ${afterTop}; últimas 8 semanas ${recentTop}.`);
    }
    if (afterTotal < beforeTotal && beforeTotal < before.average) {
      warnings.push(`${broker.name}, que estava abaixo da média histórica (${beforeTotal} contra ${before.average.toFixed(1)}), perderá ${beforeTotal - afterTotal} plantão.`);
    }
    if (afterTotal !== beforeTotal) {
      const recentAfterTotal = recentAfter.total.get(broker.id) ?? 0;
      if (recentAfterTotal !== recentTotal) {
        warnings.push(`${broker.name}: efeito projetado nas últimas 8 semanas ${recentTotal} -> ${recentAfterTotal}; no histórico completo ${beforeTotal} -> ${afterTotal}.`);
      }
    }
  }

  for (const [key, afterCount] of after.local) {
    const beforeCount = before.local.get(key) ?? 0;
    if (afterCount > beforeCount && afterCount > 1) {
      const [brokerId, localName] = key.split(":");
      warnings.push(`${brokerById.get(brokerId)?.name ?? "Corretor"} aumentará a concentração em ${localName}: ${beforeCount} -> ${afterCount}.`);
    }
  }

  return {
    warnings: unique(warnings),
    facts: {
      topLocals: [...topLocals],
      historicalAssignments: input.history.length,
      recentAssignments: recentHistory.length,
      beforeRange: before.range,
      afterRange: after.range,
      recentBeforeRange: recentBefore.range,
      recentAfterRange: recentAfter.range,
      averageBefore: before.average
    }
  };
}

export async function publishedFerreiraHistory(today = currentSaoPauloDate()) {
  const assignments = await prisma.scheduleAssignment.findMany({
    where: {
      brokerId: { not: null },
      assignmentType: { not: "EXTERNAL_IMPORTED" },
      schedule: { status: "PUBLISHED" }
    },
    select: {
      brokerId: true,
      broker: { select: { name: true } },
      dayOfWeek: true,
      dutyType: { select: { name: true } },
      importedCell: { select: { localName: true } },
      schedule: { select: { weekStart: true } }
    }
  });
  return assignments.flatMap((assignment) => {
    const date = dateForWeekDay(assignment.schedule.weekStart, assignment.dayOfWeek);
    if (!assignment.brokerId || !assignment.broker || date > today) return [];
    return [{
      brokerId: assignment.brokerId,
      brokerName: assignment.broker.name,
      localName: assignment.importedCell?.localName || assignment.dutyType.name,
      date: date.toISOString().slice(0, 10)
    }];
  });
}
