"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { StatusPill } from "@/components/StatusPill";
import { SpreadsheetScheduleGrid } from "@/components/SpreadsheetScheduleGrid";
import { AiReviewCard } from "@/components/AiReviewCard";
import { normalizeWeekStart } from "@/lib/constants";

type PublicData = {
  salesMonthLabel?: string;
  salesYear?: number;
  weekStart?: string;
  schedule: null | {
    id: string;
    status: string;
    publishedAt?: string | null;
    import?: { id: string; fileName: string; layoutJson?: string | null } | null;
    assignments: any[];
    aiReview?: any | null;
  };
  brokers: Array<{
    id: string;
    name: string;
    salesRank: number | null;
    salesRankLabel?: string | null;
    currentMonthSalesReais?: string;
    currentYearSalesReais?: string;
    team: { name: string; isFerreira?: boolean };
  }>;
};

function nextPlanningWeekStart() {
  const today = new Date();
  const nextWeek = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7));
  return normalizeWeekStart(nextWeek).toISOString().slice(0, 10);
}

function normalizeWeekInput(value: string) {
  return normalizeWeekStart(value).toISOString().slice(0, 10);
}

export default function SalesRankingPage() {
  const [data, setData] = useState<PublicData | null>(null);
  const [me, setMe] = useState<any>(null);
  const [weekStart, setWeekStart] = useState(nextPlanningWeekStart());

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return response.json();
      })
      .then((payload) => {
        if (payload) setMe(payload.user);
      });
  }, []);

  const isManager = me?.role === "MANAGER";

  async function reload() {
    // Gerente escolhe a semana; corretor recebe a semana atual (a API força).
    const query = isManager ? `?weekStart=${weekStart}` : "";
    const response = await fetch(`/api/escala/publica${query}`, { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (response.ok) setData(await response.json());
  }

  useEffect(() => {
    if (!me) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, isManager, weekStart]);

  async function adjustAssignment(assignmentId: string, brokerId: string) {
    const response = await fetch("/api/escala/ajustar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId, brokerId })
    });
    if (response.ok) await reload();
  }

  const schedule = data?.schedule ?? null;
  const ferreiraBrokers = (data?.brokers ?? [])
    .filter((broker) => broker.team?.isFerreira)
    .map((broker) => ({ id: broker.id, name: broker.name }));

  return (
    <AppShell active="escala">
      <div className="flex flex-col gap-5">
        {/* Ranking de vendas (topo) */}
        <section className="panel rounded-lg p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Ranking de vendas</h2>
              <p className="ui-font mt-1 text-xs text-graphite">
                Ano {data?.salesYear ?? new Date().getFullYear()} e mes atual {data?.salesMonthLabel ?? ""}.
              </p>
            </div>
            <StatusPill tone="muted">valores em R$</StatusPill>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data?.brokers
              .filter((broker) => broker.salesRank)
              .sort((left, right) => (left.salesRank ?? 9999) - (right.salesRank ?? 9999))
              .map((broker) => (
                <div key={broker.id} className="ui-font rounded-md border border-graphite/15 bg-paper p-3 text-sm">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="rounded bg-ink px-2 py-1 text-xs font-bold text-paper">{broker.salesRankLabel ?? `${broker.salesRank}o`}</span>
                    <span className="font-bold">{broker.name}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-graphite/10 bg-linen/70 p-2">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-graphite">Ano {data?.salesYear ?? ""}</span>
                      <strong className="text-sm text-ink">{broker.currentYearSalesReais ?? "R$ 0,00"}</strong>
                    </div>
                    <div className="rounded border border-graphite/10 bg-linen/70 p-2">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-graphite">Mes atual</span>
                      <strong className="text-sm text-ink">{broker.currentMonthSalesReais ?? "R$ 1,00"}</strong>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>

        {/* Escala final (embaixo) */}
        <section className="panel rounded-lg p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Escala final</h2>
              <p className="ui-font mt-1 text-xs text-graphite">
                {isManager ? "Escala publicada da semana — voce pode ajustar as janelas roxas." : "Escala publicada da semana."}
              </p>
            </div>
            {isManager ? (
              <label className="ui-font text-xs font-bold">
                Semana
                <input
                  className="control mt-1 rounded-md px-2 py-1 text-sm"
                  type="date"
                  value={weekStart}
                  onChange={(event) => setWeekStart(normalizeWeekInput(event.target.value))}
                  data-help="Escolha a semana da escala (so o gerente). O app ajusta para a segunda-feira."
                />
              </label>
            ) : schedule ? (
              <StatusPill tone="ok">publicada</StatusPill>
            ) : (
              <StatusPill tone="warn">aguardando</StatusPill>
            )}
          </div>

          {schedule?.aiReview ? <AiReviewCard review={schedule.aiReview} /> : null}

          {schedule?.assignments?.length ? (
            isManager ? (
              <SpreadsheetScheduleGrid schedule={schedule} brokers={ferreiraBrokers} editable onChange={adjustAssignment} />
            ) : (
              <SpreadsheetScheduleGrid schedule={schedule} highlightBrokerId={me?.broker?.id ?? null} />
            )
          ) : (
            <div className="ui-font rounded-md border border-graphite/15 bg-paper p-4 text-sm text-graphite">
              Nenhuma escala publicada para esta semana.
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
