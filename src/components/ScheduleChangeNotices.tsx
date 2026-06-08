"use client";

import { DAYS } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";

type Notice = {
  id: string;
  previousBrokerName?: string | null;
  newBrokerName?: string | null;
  localName: string;
  dayOfWeek: string;
  timeLabel?: string | null;
  startHour?: number | null;
  warningsJson: string;
  confirmedAt: string;
};

function warnings(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function ScheduleChangeNotices({ notices }: { notices?: Notice[] }) {
  if (!notices?.length) return null;
  return (
    <section className="ui-font mb-4 rounded-md border-2 border-signal/40 bg-signal/10 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong>Avisos de alterações confirmadas pelo gerente</strong>
        <StatusPill tone="warn">{notices.length} mudança(s)</StatusPill>
      </div>
      <div className="grid gap-2">
        {notices.map((notice) => {
          const rows = warnings(notice.warningsJson);
          const day = DAYS.find((item) => item.key === notice.dayOfWeek)?.label ?? notice.dayOfWeek;
          const time = notice.timeLabel || (notice.startHour !== null && notice.startHour !== undefined ? `${String(notice.startHour).padStart(2, "0")}:00` : "horário importado");
          return (
            <div key={notice.id} className="rounded-md border border-signal/25 bg-paper p-2">
              <div className="font-bold">{notice.localName} · {day} · {time}</div>
              <div>{notice.previousBrokerName ?? "Sem cobertura"} → {notice.newBrokerName ?? "Sem cobertura"}</div>
              <div className="mt-1 text-xs font-bold text-signal">Mudança solicitada e confirmada expressamente pelo gerente via IA.</div>
              {rows.length ? <ul className="mt-1 list-disc pl-5 text-xs text-signal">{rows.map((row) => <li key={row}>{row}</li>)}</ul> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
