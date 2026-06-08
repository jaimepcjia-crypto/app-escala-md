"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, MapPin, Search, Sparkles, X } from "lucide-react";
import { DAYS } from "@/lib/constants";
import {
  assignmentName,
  assignmentWarnings,
  buildScheduleGrid,
  type AgendaAssignment
} from "@/lib/schedule-agenda";

function localAnchor(local: string) {
  return `local-${local.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function WeeklyScheduleAgenda({
  assignments,
  brokerId
}: {
  assignments: AgendaAssignment[];
  weekStart: string;
  brokerId?: string | null;
  isManager: boolean;
}) {
  const [query, setQuery] = useState("");
  const [localFilter, setLocalFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [mobileDay, setMobileDay] = useState("MONDAY");
  const grid = useMemo(() => buildScheduleGrid(assignments), [assignments]);
  const locals = grid.map((group) => group.local);
  const visibleGrid = localFilter ? grid.filter((group) => group.local === localFilter) : grid;
  const visibleDays = dayFilter ? DAYS.filter((day) => day.key === dayFilter) : DAYS;
  const activeMobileDay = dayFilter || mobileDay;

  function clearFilters() {
    setQuery("");
    setLocalFilter("");
    setDayFilter("");
  }

  return (
    <div className="grid gap-4">
      <section className="panel rounded-2xl p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_240px_190px_auto]">
          <label className="ui-font relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite" size={15} />
            <input className="control w-full rounded-xl py-2 pl-9 pr-3 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar corretor ou nome no plantão" />
          </label>
          <select className="control rounded-xl px-3 py-2 text-sm" value={localFilter} onChange={(event) => setLocalFilter(event.target.value)}>
            <option value="">Todos os locais</option>
            {locals.map((local) => <option key={local} value={local}>{local}</option>)}
          </select>
          <select className="control rounded-xl px-3 py-2 text-sm" value={dayFilter} onChange={(event) => setDayFilter(event.target.value)}>
            <option value="">Todos os dias</option>
            {DAYS.map((day) => <option key={day.key} value={day.key}>{day.label}</option>)}
          </select>
          <button className="action-secondary whitespace-nowrap" onClick={clearFilters}><X size={14} /> Limpar</button>
        </div>
        <div className="ui-font mt-3 flex flex-wrap items-center gap-4 text-[11px] text-graphite">
          <Legend color="bg-moss" label="Equipe Ferreira" />
          <Legend color="bg-steel" label="Definido no arquivo" />
          <Legend color="bg-sand" label="Meu plantão" />
          <Legend color="bg-signal" label="Alerta ou mudança" />
        </div>
      </section>

      <nav className="ui-font flex gap-2 overflow-x-auto rounded-xl border border-graphite/10 bg-white/55 p-2 text-xs font-bold">
        {visibleGrid.map((group) => <a key={group.local} href={`#${localAnchor(group.local)}`} className="whitespace-nowrap rounded-lg px-3 py-2 text-graphite hover:bg-ink hover:text-paper">{group.local}</a>)}
      </nav>

      <div className="ui-font flex gap-1 overflow-x-auto rounded-xl border border-graphite/10 bg-paper p-1 md:hidden">
        {visibleDays.map((day) => <button key={day.key} className={`min-w-20 flex-1 rounded-lg px-3 py-2 text-xs font-bold ${activeMobileDay === day.key ? "bg-ink text-paper" : "text-graphite"}`} onClick={() => setMobileDay(day.key)}>{day.short}</button>)}
      </div>

      <div className="grid gap-4">
        {visibleGrid.map((localGroup) => (
          <section key={localGroup.local} id={localAnchor(localGroup.local)} className="scroll-mt-24 overflow-hidden rounded-2xl border border-graphite/15 bg-white/65 shadow-panel">
            <header className="flex items-center gap-2 border-b border-graphite/10 bg-ink px-4 py-3 text-paper">
              <MapPin size={15} className="text-sand" />
              <h3 className="text-base font-bold">{localGroup.local}</h3>
            </header>

            <div className={`grid ${visibleDays.length === 7 ? "md:grid-cols-7" : ""}`} style={visibleDays.length !== 7 ? { gridTemplateColumns: `repeat(${visibleDays.length}, minmax(0, 1fr))` } : undefined}>
              {visibleDays.map((day) => {
                const dayGroup = localGroup.days.find((item) => item.key === day.key)!;
                return <DayColumn key={day.key} day={day} times={dayGroup.times} brokerId={brokerId} query={query} visibleMobile={activeMobileDay === day.key} />;
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{label}</span>;
}

function DayColumn({
  day,
  times,
  brokerId,
  query,
  visibleMobile
}: {
  day: { key: string; label: string; short: string };
  times: Array<{ time: string; assignments: AgendaAssignment[] }>;
  brokerId?: string | null;
  query: string;
  visibleMobile: boolean;
}) {
  return (
    <div className={`min-w-0 border-graphite/10 md:block md:border-r md:last:border-r-0 ${visibleMobile ? "block" : "hidden"}`}>
      <div className="border-b border-graphite/10 bg-linen/55 px-2 py-2 text-center text-xs font-bold uppercase tracking-[0.08em]">{day.label}</div>
      <div className="grid gap-2 p-2">
        {times.length ? times.map((group) => (
          <div key={group.time} className="overflow-hidden rounded-lg border border-graphite/10 bg-paper/65">
            <div className="border-b border-graphite/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-graphite">{group.time}</div>
            <div className="grid gap-px bg-graphite/10">
              {group.assignments.map((assignment) => <AssignmentLine key={assignment.id} assignment={assignment} brokerId={brokerId} query={query} />)}
            </div>
          </div>
        )) : <div className="py-5 text-center text-[11px] text-graphite/50">Sem plantão</div>}
      </div>
    </div>
  );
}

function AssignmentLine({ assignment, brokerId, query }: { assignment: AgendaAssignment; brokerId?: string | null; query: string }) {
  const name = assignmentName(assignment);
  const warnings = assignmentWarnings(assignment);
  const mine = Boolean(brokerId && assignment.broker?.id === brokerId);
  const managerChange = assignment.assignmentType === "FERREIRA_MANAGER_AI";
  const alert = assignment.isViolation || warnings.length > 0 || managerChange;
  const match = Boolean(query.trim() && name.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")));
  const origin = assignment.assignmentType === "EXTERNAL_IMPORTED" ? "bg-steel/10 border-steel/25" : "bg-moss/10 border-moss/25";

  return (
    <div
      data-assignment-id={assignment.id}
      className={`relative flex min-h-7 items-center gap-1 border-l-4 px-2 py-1 text-[11px] leading-tight ${mine ? "border-sand bg-sand/25 font-black" : alert ? "border-signal bg-signal/10 font-bold" : `${origin} font-semibold`} ${match ? "ring-2 ring-inset ring-signal" : ""}`}
      title={warnings.join(" | ") || (managerChange ? "Mudança confirmada pelo gerente via IA." : undefined)}
    >
      <span className="min-w-0 flex-1 break-words">{name}</span>
      {alert ? <AlertTriangle className="shrink-0 text-signal" size={11} /> : mine ? <Sparkles className="shrink-0 text-sand" size={11} /> : null}
    </div>
  );
}
