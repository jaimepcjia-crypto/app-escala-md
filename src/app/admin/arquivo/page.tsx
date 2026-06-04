"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CalendarSearch, Loader2, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SpreadsheetScheduleGrid } from "@/components/SpreadsheetScheduleGrid";
import { normalizeWeekStart } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";

type ArchiveImport = {
  id: string;
  weekStart: string;
  fileName: string;
  fileType: string;
  status: string;
  createdAt: string;
  confirmedAt?: string | null;
  summary: { total: number; ferreiraWindows: number; external: number };
};

type ArchiveSchedule = {
  id: string;
  weekStart: string;
  status: string;
  publishedAt?: string | null;
  importFileName?: string | null;
  import?: { id: string; fileName: string; layoutJson?: string | null } | null;
  assignments: any[];
};

type ArchivePayload = {
  imports: ArchiveImport[];
  schedules: ArchiveSchedule[];
};

function nextPlanningWeekStart() {
  const today = new Date();
  const nextWeek = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7));
  return normalizeWeekStart(nextWeek).toISOString().slice(0, 10);
}

function normalizeWeekInput(value: string) {
  return normalizeWeekStart(value).toISOString().slice(0, 10);
}

function weekRangeLabel(weekStart: string) {
  const start = normalizeWeekStart(weekStart);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${formatDate(start.toISOString())} ate ${formatDate(end.toISOString())}`;
}

const initialWeek = nextPlanningWeekStart();

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

export default function AdminArchivePage() {
  const [weekStart, setWeekStart] = useState(initialWeek);
  const [data, setData] = useState<ArchivePayload | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const selectedSchedule = useMemo(() => {
    return data?.schedules.find((schedule) => schedule.id === selectedScheduleId) ?? data?.schedules[0] ?? null;
  }, [data, selectedScheduleId]);

  async function load() {
    setBusy(true);
    const response = await fetch("/api/admin/archive", { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    const payload = await response.json();
    setData(payload);
    setSelectedScheduleId((current) => current || payload.schedules[0]?.id || "");
    setBusy(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function importSchedule() {
    if (!file) {
      setNotice("Clique primeiro em Escolher ficheiro e selecione o XLSX semanal recebido pelo Ferreira.");
      return;
    }
    try {
      setBusy(true);
      setNotice(`Importando ${file.name}...`);
      const formData = new FormData();
      formData.set("weekStart", weekStart);
      formData.set("file", file);
      const response = await fetch("/api/escala/importar", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao importar escala.");
      setNotice(`Arquivo importado. Agora confirme abaixo para a IA usar: ${payload.summary.ferreiraWindows} janelas roxas e ${payload.summary.external} plantões externos.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao importar escala.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(importId: string) {
    try {
      setBusy(true);
      const response = await fetch("/api/escala/importar/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao confirmar importacao.");
      setNotice("Arquivo confirmado e definido como escala válida da semana. Volte ao painel do gerente para gerar a nova distribuição.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao confirmar importacao.");
    } finally {
      setBusy(false);
    }
  }

  const importsForWeek = data?.imports.filter((item) => item.weekStart === weekStart) ?? [];

  return (
    <AppShell active="arquivo">
      <section className="grid gap-5 lg:grid-cols-[400px_1fr]">
        <aside className="flex flex-col gap-5">
          <section className="panel rounded-lg p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Arquivo do gerente</p>
                <h2 className="text-xl font-bold">Importações semanais</h2>
              </div>
              {busy ? <Loader2 className="animate-spin text-steel" size={20} /> : <Archive size={22} className="text-steel" />}
            </div>
            <label className="ui-font mb-3 block text-sm font-bold">
              Semana do arquivo
              <input
                className="control mt-1 w-full rounded-md px-3 py-2"
                type="date"
                value={weekStart}
                onChange={(event) => setWeekStart(normalizeWeekInput(event.target.value))}
                data-help="Escolha qualquer data; o app ajusta para a segunda-feira da semana do arquivo."
              />
            </label>
            <div className="ui-font mb-3 rounded-md border border-graphite/15 bg-paper p-2 text-sm">
              <div className="font-bold">Vigencia: {weekRangeLabel(weekStart)}</div>
              <div className="mt-1 text-xs text-graphite">O arquivo importado vale sempre de segunda-feira a domingo.</div>
            </div>
            <input
              ref={fileInputRef}
              className="control mb-2 w-full rounded-md px-3 py-2 text-sm"
              type="file"
              accept=".xlsx"
              onChange={(event) => {
                const selectedFile = event.target.files?.[0] ?? null;
                setFile(selectedFile);
                setNotice(selectedFile ? `Arquivo escolhido: ${selectedFile.name}. Clique em Importar XLSX.` : "");
              }}
              data-help="Seleciona o XLSX semanal recebido pelo Ferreira."
            />
            <div className="ui-font mb-2 rounded-md border border-graphite/15 bg-paper p-2 text-xs">
              <span className="font-bold">Arquivo selecionado: </span>
              <span className={file ? "text-ink" : "text-graphite"}>{file?.name ?? "nenhum arquivo selecionado"}</span>
            </div>
            <button
              className="ui-font inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 font-bold text-paper disabled:cursor-not-allowed disabled:opacity-50"
              onClick={importSchedule}
              disabled={busy || !file}
              data-help="Envia o XLSX para preservar a formatação original e ler as janelas roxas."
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
              Importar XLSX
            </button>
            <p className="ui-font mt-2 text-xs text-graphite">
              Fluxo: escolha o XLSX, importe, confirme o arquivo na lista abaixo e então peça para a IA gerar e publicar a escala.
              Para manter a escala fiel ao arquivo original, PDF e XLS antigo são rejeitados.
            </p>
            {notice ? <p className="ui-font mt-3 rounded-md border border-graphite/15 bg-paper p-2 text-sm">{notice}</p> : null}
          </section>

          <section className="panel rounded-lg p-4">
            <h2 className="mb-3 text-xl font-bold">Arquivos da semana</h2>
            <div className="grid gap-2">
              {importsForWeek.length ? importsForWeek.map((item) => (
                <div key={item.id} className="ui-font rounded-md border border-graphite/15 bg-paper p-3 text-sm">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="font-bold">{item.fileName}</div>
                    <StatusPill tone={item.status === "CONFIRMED" ? "ok" : item.status === "SUPERSEDED" ? "muted" : "warn"}>{item.status}</StatusPill>
                  </div>
                  <div className="text-xs text-graphite">
                    {item.summary.ferreiraWindows} roxas · {item.summary.external} externas · importado em {formatDate(item.createdAt)}
                  </div>
                  {item.status !== "CONFIRMED" && item.status !== "SUPERSEDED" ? (
                    <button className="mt-2 rounded-md bg-signal px-2 py-1 text-xs font-bold text-paper" onClick={() => confirmImport(item.id)} data-help="Usa este arquivo como escala válida da semana e substitui o anterior.">
                      Confirmar e substituir
                    </button>
                  ) : null}
                </div>
              )) : (
                <p className="ui-font rounded-md border border-graphite/15 bg-paper p-3 text-sm text-graphite">Nenhum arquivo importado para esta semana.</p>
              )}
            </div>
          </section>

          <section className="panel rounded-lg p-4">
            <h2 className="mb-3 text-xl font-bold">Escalas publicadas</h2>
            <div className="grid gap-2">
              {data?.schedules.length ? data.schedules.map((schedule) => (
                <button
                  key={schedule.id}
                  className={`ui-font rounded-md border p-3 text-left text-sm ${selectedSchedule?.id === schedule.id ? "border-ink bg-ink text-paper" : "border-graphite/15 bg-paper hover:border-signal"}`}
                  onClick={() => setSelectedScheduleId(schedule.id)}
                  data-help="Abre esta escala publicada no arquivo do gerente."
                >
                  <span className="mb-1 flex items-center justify-between gap-2">
                    <strong>Semana {formatDate(schedule.weekStart)}</strong>
                    <CalendarSearch size={16} />
                  </span>
                  <span className="block text-xs opacity-80">
                    Publicada em {formatDate(schedule.publishedAt)} · {schedule.importFileName ?? "sem arquivo vinculado"}
                  </span>
                </button>
              )) : (
                <p className="ui-font rounded-md border border-graphite/15 bg-paper p-3 text-sm text-graphite">Nenhuma escala publicada ainda.</p>
              )}
            </div>
          </section>
        </aside>

        <section className="panel rounded-lg p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Histórico exclusivo do gerente</p>
              <h2 className="text-xl font-bold">{selectedSchedule ? `Semana ${formatDate(selectedSchedule.weekStart)}` : "Nenhuma escala selecionada"}</h2>
            </div>
            {selectedSchedule ? <StatusPill tone="ok">publicada</StatusPill> : <StatusPill tone="warn">sem escala</StatusPill>}
          </div>
          {selectedSchedule?.assignments.length ? (
            <SpreadsheetScheduleGrid schedule={selectedSchedule} />
          ) : (
            <div className="ui-font rounded-md border border-graphite/15 bg-paper p-4 text-sm text-graphite">
              Selecione uma escala publicada para visualizar o histórico.
            </div>
          )}
        </section>
      </section>
    </AppShell>
  );
}
