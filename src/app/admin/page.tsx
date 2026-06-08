"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Clock3, Copy, Download, FileSpreadsheet, GripVertical, KeyRound, Loader2, Plus, RefreshCw, Trash2, UploadCloud, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BrokersSalesPanel, accessUrlFor, type BrokerSnapshot, type BrokerSavePatch } from "@/components/BrokersSalesPanel";
import { StatusPill } from "@/components/StatusPill";

type Workflow = { isOpen: boolean; daysUntilOpen: number; currentWeekStart: string; currentWeekEnd: string; weekStart: string; weekEnd: string; opensOn: string; closesOn: string };
type Snapshot = {
  weekStart: string;
  salesMonthStart: string;
  brokers: BrokerSnapshot[];
  schedules: Array<{ id: string; status: "DRAFT" | "PUBLISHED"; publishedAt?: string | null }>;
  readiness: { totalFerreiraBrokers: number; confirmed: number; allConfirmed: boolean };
  plantaoPriorities: Array<{ localName: string; position: number }>;
  pendingChangeRequest?: { id: string; summary: string; status: string } | null;
  workflow: Workflow;
};
type ArchiveImport = { id: string; weekStart: string; fileName: string; status: string; createdAt: string; summary: { total: number; ferreiraWindows: number; external: number } };
type ArchiveSchedule = { id: string; weekStart: string; status: string; publishedAt?: string | null; importFileName?: string | null };
type ArchivePayload = { imports: ArchiveImport[]; schedules: ArchiveSchedule[]; brokers: BrokerSnapshot[]; salesMonthStart: string; managerEmail: string };

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(date);
}

function reservationSummary(items: Array<{ localName: string }>) {
  if (!items.length) return "Envie o XLSX no fim de semana para listar os plantoes.";
  return `Reservas: 1o/2o concorrem a 40% de ${items[0]?.localName ?? "-"}; 3o/4o a 40% de ${items[1]?.localName ?? "-"}; 5o/6o a 40% de ${items[2]?.localName ?? "-"}.`;
}

export default function AdminPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [archive, setArchive] = useState<ArchivePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [iaCommand, setIaCommand] = useState("");
  const [iaAnswer, setIaAnswer] = useState("");
  const [iaBusy, setIaBusy] = useState(false);
  const [iaPendingRequestId, setIaPendingRequestId] = useState<string | null>(null);
  const [newBroker, setNewBroker] = useState({ name: "", email: "", initialPassword: "", canExternalDuty: true, active: true });
  const [managerPassword, setManagerPassword] = useState({ currentPassword: "", newPassword: "" });
  const [priorityNotice, setPriorityNotice] = useState("");
  const priorityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setBusy(true);
    try {
      const [snapRes, archRes] = await Promise.all([
        fetch("/api/admin", { cache: "no-store" }),
        fetch("/api/admin/archive", { cache: "no-store" })
      ]);
      if (snapRes.status === 401 || archRes.status === 401) return void (window.location.href = "/login");
      const [nextSnapshot, nextArchive] = await Promise.all([snapRes.json(), archRes.json()]);
      if (!snapRes.ok) throw new Error(nextSnapshot.error ?? "Falha ao carregar o painel.");
      if (!archRes.ok) throw new Error(nextArchive.error ?? "Falha ao carregar o historico.");
      setSnapshot(nextSnapshot);
      setArchive(nextArchive);
      setIaPendingRequestId(nextSnapshot.pendingChangeRequest?.id ?? null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao carregar o painel.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { if (priorityTimer.current) clearTimeout(priorityTimer.current); };
  }, []);

  async function postAdmin(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Falha administrativa.");
    return data;
  }

  async function uploadSchedule(file: File | null) {
    if (!file) return;
    try {
      setBusy(true);
      setNotice(`Validando ${file.name}...`);
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/escala/importar", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao validar o XLSX.");
      setNotice(`Arquivo validado: ${payload.summary.ferreiraWindows} janelas Ferreira e ${payload.summary.external} externas.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao validar o XLSX.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setBusy(false);
    }
  }

  async function deleteImport(importId: string) {
    if (!window.confirm("Excluir o XLSX validado da proxima escala?")) return;
    try {
      setBusy(true);
      const response = await fetch(`/api/escala/importar?importId=${encodeURIComponent(importId)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao excluir arquivo.");
      setNotice("Arquivo excluido. Voce pode enviar outro XLSX.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao excluir arquivo.");
    } finally {
      setBusy(false);
    }
  }

  async function askIa(commandOverride?: string, decision?: "CONFIRM" | "CANCEL") {
    const command = (commandOverride ?? iaCommand).trim();
    if (!command) return setIaAnswer("IA: digite uma ordem antes de enviar.");
    try {
      setIaBusy(true);
      setIaAnswer(`IA: processando "${command}"...`);
      const response = await fetch("/api/ia/comando", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, decision, requestId: iaPendingRequestId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao executar comando.");
      setIaAnswer(data.message ?? "IA: comando executado.");
      setIaPendingRequestId(data.state === "CONFIRMATION_REQUIRED" ? data.requestId : null);
      setIaCommand("");
      await load();
    } catch (error) {
      setIaAnswer(error instanceof Error ? `IA: ${error.message}` : "IA: falha ao executar comando.");
    } finally {
      setIaBusy(false);
    }
  }

  async function savePriorities(items: Array<{ localName: string; position: number }>) {
    try {
      await postAdmin({ action: "updateDutyPriorities", items });
      setPriorityNotice(reservationSummary(items));
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
    void savePriorities(normalized);
  }

  async function createBroker() {
    try {
      await postAdmin({ action: "createBroker", ...newBroker });
      setNewBroker({ name: "", email: "", initialPassword: "", canExternalDuty: true, active: true });
      setNotice("Corretor criado.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao criar corretor."); }
  }

  async function updateBroker(broker: BrokerSnapshot, patch: BrokerSavePatch) {
    try {
      await postAdmin({ action: "updateBroker", id: broker.id, name: patch.name, email: patch.user.email, password: patch.password, canExternalDuty: patch.canExternalDuty, active: patch.active });
      setNotice("Corretor atualizado.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao atualizar corretor."); }
  }

  async function deleteBroker(broker: BrokerSnapshot) {
    if (!window.confirm(`Excluir ${broker.name}?`)) return;
    try { await postAdmin({ action: "deleteBroker", id: broker.id }); setNotice(`${broker.name} excluido.`); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao excluir corretor."); }
  }

  async function updateMonthlySale(broker: BrokerSnapshot, amountReais: string) {
    try { await postAdmin({ action: "updateMonthlySale", brokerId: broker.id, amountReais }); setNotice("Venda atualizada."); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao atualizar venda."); }
  }

  async function changeManagerPassword() {
    try { await postAdmin({ action: "changeOwnPassword", ...managerPassword }); setManagerPassword({ currentPassword: "", newPassword: "" }); setNotice("Senha atualizada."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao alterar senha."); }
  }

  async function copyManagerLink() {
    if (!archive?.managerEmail) return;
    await navigator.clipboard.writeText(accessUrlFor(archive.managerEmail));
    setNotice("Link do gerente copiado.");
  }

  const workflow = snapshot?.workflow;
  const importsForWeek = archive?.imports.filter((item) => item.weekStart === workflow?.weekStart) ?? [];
  const currentImport = importsForWeek.find((item) => item.status === "CONFIRMED") ?? null;
  const published = snapshot?.schedules.some((item) => item.status === "PUBLISHED") ?? false;
  const currentSchedulePublished = archive?.schedules.some((item) => item.weekStart === workflow?.currentWeekStart && item.status === "PUBLISHED") ?? false;

  return (
    <AppShell active="admin">
      <div className="flex flex-col gap-5">
        <section className="hero-panel overflow-hidden rounded-[28px]">
          <div className="grid gap-5 p-5 lg:grid-cols-[1.2fr_0.8fr] lg:p-7">
            <div>
              <p className="eyebrow">Operação semanal</p>
              <h2 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">Preparar e publicar a próxima escala</h2>
              <p className="ui-font mt-3 max-w-2xl text-sm text-graphite">A semana é definida automaticamente. Toda escala começa na segunda-feira e termina no domingo.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-ink p-4 text-paper">
              <div className="ui-font text-[10px] font-bold uppercase tracking-[0.18em] text-sand">Próxima vigência</div>
              <div className="mt-2 text-2xl font-semibold">{formatDate(workflow?.weekStart)} — {formatDate(workflow?.weekEnd)}</div>
              <div className="ui-font mt-2 flex items-center gap-2 text-xs text-paper/70">
                <Clock3 size={14} />
                {workflow?.isOpen ? "Janela aberta até domingo." : `Abre no sábado, ${formatDate(workflow?.opensOn)} · faltam ${workflow?.daysUntilOpen ?? "-"} dia(s).`}
              </div>
            </div>
          </div>
          <div className="grid border-t border-graphite/10 bg-white/45 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Escala em vigor" value={currentSchedulePublished ? "Publicada" : "Não publicada"} ok={currentSchedulePublished} />
            <Metric label="Indisponibilidades" value={`${snapshot?.readiness.confirmed ?? 0}/${snapshot?.readiness.totalFerreiraBrokers ?? 0}`} ok={Boolean(snapshot?.readiness.allConfirmed)} />
            <Metric label="Arquivo da próxima escala" value={currentImport ? "Validado" : "Ainda não enviado"} ok={Boolean(currentImport)} />
            <Metric label="Próxima escala" value={published ? "Publicada" : "Ainda não publicada"} ok={published} />
          </div>
        </section>

        {!workflow?.isOpen ? (
          <section className="panel rounded-2xl p-5">
            <p className="eyebrow">Janela fechada</p>
            <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <h3 className="text-2xl font-semibold">O envio do XLSX e a publicação abrem no sábado</h3>
                <p className="ui-font mt-2 text-sm text-graphite">Enquanto isso, acompanhe as indisponibilidades e use a IA para ajustes confirmados na escala atualmente em vigor.</p>
              </div>
              <StatusPill tone="muted">{workflow?.daysUntilOpen ?? "-"} dia(s) para abrir</StatusPill>
            </div>
          </section>
        ) : (
          <section className="grid gap-4 xl:grid-cols-3">
            <div className="panel rounded-2xl p-4">
              <StepTitle number="01" title="Arquivo XLSX" icon={FileSpreadsheet} />
              <p className="ui-font mt-2 text-xs text-graphite">Ao escolher o arquivo, o app valida e prepara a semana automaticamente.</p>
              {currentImport ? (
                <div className="mt-4 rounded-xl border border-moss/25 bg-moss/10 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div><strong className="ui-font text-sm">{currentImport.fileName}</strong><p className="ui-font mt-1 text-xs text-graphite">{currentImport.summary.ferreiraWindows} janelas Ferreira · {currentImport.summary.external} externas</p></div>
                    <CheckCircle2 className="text-moss" size={20} />
                  </div>
                  {!published ? <button className="ui-font mt-3 inline-flex items-center gap-2 rounded-full border border-signal/25 px-3 py-1.5 text-xs font-bold text-signal" onClick={() => deleteImport(currentImport.id)}><Trash2 size={13} /> Excluir e trocar</button> : null}
                </div>
              ) : (
                <label className="ui-font mt-4 grid cursor-pointer place-items-center rounded-xl border border-dashed border-sand bg-sand/10 p-6 text-center text-sm font-bold hover:bg-sand/20">
                  {busy ? <Loader2 className="mb-2 animate-spin" /> : <UploadCloud className="mb-2" />}
                  Localizar XLSX no computador
                  <input ref={fileInputRef} className="sr-only" type="file" accept=".xlsx" disabled={busy} onChange={(event) => void uploadSchedule(event.target.files?.[0] ?? null)} />
                </label>
              )}
            </div>
            <PriorityCard items={snapshot?.plantaoPriorities ?? []} notice={priorityNotice} onMove={movePriority} />
            <AiCard command={iaCommand} setCommand={setIaCommand} answer={iaAnswer} busy={iaBusy} pending={Boolean(iaPendingRequestId)} ask={askIa} />
          </section>
        )}

        {!workflow?.isOpen ? <AiCard command={iaCommand} setCommand={setIaCommand} answer={iaAnswer} busy={iaBusy} pending={Boolean(iaPendingRequestId)} ask={askIa} /> : null}
        {notice ? <div className="ui-font rounded-xl border border-sand/40 bg-sand/15 p-3 text-sm">{notice}</div> : null}

        <div className="grid gap-3">
          <details className="panel rounded-2xl p-4">
            <summary className="ui-font cursor-pointer font-bold">Corretores, logins e vendas</summary>
            <div className="mt-4"><BrokersSalesPanel brokers={archive?.brokers ?? []} salesMonthStart={archive?.salesMonthStart} onSave={updateBroker} onSaleSave={updateMonthlySale} onDelete={deleteBroker} /></div>
          </details>
          <details className="panel rounded-2xl p-4">
            <summary className="ui-font cursor-pointer font-bold">Novo corretor e segurança</summary>
            <div className="mt-4 grid gap-5 lg:grid-cols-3">
              <div className="grid gap-2"><h3 className="font-semibold">Novo corretor</h3><input className="control rounded-xl px-3 py-2" placeholder="Nome" value={newBroker.name} onChange={(e) => setNewBroker({ ...newBroker, name: e.target.value })} /><input className="control rounded-xl px-3 py-2" placeholder="Email" value={newBroker.email} onChange={(e) => setNewBroker({ ...newBroker, email: e.target.value })} /><input className="control rounded-xl px-3 py-2" placeholder="Senha inicial" value={newBroker.initialPassword} onChange={(e) => setNewBroker({ ...newBroker, initialPassword: e.target.value })} /><button className="action-primary" onClick={createBroker}><Plus size={15} /> Adicionar</button></div>
              <div className="grid gap-2"><h3 className="font-semibold">Minha senha</h3><input className="control rounded-xl px-3 py-2" type="password" placeholder="Senha atual" value={managerPassword.currentPassword} onChange={(e) => setManagerPassword({ ...managerPassword, currentPassword: e.target.value })} /><input className="control rounded-xl px-3 py-2" type="password" placeholder="Nova senha" value={managerPassword.newPassword} onChange={(e) => setManagerPassword({ ...managerPassword, newPassword: e.target.value })} /><button className="action-secondary" onClick={changeManagerPassword}><KeyRound size={15} /> Alterar senha</button></div>
              <div><h3 className="font-semibold">Acesso do gerente</h3><p className="ui-font mt-2 break-all text-xs text-graphite">{archive?.managerEmail ? accessUrlFor(archive.managerEmail) : "-"}</p><button className="action-secondary mt-3" onClick={copyManagerLink}><Copy size={15} /> Copiar link</button></div>
            </div>
          </details>
          <details className="panel rounded-2xl p-4">
            <summary className="ui-font cursor-pointer font-bold">Histórico de escalas publicadas</summary>
            <div className="mt-4 grid gap-2">{archive?.schedules.map((schedule) => <a key={schedule.id} className="ui-font flex items-center justify-between rounded-xl border border-graphite/10 bg-white/60 p-3 text-sm hover:border-sand" href={`/api/admin/archive/${schedule.id}/download`}><span><strong>Semana de {formatDate(schedule.weekStart)}</strong><span className="block text-xs text-graphite">{schedule.importFileName ?? "sem arquivo"} · publicada em {formatDate(schedule.publishedAt)}</span></span><Download size={16} /></a>)}</div>
          </details>
        </div>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="flex items-center justify-between border-b border-graphite/10 px-5 py-3 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><span className="ui-font text-xs font-bold uppercase tracking-[0.12em] text-graphite">{label}</span><StatusPill tone={ok ? "ok" : "warn"}>{value}</StatusPill></div>;
}

function StepTitle({ number, title, icon: Icon }: { number: string; title: string; icon: typeof FileSpreadsheet }) {
  return <div className="flex items-center justify-between"><div><p className="eyebrow">{number}</p><h3 className="text-xl font-semibold">{title}</h3></div><Icon className="text-signal" size={22} /></div>;
}

function AiCard({ command, setCommand, answer, busy, pending, ask }: { command: string; setCommand: (value: string) => void; answer: string; busy: boolean; pending: boolean; ask: (command?: string, decision?: "CONFIRM" | "CANCEL") => Promise<void> }) {
  return <div className="panel rounded-2xl p-4"><StepTitle number="03" title="Assistente IA" icon={RefreshCw} /><textarea className="control mt-4 min-h-24 w-full resize-y rounded-xl px-3 py-2 text-sm" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Ex: publique a próxima escala ou troque Ana por Bruno na escala atual" /><button className="action-primary mt-2 w-full" onClick={() => void ask()} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Enviar para IA</button>{answer ? <pre className="ui-font mt-3 whitespace-pre-wrap rounded-xl bg-linen/60 p-3 text-xs">{answer}</pre> : null}{pending ? <div className="mt-2 grid grid-cols-2 gap-2"><button className="action-primary" onClick={() => void ask("Confirme", "CONFIRM")}>Confirmar</button><button className="action-secondary" onClick={() => void ask("Cancele", "CANCEL")}>Cancelar</button></div> : null}</div>;
}

function PriorityCard({ items, notice, onMove }: { items: Array<{ localName: string; position: number }>; notice: string; onMove: (fromIndex: number, toIndex: number) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  return <div className="panel rounded-2xl p-4"><StepTitle number="02" title="Melhores plantões" icon={Users} /><p className="ui-font mt-2 text-xs text-graphite">Arraste para orientar a distribuição. A ordem fica como padrão para as próximas semanas.</p>{notice ? <p className="ui-font mt-2 rounded-xl bg-sand/15 p-2 text-xs">{notice}</p> : null}<div className="mt-3 grid max-h-[360px] gap-2 overflow-auto pr-1">{items.length ? items.map((item, index) => <div key={item.localName} draggable onDragStart={() => setDragIndex(index)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragIndex !== null && dragIndex !== index) onMove(dragIndex, index); setDragIndex(null); }} className="ui-font flex items-center gap-2 rounded-xl border border-graphite/10 bg-white/60 p-2 text-xs font-bold"><GripVertical size={14} className="text-sand" /><span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-paper">{index + 1}</span><span className="min-w-0 flex-1 truncate">{item.localName}</span><button disabled={index === 0} onClick={() => onMove(index, index - 1)}><ArrowUp size={13} /></button><button disabled={index === items.length - 1} onClick={() => onMove(index, index + 1)}><ArrowDown size={13} /></button></div>) : <div className="ui-font rounded-xl border border-dashed border-sand p-4 text-center text-xs text-graphite">A lista aparece automaticamente após validar o XLSX.</div>}</div></div>;
}
