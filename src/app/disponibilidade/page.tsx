"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatusPill } from "@/components/StatusPill";

type UnavailabilityRange = {
  id: string;
  brokerId: string;
  brokerName: string;
  teamName: string;
  date: string;
  startHour: number | null;
  endHour: number | null;
};

type AvailabilityPayload = {
  month: string;
  role: "MANAGER" | "BROKER";
  canEdit: boolean;
  brokers: Array<{ id: string; name: string; team: { id: string; name: string } }>;
  days: Array<{ date: string; dayOfWeek: string; dayLabel: string; status: "editable" | "locked" | "past"; editable: boolean; reason: string | null }>;
  unavailabilities: UnavailabilityRange[];
};

type RangeDraft = { startHour: string; endHour: string };

const hourOptions = Array.from({ length: 25 }, (_, hour) => hour);

function monthNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthMove(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatDay(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export default function AvailabilityPage() {
  const [month, setMonth] = useState(monthNow());
  const [brokerId, setBrokerId] = useState("");
  const [data, setData] = useState<AvailabilityPayload | null>(null);
  const [ranges, setRanges] = useState<Record<string, RangeDraft>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const rangesByDate = useMemo(() => {
    const map = new Map<string, UnavailabilityRange[]>();
    for (const item of data?.unavailabilities ?? []) {
      const rows = map.get(item.date) ?? [];
      rows.push(item);
      map.set(item.date, rows);
    }
    return map;
  }, [data]);

  async function load() {
    setBusy(true);
    const params = new URLSearchParams({ month });
    if (brokerId) params.set("brokerId", brokerId);
    const response = await fetch(`/api/disponibilidade?${params.toString()}`, { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    const payload = await response.json();
    setData(payload);
    const next: Record<string, RangeDraft> = {};
    for (const item of payload.unavailabilities as UnavailabilityRange[]) {
      if (item.startHour === null || item.endHour === null) continue;
      next[item.date] = { startHour: String(item.startHour), endHour: String(item.endHour) };
    }
    setRanges(next);
    setBusy(false);
  }

  useEffect(() => {
    load();
  }, [month, brokerId]);

  function updateRange(date: string, patch: Partial<RangeDraft>) {
    const current = ranges[date] ?? { startHour: "", endHour: "" };
    setRanges({ ...ranges, [date]: { ...current, ...patch } });
  }

  function clearRange(date: string) {
    const next = { ...ranges };
    delete next[date];
    setRanges(next);
  }

  async function save() {
    if (!data?.canEdit) return;
    const editableDates = new Set(data.days.filter((day) => day.editable).map((day) => day.date));
    const payloadRanges = Object.entries(ranges)
      .filter(([date]) => editableDates.has(date))
      .filter(([, range]) => range.startHour !== "" && range.endHour !== "")
      .map(([date, range]) => ({
        date,
        startHour: Number(range.startHour),
        endHour: Number(range.endHour)
      }));
    const response = await fetch("/api/disponibilidade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, ranges: payloadRanges })
    });
    const payload = await response.json();
    setNotice(response.ok ? "Nao pode atualizado." : payload.error ?? "Falha ao salvar.");
    if (response.ok) await load();
  }

  return (
    <AppShell active="disponibilidade">
      <section className="panel rounded-lg p-4">
        <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_220px_260px] lg:items-end">
          <div>
            <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Nao pode mensal</p>
            <h2 className="text-2xl font-bold">Indisponibilidades por horario</h2>
            <p className="ui-font mt-1 text-sm text-graphite">
              Informe a faixa em hora cheia. O motor bloqueia plantões cujo horário real de início esteja dentro desse intervalo.
            </p>
          </div>
          <label className="ui-font text-sm font-bold">
            Mes
            <div className="mt-1 flex gap-2">
              <button className="rounded-md border border-graphite/20 bg-paper px-2" onClick={() => setMonth(monthMove(month, -1))} data-help="Volta um mes.">
                <ChevronLeft size={16} />
              </button>
              <input className="control min-w-0 flex-1 rounded-md px-3 py-2" type="month" value={month} onChange={(event) => setMonth(event.target.value)} data-help="Escolhe o mes do calendario Nao pode." />
              <button className="rounded-md border border-graphite/20 bg-paper px-2" onClick={() => setMonth(monthMove(month, 1))} data-help="Avanca um mes.">
                <ChevronRight size={16} />
              </button>
            </div>
          </label>
          {data?.role === "MANAGER" ? (
            <label className="ui-font text-sm font-bold">
              Corretor
              <select className="control mt-1 w-full rounded-md px-3 py-2" value={brokerId} onChange={(event) => setBrokerId(event.target.value)} data-help="Filtra indisponibilidades por corretor da equipe Ferreira.">
                <option value="">Todos os corretores Ferreira</option>
                {data.brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="ok">editavel</StatusPill>
            <StatusPill tone="warn">bloqueado</StatusPill>
            <StatusPill tone="muted">passado</StatusPill>
            {data?.role === "MANAGER" ? <StatusPill tone="muted"><Eye size={13} /> somente leitura</StatusPill> : null}
          </div>
          {data?.canEdit ? (
            <button className="ui-font inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 font-bold text-paper" onClick={save} disabled={busy} data-help="Salva as faixas de horario deste mes.">
              <Save size={16} />
              Salvar mes
            </button>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {data?.days.map((day) => {
            const draft = ranges[day.date] ?? { startHour: "", endHour: "" };
            const readOnlyRows = rangesByDate.get(day.date) ?? [];
            return (
              <article key={day.date} className={`rounded-lg border p-3 ${day.status === "editable" ? "border-graphite/15 bg-paper" : day.status === "past" ? "border-graphite/10 bg-linen/40 opacity-70" : "border-signal/20 bg-signal/5"}`}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold">{formatDay(day.date)}</div>
                    <div className="ui-font text-xs text-graphite">{day.dayLabel}</div>
                  </div>
                  <StatusPill tone={day.status === "editable" ? "ok" : day.status === "past" ? "muted" : "warn"}>
                    {day.status === "editable" ? "livre" : day.status === "past" ? "passado" : "bloq"}
                  </StatusPill>
                </div>

                {data.canEdit ? (
                  <div className="ui-font grid gap-2 text-xs font-bold">
                    <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1">
                      <select className="control min-w-0 rounded-md px-1 py-2" value={draft.startHour} onChange={(event) => updateRange(day.date, { startHour: event.target.value })} disabled={!day.editable} data-help="Hora cheia em que voce começa a estar indisponivel.">
                        <option value="">--:00</option>
                        {hourOptions.slice(0, 24).map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                      </select>
                      <span>hs até</span>
                      <select className="control min-w-0 rounded-md px-1 py-2" value={draft.endHour} onChange={(event) => updateRange(day.date, { endHour: event.target.value })} disabled={!day.editable} data-help="Hora cheia em que sua indisponibilidade termina.">
                        <option value="">--:00</option>
                        {hourOptions.slice(1).map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                      </select>
                      <span>hs</span>
                    </div>
                    <button className="rounded-md border border-graphite/15 bg-white/60 px-2 py-1 disabled:opacity-60" disabled={!day.editable} onClick={() => clearRange(day.date)} data-help="Limpa a indisponibilidade desta data.">
                      Limpar data
                    </button>
                  </div>
                ) : (
                  <div className="ui-font grid gap-2 text-xs">
                    {readOnlyRows.length ? readOnlyRows.map((row) => (
                      <div key={row.id} className="rounded-md border border-signal/20 bg-signal/10 p-2 font-bold text-signal">
                        {row.brokerName}: {hourLabel(row.startHour ?? 0)} hs até {hourLabel(row.endHour ?? 0)} hs
                      </div>
                    )) : (
                      <div className="rounded-md border border-graphite/15 bg-white/60 p-2 text-center font-bold text-graphite">sem registro</div>
                    )}
                  </div>
                )}

                {day.reason ? <p className="ui-font mt-2 text-xs text-signal">{day.reason}</p> : null}
              </article>
            );
          })}
        </div>

        {notice ? <p className="ui-font mt-4 rounded-md border border-graphite/15 bg-paper p-2 text-sm">{notice}</p> : null}
      </section>
    </AppShell>
  );
}
