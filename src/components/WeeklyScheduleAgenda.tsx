"use client";

import { AlertTriangle, BriefcaseBusiness, Clock3, MapPin, Sparkles, UserRound } from "lucide-react";
import { addDays } from "@/lib/deadlines";
import {
  agendaStats,
  assignmentName,
  assignmentTime,
  assignmentWarnings,
  buildWeeklyAgenda,
  type AgendaAssignment
} from "@/lib/schedule-agenda";
import { StatusPill } from "@/components/StatusPill";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(date).replace(".", "");
}

function dayAnchor(day: string) {
  return `agenda-${day.toLowerCase()}`;
}

export function WeeklyScheduleAgenda({
  assignments,
  weekStart,
  brokerId,
  isManager
}: {
  assignments: AgendaAssignment[];
  weekStart: string;
  brokerId?: string | null;
  isManager: boolean;
}) {
  const days = buildWeeklyAgenda(assignments);
  const stats = agendaStats(assignments);
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const ownAssignments = brokerId ? assignments.filter((assignment) => assignment.broker?.id === brokerId) : [];

  return (
    <div className="grid gap-5">
      {isManager ? (
        <ManagerSummary stats={stats} />
      ) : (
        <PersonalSummary assignments={ownAssignments} start={start} />
      )}

      <nav className="ui-font sticky top-2 z-20 flex gap-2 overflow-x-auto rounded-2xl border border-graphite/10 bg-paper/95 p-2 shadow-panel backdrop-blur-xl" aria-label="Navegação rápida pelos dias">
        {days.map((day, index) => (
          <a key={day.key} href={`#${dayAnchor(day.key)}`} className="flex min-w-28 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-bold text-graphite transition hover:bg-ink hover:text-paper">
            <span>{day.short}</span>
            <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] text-ink">{day.assignments.length}</span>
            <span className="sr-only">{formatDate(addDays(start, index))}</span>
          </a>
        ))}
      </nav>

      <div className="grid gap-6">
        {days.map((day, index) => (
          <article key={day.key} id={dayAnchor(day.key)} className="scroll-mt-24 overflow-hidden rounded-[26px] border border-graphite/10 bg-white/65 shadow-panel">
            <header className="flex flex-wrap items-end justify-between gap-4 bg-ink px-5 py-4 text-paper sm:px-6">
              <div className="flex items-end gap-4">
                <div className="text-4xl font-semibold text-sand">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <p className="ui-font text-[10px] font-bold uppercase tracking-[0.18em] text-sand">{formatDate(addDays(start, index))}</p>
                  <h3 className="text-2xl font-semibold">{day.label}</h3>
                </div>
              </div>
              <StatusPill tone="muted">{day.assignments.length} plantões</StatusPill>
            </header>

            <div className="grid gap-5 p-4 sm:p-5">
              <AgendaBlock
                title="Equipe Ferreira"
                description="Plantões distribuídos pelo motor para a equipe."
                groups={day.ferreira}
                kind="ferreira"
                brokerId={brokerId}
              />
              <AgendaBlock
                title="Já definidos no arquivo"
                description="Nomes que chegaram preenchidos no XLSX e foram preservados."
                groups={day.prefilled}
                kind="prefilled"
                brokerId={brokerId}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ManagerSummary({ stats }: { stats: ReturnType<typeof agendaStats> }) {
  return (
    <section className="hero-panel overflow-hidden rounded-[26px]">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="eyebrow">Visão operacional</p>
          <h3 className="mt-1 text-2xl font-semibold">Leitura completa da semana</h3>
        </div>
        <BriefcaseBusiness className="text-signal" size={26} />
      </div>
      <div className="grid border-t border-graphite/10 bg-white/50 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric label="Total" value={stats.total} />
        <SummaryMetric label="Equipe Ferreira" value={stats.ferreira} />
        <SummaryMetric label="Já definidos" value={stats.prefilled} />
        <SummaryMetric label="Alertas" value={stats.alerts} warn={stats.alerts > 0} />
      </div>
    </section>
  );
}

function SummaryMetric({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return <div className="flex items-center justify-between border-b border-graphite/10 px-5 py-4 last:border-0 sm:border-r sm:last:border-r-0"><span className="ui-font text-xs font-bold uppercase tracking-[0.12em] text-graphite">{label}</span><strong className={warn ? "text-2xl text-signal" : "text-2xl"}>{value}</strong></div>;
}

function PersonalSummary({ assignments, start }: { assignments: AgendaAssignment[]; start: Date }) {
  const days = buildWeeklyAgenda(assignments).filter((day) => day.assignments.length);
  return (
    <section className="overflow-hidden rounded-[26px] border border-sand/40 bg-gradient-to-br from-[#231f19] to-ink text-paper shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div>
          <p className="ui-font text-[10px] font-bold uppercase tracking-[0.18em] text-sand">Minha semana</p>
          <h3 className="mt-1 text-2xl font-semibold">{assignments.length ? `${assignments.length} plantão(ões) confirmado(s)` : "Nenhum plantão nesta semana"}</h3>
        </div>
        <Sparkles className="text-sand" size={28} />
      </div>
      {days.length ? (
        <div className="grid gap-px bg-white/10 sm:grid-cols-2 xl:grid-cols-3">
          {days.map((day, index) => (
            <a key={day.key} href={`#${dayAnchor(day.key)}`} className="ui-font bg-paper/5 p-4 transition hover:bg-paper/10">
              <div className="mb-2 flex items-center justify-between gap-2"><strong>{day.label}</strong><span className="text-xs text-sand">{formatDate(addDays(start, DAYS_INDEX[day.key] ?? index))}</span></div>
              <div className="grid gap-1 text-xs text-paper/75">{day.assignments.map((assignment) => <span key={assignment.id}>{assignmentTime(assignment)} · {assignment.dutyType.name}</span>)}</div>
            </a>
          ))}
        </div>
      ) : <p className="ui-font border-t border-white/10 p-5 text-sm text-paper/65">Você pode consultar abaixo toda a operação publicada.</p>}
    </section>
  );
}

const DAYS_INDEX: Record<string, number> = { MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3, FRIDAY: 4, SATURDAY: 5, SUNDAY: 6 };

function AgendaBlock({
  title,
  description,
  groups,
  kind,
  brokerId
}: {
  title: string;
  description: string;
  groups: Array<{ local: string; assignments: AgendaAssignment[] }>;
  kind: "ferreira" | "prefilled";
  brokerId?: string | null;
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={kind === "ferreira" ? "eyebrow text-moss" : "eyebrow"}>{title}</p>
          <p className="ui-font mt-1 text-xs text-graphite">{description}</p>
        </div>
        <StatusPill tone={kind === "ferreira" ? "ok" : "muted"}>{groups.reduce((total, group) => total + group.assignments.length, 0)}</StatusPill>
      </div>
      {groups.length ? (
        <div className="grid gap-3">
          {groups.map((group) => (
            <div key={group.local} className="rounded-2xl border border-graphite/10 bg-paper/65 p-3 sm:p-4">
              <div className="mb-3 flex items-center gap-2">
                <MapPin size={15} className={kind === "ferreira" ? "text-moss" : "text-signal"} />
                <h4 className="ui-font text-sm font-bold">{group.local}</h4>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {group.assignments.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} kind={kind} highlighted={Boolean(brokerId && assignment.broker?.id === brokerId)} />)}
              </div>
            </div>
          ))}
        </div>
      ) : <div className="ui-font rounded-2xl border border-dashed border-graphite/15 p-4 text-center text-xs text-graphite">Nenhum plantão neste bloco.</div>}
    </section>
  );
}

function AssignmentCard({ assignment, kind, highlighted }: { assignment: AgendaAssignment; kind: "ferreira" | "prefilled"; highlighted: boolean }) {
  const warnings = assignmentWarnings(assignment);
  const managerChange = assignment.assignmentType === "FERREIRA_MANAGER_AI";
  const alert = assignment.isViolation || warnings.length > 0;
  return (
    <div className={`ui-font relative overflow-hidden rounded-xl border p-3 text-xs shadow-sm ${highlighted ? "border-sand bg-sand/20 ring-2 ring-sand/35" : alert ? "border-signal/35 bg-signal/10" : managerChange ? "border-signal/25 bg-signal/5" : kind === "ferreira" ? "border-moss/20 bg-moss/10" : "border-steel/15 bg-white/75"}`}>
      <div className={`absolute inset-y-0 left-0 w-1 ${highlighted ? "bg-sand" : alert ? "bg-signal" : kind === "ferreira" ? "bg-moss" : "bg-steel"}`} />
      <div className="flex items-center justify-between gap-2 pl-1">
        <span className="inline-flex items-center gap-1 font-bold text-graphite"><Clock3 size={13} /> {assignmentTime(assignment)}</span>
        {alert ? <AlertTriangle size={14} className="text-signal" /> : managerChange ? <Sparkles size={14} className="text-signal" /> : null}
      </div>
      <div className="mt-2 flex items-center gap-2 pl-1">
        <UserRound size={15} className={highlighted ? "text-sand" : kind === "ferreira" ? "text-moss" : "text-steel"} />
        <strong className="text-sm">{assignmentName(assignment)}</strong>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 pl-1">
        <StatusPill tone={kind === "ferreira" ? "ok" : "muted"}>{kind === "ferreira" ? "Equipe Ferreira" : "Definido no arquivo"}</StatusPill>
        {highlighted ? <StatusPill tone="muted">meu plantão</StatusPill> : null}
        {managerChange ? <StatusPill tone="warn">gerente via IA</StatusPill> : null}
      </div>
      {warnings.length ? <div className="mt-2 grid gap-1 border-t border-signal/20 pt-2 pl-1 text-[11px] font-bold text-signal">{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}
    </div>
  );
}
