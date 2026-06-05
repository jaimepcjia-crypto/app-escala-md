"use client";

import { useEffect, useState } from "react";
import { Filter } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RealScheduleGrid } from "@/components/RealScheduleGrid";
import { SpreadsheetScheduleGrid } from "@/components/SpreadsheetScheduleGrid";
import { normalizeWeekStart } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";

type PublicScheduleData = {
  weekStart: string;
  schedule: null | {
    id: string;
    status: string;
    publishedAt?: string | null;
    import?: { id: string; fileName: string; layoutJson?: string | null } | null;
    assignments: any[];
  };
};

const initialWeek = normalizeWeekStart().toISOString().slice(0, 10);

export default function PublishedSchedulePage() {
  const [weekStart, setWeekStart] = useState(initialWeek);
  const [ferreiraOnly, setFerreiraOnly] = useState(false);
  const [data, setData] = useState<PublicScheduleData | null>(null);
  const [me, setMe] = useState<any>(null);

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
        if (!payload) return;
        setMe(payload.user);
      });
  }, []);

  useEffect(() => {
    if (!me) return;
    const params = new URLSearchParams({ weekStart });
    if (ferreiraOnly) params.set("ferreiraOnly", "1");
    fetch(`/api/escala/publica?${params.toString()}`, { cache: "no-store" })
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
        if (me?.role === "BROKER" && payload.weekStart) setWeekStart(payload.weekStart);
      });
  }, [weekStart, ferreiraOnly, me]);

  return (
    <AppShell active="escala-publicada">
      <section className="panel rounded-lg p-4">
        <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_240px_280px] lg:items-end">
          <div>
            <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Visualizacao web</p>
            <h2 className="text-2xl font-bold">Escala publicada</h2>
            <div className="mt-2">
              {data?.schedule ? <StatusPill tone="ok">publicada</StatusPill> : <StatusPill tone="warn">aguardando publicacao</StatusPill>}
            </div>
          </div>
          <label className="ui-font text-sm font-bold">
            Semana
            <input
              className="control mt-1 w-full rounded-md px-3 py-2"
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
              disabled={me?.role === "BROKER"}
              data-help={me?.role === "BROKER" ? "Corretores visualizam somente a escala atual em vigor." : "Escolhe a semana da escala publicada."}
            />
          </label>
          <div className="ui-font text-sm font-bold">
            <span className="inline-flex items-center gap-2"><Filter size={15} />Filtro</span>
            <label className="control mt-1 flex min-h-[42px] items-center gap-3 rounded-md px-3 py-2 font-bold" data-help="Quando marcado, mostra somente os plantões preenchidos pela equipe Ferreira nas janelas roxas.">
              <input
                type="checkbox"
                checked={ferreiraOnly}
                onChange={(event) => setFerreiraOnly(event.target.checked)}
              />
              So equipe Ferreira
            </label>
          </div>
        </div>

        {data?.schedule?.assignments?.length ? (
          ferreiraOnly ? (
            <RealScheduleGrid assignments={data.schedule.assignments} highlightBrokerId={me?.role === "BROKER" ? me.broker?.id : null} />
          ) : (
            <SpreadsheetScheduleGrid schedule={data.schedule} highlightBrokerId={me?.role === "BROKER" ? me.broker?.id : null} />
          )
        ) : (
          <div className="ui-font rounded-md border border-graphite/15 bg-paper p-4 text-sm text-graphite">
            Nenhuma escala publicada para a semana selecionada.
          </div>
        )}
      </section>
    </AppShell>
  );
}
