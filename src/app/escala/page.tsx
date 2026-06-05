"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { StatusPill } from "@/components/StatusPill";

type RankingData = {
  salesMonthLabel?: string;
  salesYear?: number;
  brokers: Array<{
    id: string;
    name: string;
    salesRank: number | null;
    salesRankLabel?: string | null;
    currentMonthSalesReais?: string;
    currentYearSalesReais?: string;
    team: { name: string };
  }>;
};

export default function SalesRankingPage() {
  const [data, setData] = useState<RankingData | null>(null);

  useEffect(() => {
    fetch("/api/escala/publica", { cache: "no-store" })
      .then((response) => {
        if (response.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return response.json();
      })
      .then((payload) => {
        if (!payload) return;
        setData(payload);
      });
  }, []);

  return (
    <AppShell active="escala">
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
    </AppShell>
  );
}
