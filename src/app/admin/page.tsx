"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArrowDown, ArrowUp, Copy, Download, GripVertical, KeyRound, Loader2, Plus, RefreshCw, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BrokersSalesPanel, accessUrlFor, type BrokerSnapshot, type BrokerSavePatch } from "@/components/BrokersSalesPanel";
import { normalizeWeekStart } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";

type Snapshot = {
  weekStart: string;
  salesMonthStart: string;
  teams: { id: string; name: string; isFerreira: boolean }[];
  brokers: BrokerSnapshot[];
  schedules: Array<{ id: string; status: "DRAFT" | "PUBLISHED"; publishedAt?: string | null }>;
  imports: Array<{ id: string; fileName: string; status: string; cells: Array<{ id: string; ownerType: string }> }>;
  readiness: { totalFerreiraBrokers: number; confirmed: number; allConfirmed: boolean };
  plantaoPriorities: Array<{ localName: string; position: number }>;
};

type ArchiveImport = {
  id: string;
  weekStart: string;
  fileName: string;
  status: string;
  createdAt: string;
  summary: { total: number; ferreiraWindows: number; external: number };
};

type ArchiveSchedule = {
  id: string;
  weekStart: string;
  status: string;
  publishedAt?: string | null;
  importFileName?: string | null;
};

type ArchivePayload = {
  imports: ArchiveImport[];
  schedules: ArchiveSchedule[];
  brokers: BrokerSnapshot[];
  salesMonthStart: string;
  managerEmail: string;
};

function formatDateBr(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(date);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

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
  return `${formatDateBr(start)} ate ${formatDateBr(end)}`;
}

function historyScheduleLabel(weekStart: string) {
  const start = normalizeWeekStart(weekStart);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  return `Semana ${formatDate(start.toISOString())} a ${formatDate(end.toISOString())} · ${month}`;
}

const initialWeek = nextPlanningWeekStart();

function reservationSummary(items: Array<{ localName: string }>) {
  if (!items.length) return "Importe e confirme o arquivo da semana para ordenar os plantoes.";
  const first = items[0]?.localName ?? "-";
  const second = items[1]?.localName ?? "-";
  const third = items[2]?.localName ?? "-";
  return `Reservas: as faixas de vendas 1o/2o concorrem a 40% de ${first}; 3o/4o a 40% de ${second}; 5o/6o a 40% de ${third}. Empates entram juntos e nao sao desempate por nome.`;
}

export default function AdminPage() {
  const [weekStart, setWeekStart] = useState(initialWeek);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [archive, setArchive] = useState<ArchivePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [iaCommand, setIaCommand] = useState("");
  const [iaAnswer, setIaAnswer] = useState("");
  const [iaBusy, setIaBusy] = useState(false);
  const [newBroker, setNewBroker] = useState({ name: "", email: "", initialPassword: "", canExternalDuty: true, active: true });
  const [managerPassword, setManagerPassword] = useState({ currentPassword: "", newPassword: "" });
  const [priorityNotice, setPriorityNotice] = useState("");
  const priorityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setBusy(true);
    const [snapRes, archRes] = await Promise.all([
      fetch(`/api/admin?weekStart=${weekStart}`, { cache: "no-store" }),
      fetch(`/api/admin/archive?weekStart=${weekStart}`, { cache: "no-store" })
    ]);
    if (snapRes.status === 401 || archRes.status === 401) {
      window.location.href = "/login";
      return;
    }
    setSnapshot(await snapRes.json());
    setArchive(await archRes.json());
    setBusy(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    return () => {
      if (priorityTimer.current) clearTimeout(priorityTimer.current);
    };
  }, []);

  async function postAdmin(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Falha administrativa.");
    return data;
  }

  async function createBroker() {
    try {
      await postAdmin({ action: "createBroker", ...newBroker });
      setNewBroker({ name: "", email: "", initialPassword: "", canExternalDuty: true, active: true });
      setNotice("Corretor criado.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao criar corretor.");
    }
  }

  async function changeManagerPassword() {
    try {
      await postAdmin({ action: "changeOwnPassword", ...managerPassword });
      setManagerPassword({ currentPassword: "", newPassword: "" });
      setNotice("Senha do gerente atualizada.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao alterar senha do gerente.");
    }
  }

  async function updateBroker(broker: BrokerSnapshot, patch: BrokerSavePatch) {
    try {
      await postAdmin({
        action: "updateBroker",
        id: broker.id,
        name: patch.name ?? broker.name,
        email: patch.user?.email ?? broker.user?.email,
        password: patch.password ?? "",
        canExternalDuty: patch.canExternalDuty ?? broker.canExternalDuty,
        active: patch.active ?? broker.active
      });
      setNotice("Corretor atualizado.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao atualizar corretor.");
    }
  }

  async function deleteBroker(broker: BrokerSnapshot) {
    const confirmed = window.confirm(`Excluir ${broker.name}? O login dele sera removido e plantões antigos ficarao sem corretor vinculado.`);
    if (!confirmed) return;
    try {
      await postAdmin({ action: "deleteBroker", id: broker.id });
      setNotice(`${broker.name} excluido do cadastro.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao excluir corretor.");
    }
  }

  async function updateMonthlySale(broker: BrokerSnapshot, amountReais: string) {
    try {
      await postAdmin({ action: "updateMonthlySale", brokerId: broker.id, weekStart, amountReais });
      setNotice("Venda mensal atualizada e ranking recalculado.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao atualizar venda mensal.");
    }
  }

  async function copyManagerLink() {
    if (!archive?.managerEmail) return;
    try {
      await navigator.clipboard.writeText(accessUrlFor(archive.managerEmail));
      setNotice("Link de acesso do gerente copiado.");
    } catch {
      setNotice("Nao foi possivel copiar (navegador bloqueou). Copie manualmente o link mostrado.");
    }
  }

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
      setNotice(`Arquivo importado. Confirme na lista abaixo: ${payload.summary.ferreiraWindows} janelas roxas e ${payload.summary.external} plantões externos.`);
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
      setNotice("Arquivo confirmado. Agora peça à IA: \"publique a escala\".");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao confirmar importacao.");
    } finally {
      setBusy(false);
    }
  }

  async function savePriorities(items: Array<{ localName: string; position: number }>) {
    try {
      await postAdmin({ action: "updateDutyPriorities", items });
      const text = reservationSummary(items);
      setPriorityNotice(text);
      if (priorityTimer.current) clearTimeout(priorityTimer.current);
      priorityTimer.current = setTimeout(() => setPriorityNotice(""), 30_000);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao salvar prioridade.");
    }
  }

  function movePriority(fromIndex: number, toIndex: number) {
    if (!snapshot) return;
    const items = [...snapshot.plantaoPriorities];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    const normalized = items.map((item, index) => ({ localName: item.localName, position: index + 1 }));
    setSnapshot({ ...snapshot, plantaoPriorities: normalized });
    savePriorities(normalized);
  }

  async function askIa(commandOverride?: string) {
    const command = (commandOverride ?? iaCommand).trim();
    if (!command) {
      setIaAnswer("IA: digite uma ordem antes de enviar.");
      return;
    }
    try {
      setIaBusy(true);
      setIaAnswer(`IA: processando "${command}"...`);
      const response = await fetch("/api/ia/comando", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart, command })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao executar comando da IA.");
      setIaAnswer(data.message ?? "IA: comando executado.");
      setIaCommand("");
      await load();
    } catch (error) {
      setIaAnswer(error instanceof Error ? `IA: ${error.message}` : "IA: falha ao executar comando.");
    } finally {
      setIaBusy(false);
    }
  }

  const importsForWeek = archive?.imports.filter((item) => item.weekStart === weekStart) ?? [];

  return (
    <AppShell active="admin">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        {/* Cards de controle e gestão (colunas) */}
        <div className="gap-5 md:columns-2 xl:columns-3">
          {/* CARD ÚNICO: semana → importar XLSX → IA gera/publica/cancela */}
          <div className="panel mb-5 break-inside-avoid rounded-lg p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Controle</p>
                <h2 className="text-xl font-bold">Montar e publicar a escala</h2>
              </div>
              {busy ? <Loader2 className="animate-spin text-steel" size={20} /> : <StatusPill tone="ok">online</StatusPill>}
            </div>

            <label className="ui-font mb-3 block text-sm font-bold">
              Semana da escala
              <input
                className="control mt-1 w-full rounded-md px-3 py-2"
                type="date"
                value={weekStart}
                onChange={(event) => setWeekStart(normalizeWeekInput(event.target.value))}
                data-help="Escolha qualquer data; o app ajusta para a segunda-feira da semana da escala."
              />
            </label>
            <div className="ui-font mb-3 rounded-md border border-graphite/15 bg-paper p-2 text-sm">
              <div className="font-bold">Vigencia: {weekRangeLabel(weekStart)}</div>
              <div className="mt-1 text-xs text-graphite">Segunda a domingo. O padrão é montar a semana seguinte.</div>
              <button className="mt-2 rounded-md border border-graphite/20 px-2 py-1 text-xs font-bold hover:border-signal" onClick={() => setWeekStart(nextPlanningWeekStart())} data-help="Seleciona a próxima segunda-feira.">
                Usar proxima semana
              </button>
            </div>

            <div className="mb-3 rounded-md border border-graphite/15 bg-paper p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="ui-font text-sm font-bold">Indisponibilidades</span>
                <StatusPill tone={snapshot?.readiness.allConfirmed ? "ok" : "warn"}>
                  {snapshot?.readiness.confirmed ?? 0}/{snapshot?.readiness.totalFerreiraBrokers ?? 0}
                </StatusPill>
              </div>
              <p className="ui-font text-xs text-graphite">
                {snapshot?.readiness.allConfirmed ? "Todos os corretores da equipe Ferreira ja preencheram." : "Aguardando alguns corretores preencherem."}
              </p>
            </div>

            {/* Passo 1: importar o XLSX da semana */}
            <div className="mb-3 rounded-md border border-graphite/15 bg-paper p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="ui-font text-sm font-bold">1. Arquivo da semana (XLSX)</span>
                <Archive size={18} className="text-steel" />
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
              <button
                className="ui-font inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 font-bold text-paper disabled:cursor-not-allowed disabled:opacity-50"
                onClick={importSchedule}
                disabled={busy || !file}
                data-help="Envia o XLSX e lê as janelas roxas."
              >
                {busy ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                Importar XLSX
              </button>
              <div className="mt-2 grid gap-2">
                {importsForWeek.length ? importsForWeek.map((item) => (
                  <div key={item.id} className="ui-font rounded-md border border-graphite/15 bg-linen/50 p-2 text-xs">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="font-bold">{item.fileName}</div>
                      <StatusPill tone={item.status === "CONFIRMED" ? "ok" : item.status === "SUPERSEDED" ? "muted" : "warn"}>{item.status}</StatusPill>
                    </div>
                    <div className="text-graphite">
                      {item.summary.ferreiraWindows} roxas · {item.summary.external} externas · {formatDate(item.createdAt)}
                    </div>
                    {item.status !== "CONFIRMED" && item.status !== "SUPERSEDED" ? (
                      <button className="mt-2 rounded-md bg-signal px-2 py-1 font-bold text-paper" onClick={() => confirmImport(item.id)} data-help="Usa este arquivo como escala válida da semana.">
                        Confirmar e substituir
                      </button>
                    ) : null}
                  </div>
                )) : (
                  <p className="ui-font rounded-md border border-graphite/15 bg-linen/50 p-2 text-xs text-graphite">Nenhum arquivo importado para esta semana.</p>
                )}
              </div>
            </div>

            {/* Passo 2: IA gera / publica / cancela */}
            <div className="rounded-md border border-graphite/15 bg-paper p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="ui-font text-sm font-bold">2. Peça à IA</span>
                {iaBusy ? <Loader2 className="animate-spin text-steel" size={16} /> : <StatusPill tone="muted">IA</StatusPill>}
              </div>
              <textarea
                className="control min-h-20 w-full resize-y rounded-md px-3 py-2 text-sm"
                value={iaCommand}
                onChange={(event) => setIaCommand(event.target.value)}
                placeholder="Ex: IA publique a escala"
                data-help="Digite uma ordem para a IA executar."
              />
              <button
                className="ui-font mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-steel px-3 py-2 font-bold text-paper disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => askIa()}
                disabled={iaBusy}
                data-help="Envia a ordem para a IA."
              >
                <RefreshCw size={16} />
                Enviar para IA
              </button>
              {iaAnswer ? (
                <div className="ui-font mt-3 rounded-md border border-steel/30 bg-linen/70 p-3 text-xs" aria-live="polite">
                  <div className="mb-1 font-bold text-ink">Resposta da IA</div>
                  <pre className="whitespace-pre-wrap">{iaAnswer}</pre>
                </div>
              ) : null}
              <div className="mt-2 grid gap-1">
                {[
                  "IA verifique se todos os corretores ja colocaram suas impossibilidades",
                  "IA publique a escala",
                  "IA cancele a publicacao (corretores voltam a editar)",
                  "IA me diga porque essa escala esta justa",
                  "IA tente equilibrar mais e gere novamente"
                ].map((example) => (
                  <button
                    key={example}
                    className="ui-font rounded border border-graphite/15 px-2 py-1 text-left text-xs hover:border-signal disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => askIa(example)}
                    disabled={iaBusy}
                    data-help="Executa este exemplo de ordem para a IA."
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            {notice ? <p className="ui-font mt-3 rounded-md border border-graphite/15 bg-paper p-2 text-sm">{notice}</p> : null}
          </div>

          {/* Novo corretor */}
          <div className="panel mb-5 break-inside-avoid rounded-lg p-4">
            <h2 className="mb-3 text-xl font-bold">Novo corretor</h2>
            <div className="grid gap-2">
              <input className="control rounded-md px-3 py-2" placeholder="Nome" value={newBroker.name} onChange={(event) => setNewBroker({ ...newBroker, name: event.target.value })} data-help="Nome do novo corretor." />
              <input className="control rounded-md px-3 py-2" placeholder="Email" type="email" value={newBroker.email} onChange={(event) => setNewBroker({ ...newBroker, email: event.target.value })} data-help="Email de login do corretor." />
              <input className="control rounded-md px-3 py-2" placeholder="Senha inicial numerica" inputMode="numeric" value={newBroker.initialPassword} onChange={(event) => setNewBroker({ ...newBroker, initialPassword: event.target.value })} data-help="Senha so com numeros, 4 a 10 digitos." />
              <label className="ui-font flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newBroker.canExternalDuty} onChange={(event) => setNewBroker({ ...newBroker, canExternalDuty: event.target.checked })} data-help="Pode trabalhar fora da sede." />
                Pode fazer externo
              </label>
              <label className="ui-font flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newBroker.active} onChange={(event) => setNewBroker({ ...newBroker, active: event.target.checked })} data-help="Entra na distribuicao da IA." />
                Ativo
              </label>
              <button className="ui-font inline-flex items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 font-bold text-paper" onClick={createBroker} data-help="Cria o corretor e o login inicial.">
                <Plus size={16} />
                Adicionar
              </button>
            </div>
          </div>

          {/* Minha senha */}
          <div className="panel mb-5 break-inside-avoid rounded-lg p-4">
            <h2 className="mb-3 text-xl font-bold">Minha senha</h2>
            <div className="grid gap-2">
              <input className="control rounded-md px-3 py-2" type="password" inputMode="numeric" placeholder="Senha atual" value={managerPassword.currentPassword} onChange={(event) => setManagerPassword({ ...managerPassword, currentPassword: event.target.value })} data-help="Sua senha atual de gerente." />
              <input className="control rounded-md px-3 py-2" type="password" inputMode="numeric" placeholder="Nova senha numerica" value={managerPassword.newPassword} onChange={(event) => setManagerPassword({ ...managerPassword, newPassword: event.target.value })} data-help="Nova senha so com numeros, 4 a 10 digitos." />
              <button className="ui-font inline-flex items-center justify-center gap-2 rounded-md border border-graphite/20 bg-paper px-3 py-2 font-bold text-ink" onClick={changeManagerPassword} data-help="Altera a senha do gerente.">
                <KeyRound size={16} />
                Alterar senha
              </button>
            </div>
          </div>

          {/* Prioridade dos plantoes */}
          <PriorityCard items={snapshot?.plantaoPriorities ?? []} notice={priorityNotice} onMove={movePriority} />

          {/* Link de acesso do gerente */}
          {archive?.managerEmail ? (
            <div className="panel mb-5 break-inside-avoid rounded-lg p-4">
              <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Acesso do gerente</p>
              <h2 className="text-lg font-bold">Link pessoal do gerente</h2>
              <p className="ui-font mt-1 text-xs text-graphite">Abre o login com o e-mail do gerente preenchido (a senha continua sendo digitada).</p>
              <div className="ui-font mt-2 flex flex-wrap items-center gap-2">
                <input className="control min-w-0 flex-1 rounded-md px-2 py-1 text-[11px]" readOnly value={accessUrlFor(archive.managerEmail)} onFocus={(event) => event.target.select()} aria-label="Link de acesso do gerente" />
                <button className="inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-xs font-bold text-paper" onClick={copyManagerLink} data-help="Copia o link de acesso do gerente.">
                  <Copy size={13} /> Copiar
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Corretores e logins (largura total — tabela larga) */}
        <BrokersSalesPanel
          brokers={archive?.brokers ?? []}
          salesMonthStart={archive?.salesMonthStart}
          onSave={updateBroker}
          onSaleSave={updateMonthlySale}
          onDelete={deleteBroker}
        />

        {/* Escalas publicadas para download (largura total) */}
        <section className="panel rounded-lg p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Histórico do gerente</p>
              <h2 className="text-xl font-bold">Escalas publicadas para download</h2>
            </div>
            <StatusPill tone={archive?.schedules.length ? "ok" : "warn"}>{archive?.schedules.length ?? 0} publicadas</StatusPill>
          </div>
          {archive?.schedules.length ? (
            <div className="grid gap-2">
              {archive.schedules.map((schedule) => (
                <a
                  key={schedule.id}
                  className="ui-font flex flex-wrap items-center justify-between gap-3 rounded-md border border-graphite/15 bg-paper p-3 text-sm hover:border-signal hover:bg-white"
                  href={`/api/admin/archive/${schedule.id}/download`}
                  data-help="Baixa esta escala publicada em XLSX."
                >
                  <span>
                    <strong>{historyScheduleLabel(schedule.weekStart)}</strong>
                    <span className="block text-xs text-graphite">
                      Publicada em {formatDate(schedule.publishedAt)} · {schedule.importFileName ?? "sem arquivo vinculado"}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-xs font-bold text-paper">
                    <Download size={14} />
                    Baixar XLSX
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="ui-font rounded-md border border-graphite/15 bg-paper p-4 text-sm text-graphite">
              Nenhuma escala publicada ainda. Quando publicar uma escala, ela aparece aqui para download.
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function PriorityCard({ items, notice, onMove }: { items: Array<{ localName: string; position: number }>; notice: string; onMove: (fromIndex: number, toIndex: number) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <div className="panel mb-5 break-inside-avoid rounded-lg p-4">
      <h2 className="mb-2 text-xl font-bold">Prioridade dos plantoes</h2>
      <p className="ui-font mb-3 text-sm text-graphite">Arraste os plantoes. O primeiro e o melhor; os tres primeiros ativam reservas por faixas de vendas. Empates entram juntos.</p>
      {notice ? (
        <div className="ui-font mb-3 rounded-md border border-signal/20 bg-signal/10 p-2 text-xs font-bold text-signal">
          {notice}
        </div>
      ) : null}
      <div className="grid gap-2">
        {items.length ? items.map((item, index) => (
          <div
            key={item.localName}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== index) onMove(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className={`ui-font flex items-center gap-2 rounded-md border border-graphite/15 bg-paper p-2 text-sm font-bold ${dragIndex === index ? "opacity-60" : ""}`}
            data-help="Arraste para mudar a prioridade deste plantao."
          >
            <GripVertical size={16} className="text-steel" />
            <span className="w-7 rounded bg-ink px-2 py-1 text-center text-xs text-paper">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate">{item.localName}</span>
            <button className="rounded border border-graphite/15 p-1 disabled:opacity-30" disabled={index === 0} onClick={() => onMove(index, index - 1)} data-help="Sobe a prioridade." aria-label="Subir">
              <ArrowUp size={14} />
            </button>
            <button className="rounded border border-graphite/15 p-1 disabled:opacity-30" disabled={index === items.length - 1} onClick={() => onMove(index, index + 1)} data-help="Desce a prioridade." aria-label="Descer">
              <ArrowDown size={14} />
            </button>
          </div>
        )) : (
          <div className="ui-font rounded-md border border-graphite/15 bg-paper p-3 text-sm text-graphite">
            Confirme um arquivo semanal para listar os plantoes desta semana.
          </div>
        )}
      </div>
    </div>
  );
}
