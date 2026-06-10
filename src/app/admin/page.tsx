"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Clock3, Copy, Download, FileSpreadsheet, GripVertical, KeyRound, Loader2, Plus, RefreshCw, Trash2, UploadCloud, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BrokersPanel, accessUrlFor, type BrokerSnapshot, type BrokerSavePatch } from "@/components/BrokersPanel";
import { StatusPill } from "@/components/StatusPill";
import { authenticatedDownload, authenticatedFetch } from "@/lib/client-auth";
import type { EffortLevel } from "@/lib/effort-level";

type Workflow = { isOpen: boolean; daysUntilOpen: number; currentWeekStart: string; currentWeekEnd: string; weekStart: string; weekEnd: string; opensOn: string; closesOn: string };
type Snapshot = {
  weekStart: string;
  brokers: BrokerSnapshot[];
  schedules: Array<{ id: string; status: "DRAFT" | "PUBLISHED"; publishedAt?: string | null }>;
  readiness: { totalFerreiraBrokers: number; confirmed: number; allConfirmed: boolean };
  plantaoPriorities: Array<{ localName: string; position: number }>;
  pendingChangeRequest?: { id: string; summary: string; status: string; analysisJson?: string | null } | null;
  workflow: Workflow;
};
type ArchiveImport = { id: string; weekStart: string; fileName: string; status: string; createdAt: string; summary: { total: number; ferreiraWindows: number; external: number } };
type ArchiveSchedule = { id: string; weekStart: string; status: string; publishedAt?: string | null; importFileName?: string | null };
type ArchivePayload = { imports: ArchiveImport[]; schedules: ArchiveSchedule[]; brokers: BrokerSnapshot[]; managerEmail: string };
type ImportChangeSummary = { added: string[]; removed: string[]; timeChanged: Array<{ localName: string; from: number[]; to: number[] }> };
type PendingReconciliation = { rawName: string; suggestion?: string };

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(date);
}

function reservationSummary(items: Array<{ localName: string }>) {
  if (!items.length) return "Envie o XLSX no fim de semana para listar os plantoes.";
  return `Prioridades atualizadas. As metas internas usarão os dois melhores e os dois piores plantões desta ordem.`;
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
  const [iaPendingHasWarnings, setIaPendingHasWarnings] = useState(false);
  const [newBroker, setNewBroker] = useState({ name: "", email: "", initialPassword: "", canExternalDuty: true, active: true });
  const [managerPassword, setManagerPassword] = useState({ currentPassword: "", newPassword: "" });
  const [priorityNotice, setPriorityNotice] = useState("");
  const [pendingReconciliation, setPendingReconciliation] = useState<PendingReconciliation[] | null>(null);
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState<ImportChangeSummary | null>(null);
  const [reconciliationDecisions, setReconciliationDecisions] = useState<Record<string, string>>({});
  const priorityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setBusy(true);
    try {
      const [snapRes, archRes] = await Promise.all([
        authenticatedFetch("/api/admin", { cache: "no-store" }),
        authenticatedFetch("/api/admin/archive", { cache: "no-store" })
      ]);
      if (snapRes.status === 401 || archRes.status === 401) return void (window.location.href = "/login");
      const [nextSnapshot, nextArchive] = await Promise.all([snapRes.json(), archRes.json()]);
      if (!snapRes.ok) throw new Error(nextSnapshot.error ?? "Falha ao carregar o painel.");
      if (!archRes.ok) throw new Error(nextArchive.error ?? "Falha ao carregar o historico.");
      setSnapshot(nextSnapshot);
      setArchive(nextArchive);
      setIaPendingRequestId(nextSnapshot.pendingChangeRequest?.id ?? null);
      try {
        const analysis = JSON.parse(nextSnapshot.pendingChangeRequest?.analysisJson ?? "{}");
        const warnings = Array.isArray(analysis.warnings) ? analysis.warnings.map(String) : [];
        setIaPendingHasWarnings(warnings.length > 0);
        if (nextSnapshot.pendingChangeRequest) {
          setIaAnswer(`IA: existe uma proposta aguardando sua decisão.\n${nextSnapshot.pendingChangeRequest.summary}${warnings.length ? `\n\nRessalvas privadas:\n- ${warnings.join("\n- ")}` : "\n\nNenhum aumento mensurável de desequilíbrio foi detectado."}`);
        }
      } catch {
        setIaPendingHasWarnings(false);
      }
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
    const response = await authenticatedFetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
      const response = await authenticatedFetch("/api/escala/importar", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao validar o XLSX.");
      
      // Mostra resumo de mudanças se houver.
      if (payload.changeSummary) {
        setChangeSummary(payload.changeSummary);
      }
      
      // Se há nomes ambíguos, mostra painel de reconciliação.
      if (payload.pendingReconciliation && payload.pendingReconciliation.length > 0) {
        setPendingReconciliation(payload.pendingReconciliation);
        setPendingImportId(payload.import.id);
        setReconciliationDecisions({});
        setNotice(`${payload.pendingReconciliation.length} nome(s) ambíguo(s) detectado(s). Confirme ou marque como novo.`);
      } else {
        // Sem ambiguidade, finaliza normalmente.
        setNotice(`Arquivo validado: ${payload.summary.ferreiraWindows} janelas Ferreira e ${payload.summary.external} externas.`);
        setPendingReconciliation(null);
        setPendingImportId(null);
        if (!payload.changeSummary) setChangeSummary(null);
      }
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao validar o XLSX.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setBusy(false);
    }
  }

  async function submitReconciliation(importId: string) {
    try {
      setBusy(true);
      setNotice("Finalizando reconciliação...");
      const response = await authenticatedFetch("/api/escala/importar/reconciliar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId, decisions: reconciliationDecisions })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao reconciliar.");
      setNotice(`Reconciliação concluída: ${payload.summary.ferreiraWindows} janelas Ferreira e ${payload.summary.external} externas.`);
      setPendingReconciliation(null);
      setPendingImportId(null);
      setReconciliationDecisions({});
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao reconciliar.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteImport(importId: string) {
    if (!window.confirm("Excluir o XLSX validado da proxima escala?")) return;
    try {
      setBusy(true);
      const response = await authenticatedFetch(`/api/escala/importar?importId=${encodeURIComponent(importId)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao excluir arquivo.");
      setNotice("Arquivo excluido. Voce pode enviar outro XLSX.");
      setPendingReconciliation(null);
      setPendingImportId(null);
      setReconciliationDecisions({});
      setChangeSummary(null);
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
      const response = await authenticatedFetch("/api/ia/comando", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, decision, requestId: iaPendingRequestId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao executar comando.");
      setIaAnswer(data.message ?? "IA: comando executado.");
      setIaPendingRequestId(data.state === "CONFIRMATION_REQUIRED" ? data.requestId : null);
      setIaPendingHasWarnings(data.state === "CONFIRMATION_REQUIRED" && Boolean(data.hasWarnings));
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

  async function updateEffortLevel(broker: BrokerSnapshot, effortLevel: EffortLevel) {
    try { await postAdmin({ action: "updateEffortLevel", brokerId: broker.id, effortLevel }); setNotice(`Nível de esforço de ${broker.name} atualizado.`); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao atualizar nível de esforço."); }
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

  async function downloadSchedule(schedule: ArchiveSchedule) {
    try {
      await authenticatedDownload(`/api/admin/archive/${schedule.id}/download`, `escala-${schedule.weekStart}.xlsx`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao baixar escala.");
    }
  }

  const workflow = snapshot?.workflow;
  const importsForWeek = archive?.imports.filter((item) => item.weekStart === workflow?.weekStart) ?? [];
  const currentImport = importsForWeek.find((item) => item.status === "PENDING_RECONCILIATION") ?? importsForWeek.find((item) => item.status === "CONFIRMED") ?? null;
  const currentImportStatusLabel = currentImport?.status === "PENDING_RECONCILIATION" ? "Aguardando reconciliação" : "Validado";
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
            <Metric label="Arquivo da próxima escala" value={currentImport ? currentImportStatusLabel : "Ainda não enviado"} ok={Boolean(currentImport)} />
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
                    <div>
                      <strong className="ui-font text-sm">{currentImport.fileName}</strong>
                      <p className="ui-font mt-1 text-xs text-graphite">{currentImport.summary.ferreiraWindows} janelas Ferreira · {currentImport.summary.external} externas</p>
                    </div>
                    <CheckCircle2 className="text-moss" size={20} />
                  </div>
                  {currentImport.status === "PENDING_RECONCILIATION" ? (
                    <p className="ui-font mt-3 rounded-lg border border-signal/20 bg-signal/10 px-3 py-2 text-xs text-signal">Aguardando confirmação de nomes ambíguos antes de finalizar.</p>
                  ) : null}
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
            <AiCard command={iaCommand} setCommand={setIaCommand} answer={iaAnswer} busy={iaBusy} pending={Boolean(iaPendingRequestId)} hasWarnings={iaPendingHasWarnings} ask={askIa} />
          </section>
        )}

        {pendingReconciliation && pendingReconciliation.length > 0 ? (
          <section className="panel rounded-2xl p-4">
            <h2 className="text-lg font-semibold">🔄 Reconciliação de nomes de plantão</h2>
            <p className="ui-font mt-2 text-sm text-graphite">Alguns nomes no XLSX parecem semelhantes a plantões conhecidos. Decida para cada um: é novo ou é o mesmo?</p>
            <div className="mt-4 grid gap-3">
              {pendingReconciliation.map((item) => (
                <div key={item.rawName} className="rounded-lg border border-sand/40 bg-sand/10 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-mono text-sm font-bold">{item.rawName}</p>
                      {item.suggestion ? (
                        <p className="ui-font mt-1 text-xs text-graphite">Parece ser: <span className="font-semibold">{item.suggestion}</span></p>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      {item.suggestion ? (
                        <button
                          className="ui-font rounded-full border border-moss/40 bg-moss/10 px-3 py-1.5 text-xs font-bold text-moss hover:bg-moss/20"
                          onClick={() => setReconciliationDecisions({ ...reconciliationDecisions, [item.rawName]: item.suggestion! })}
                        >
                          {reconciliationDecisions[item.rawName] === item.suggestion ? "✓ Sim" : "Confirmar"}
                        </button>
                      ) : null}
                      <button
                        className="ui-font rounded-full border border-signal/40 bg-signal/10 px-3 py-1.5 text-xs font-bold text-signal hover:bg-signal/20"
                        onClick={() => setReconciliationDecisions({ ...reconciliationDecisions, [item.rawName]: "NEW" })}
                      >
                        {reconciliationDecisions[item.rawName] === "NEW" ? "✓ Novo" : "É novo"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {Object.keys(reconciliationDecisions).length === pendingReconciliation.length ? (
              <button
                className="action-primary mt-4 w-full"
                onClick={() => submitReconciliation(pendingImportId!)}
                disabled={busy}
              >
                {busy ? <Loader2 className="inline animate-spin" size={15} /> : "✓"} Confirmar decisões e finalizar
              </button>
            ) : (
              <p className="ui-font mt-4 text-sm text-graphite">Decida para todos os {pendingReconciliation.length} nome(s) antes de confirmar.</p>
            )}
          </section>
        ) : null}

        {changeSummary ? (
          <section className="panel rounded-2xl p-4">
            <h2 className="text-lg font-semibold">📊 Resumo de mudanças na escala</h2>
            <div className="mt-4 grid gap-3">
              {changeSummary.added.length > 0 ? (
                <div className="rounded-lg border border-sand/40 bg-sand/10 p-3">
                  <p className="ui-font font-bold text-sand">🆕 <strong>{changeSummary.added.length}</strong> plantão(ões) novo(s):</p>
                  <ul className="ui-font mt-2 ml-4 list-disc text-sm text-graphite">
                    {changeSummary.added.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                  <p className="ui-font mt-2 text-xs text-sand">⚠️ <strong>Posicione na régua de prioridades</strong> antes de gerar a escala.</p>
                </div>
              ) : null}
              {changeSummary.removed.length > 0 ? (
                <div className="rounded-lg border border-graphite/25 bg-graphite/10 p-3">
                  <p className="ui-font font-bold text-graphite">❌ <strong>{changeSummary.removed.length}</strong> plantão(ões) removido(s):</p>
                  <ul className="ui-font mt-2 ml-4 list-disc text-sm text-graphite">
                    {changeSummary.removed.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {changeSummary.timeChanged.length > 0 ? (
                <div className="rounded-lg border border-signal/40 bg-signal/10 p-3">
                  <p className="ui-font font-bold text-signal">🕐 <strong>{changeSummary.timeChanged.length}</strong> plantão(ões) com horário alterado:</p>
                  <ul className="ui-font mt-2 ml-4 space-y-1 text-sm text-graphite">
                    {changeSummary.timeChanged.map((item) => (
                      <li key={item.localName}>
                        <strong>{item.localName}</strong>: {item.from.join(", ")}h → {item.to.join(", ")}h
                      </li>
                    ))}
                  </ul>
                  <p className="ui-font mt-2 text-xs text-signal">⚠️ <strong>Revise os NÃO PODE dos corretores</strong> nesse novo horário.</p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {!workflow?.isOpen ? (
          <section className="grid gap-4 xl:grid-cols-2">
            <PriorityCard items={snapshot?.plantaoPriorities ?? []} notice={priorityNotice} onMove={movePriority} />
            <AiCard command={iaCommand} setCommand={setIaCommand} answer={iaAnswer} busy={iaBusy} pending={Boolean(iaPendingRequestId)} hasWarnings={iaPendingHasWarnings} ask={askIa} />
          </section>
        ) : null}
        {notice ? <div className="ui-font rounded-xl border border-sand/40 bg-sand/15 p-3 text-sm">{notice}</div> : null}

        <div className="grid gap-3">
          <details className="panel rounded-2xl p-4">
            <summary className="ui-font cursor-pointer font-bold">Corretores, logins e nível de esforço</summary>
            <div className="mt-4"><BrokersPanel brokers={archive?.brokers ?? []} onSave={updateBroker} onEffortSave={updateEffortLevel} onDelete={deleteBroker} /></div>
          </details>
          <details className="panel rounded-2xl p-4">
            <summary className="ui-font cursor-pointer font-bold">Cadastrar novo corretor</summary>
            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
              <div className="grid gap-3 rounded-2xl border border-graphite/10 bg-white/45 p-4">
                <div>
                  <p className="eyebrow">Novo acesso</p>
                  <h3 className="text-xl font-semibold">Criar corretor e login</h3>
                  <p className="ui-font mt-1 text-xs text-graphite">Use este formulário somente para adicionar uma nova pessoa à equipe Ferreira. A senha criada aqui pertence ao novo corretor.</p>
                </div>
                <label className="ui-font grid gap-1 text-xs font-bold">
                  Nome do novo corretor
                  <input className="control rounded-xl px-3 py-2 font-normal" placeholder="Ex.: Maria Silva" value={newBroker.name} onChange={(e) => setNewBroker({ ...newBroker, name: e.target.value })} />
                </label>
                <label className="ui-font grid gap-1 text-xs font-bold">
                  Email usado pelo corretor para entrar
                  <input className="control rounded-xl px-3 py-2 font-normal" type="email" placeholder="Ex.: maria@exemplo.com" value={newBroker.email} onChange={(e) => setNewBroker({ ...newBroker, email: e.target.value })} />
                </label>
                <label className="ui-font grid gap-1 text-xs font-bold">
                  Senha inicial do novo corretor
                  <input className="control rounded-xl px-3 py-2 font-normal" inputMode="numeric" placeholder="De 4 a 10 números" value={newBroker.initialPassword} onChange={(e) => setNewBroker({ ...newBroker, initialPassword: e.target.value })} />
                </label>
                <button className="action-primary" onClick={createBroker}><Plus size={15} /> Criar corretor e login</button>
              </div>
              <aside className="ui-font rounded-2xl border border-sand/35 bg-sand/10 p-4 text-xs text-graphite">
                <strong className="block text-sm text-ink">O que acontece ao criar?</strong>
                <p className="mt-2">O corretor passa a aparecer na lista administrativa, recebe acesso próprio e precisa informar suas indisponibilidades.</p>
                <p className="mt-2">Depois, defina também o nível de esforço desse corretor antes de gerar uma nova escala.</p>
              </aside>
            </div>
          </details>
          <details className="panel rounded-2xl p-4">
            <summary className="ui-font cursor-pointer font-bold">Minha conta de gerente</summary>
            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              <div className="grid gap-3 rounded-2xl border border-graphite/10 bg-white/45 p-4">
                <div>
                  <p className="eyebrow">Segurança do gerente</p>
                  <h3 className="text-xl font-semibold">Alterar minha senha</h3>
                  <p className="ui-font mt-1 text-xs text-graphite">Os campos abaixo alteram somente a senha da conta de gerente que está conectada agora.</p>
                </div>
                <label className="ui-font grid gap-1 text-xs font-bold">
                  Minha senha atual
                  <input className="control rounded-xl px-3 py-2 font-normal" type="password" placeholder="Digite sua senha atual" value={managerPassword.currentPassword} onChange={(e) => setManagerPassword({ ...managerPassword, currentPassword: e.target.value })} />
                </label>
                <label className="ui-font grid gap-1 text-xs font-bold">
                  Minha nova senha
                  <input className="control rounded-xl px-3 py-2 font-normal" type="password" placeholder="Digite a nova senha" value={managerPassword.newPassword} onChange={(e) => setManagerPassword({ ...managerPassword, newPassword: e.target.value })} />
                </label>
                <button className="action-secondary" onClick={changeManagerPassword}><KeyRound size={15} /> Alterar senha da minha conta</button>
              </div>
              <div className="grid content-start gap-3 rounded-2xl border border-graphite/10 bg-linen/55 p-4">
                <div>
                  <p className="eyebrow">Login do gerente</p>
                  <h3 className="text-xl font-semibold">Meu link de acesso</h3>
                  <p className="ui-font mt-1 text-xs text-graphite">Este link abre a tela de login com o email do gerente já preenchido. Ele não cria nem altera corretores.</p>
                </div>
                <div className="rounded-xl border border-graphite/10 bg-white/55 p-3">
                  <span className="ui-font block text-[10px] font-bold uppercase tracking-[0.12em] text-graphite">Email do gerente</span>
                  <strong className="ui-font mt-1 block break-all text-sm">{archive?.managerEmail ?? "-"}</strong>
                </div>
                <button className="action-secondary" onClick={copyManagerLink}><Copy size={15} /> Copiar meu link de login</button>
              </div>
            </div>
          </details>
          <details className="panel rounded-2xl p-4">
            <summary className="ui-font cursor-pointer font-bold">Histórico de escalas publicadas</summary>
            <div className="mt-4 grid gap-2">{archive?.schedules.map((schedule) => <button type="button" key={schedule.id} className="ui-font flex items-center justify-between rounded-xl border border-graphite/10 bg-white/60 p-3 text-left text-sm hover:border-sand" onClick={() => void downloadSchedule(schedule)}><span><strong>Semana de {formatDate(schedule.weekStart)}</strong><span className="block text-xs text-graphite">{schedule.importFileName ?? "sem arquivo"} · publicada em {formatDate(schedule.publishedAt)}</span></span><Download size={16} /></button>)}</div>
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

function AiCard({ command, setCommand, answer, busy, pending, hasWarnings, ask }: { command: string; setCommand: (value: string) => void; answer: string; busy: boolean; pending: boolean; hasWarnings: boolean; ask: (command?: string, decision?: "CONFIRM" | "CANCEL") => Promise<void> }) {
  return <div className="panel rounded-2xl p-4"><StepTitle number="03" title="Assistente IA" icon={RefreshCw} /><p className="ui-font mt-2 text-xs text-graphite">Pergunte sobre o app ou dê uma ordem ao motor da escala. Toda geração, redistribuição ou alteração será simulada antes da confirmação.</p><textarea className="control mt-3 min-h-24 w-full resize-y rounded-xl px-3 py-2 text-sm" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Ex: como funciona o NÃO PODE? ou prepare a próxima escala" /><button className="action-primary mt-2 w-full" onClick={() => void ask()} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Enviar para IA</button>{answer ? <pre className="ui-font mt-3 whitespace-pre-wrap rounded-xl bg-linen/60 p-3 text-xs">{answer}</pre> : null}{pending ? <div className="mt-2 grid grid-cols-2 gap-2"><button className="action-primary" onClick={() => void ask("Confirme", "CONFIRM")}>{hasWarnings ? "Confirmar apesar das ressalvas" : "Confirmar"}</button><button className="action-secondary" onClick={() => void ask("Cancele", "CANCEL")}>Cancelar</button></div> : null}</div>;
}

function PriorityCard({ items, notice, onMove }: { items: Array<{ localName: string; position: number }>; notice: string; onMove: (fromIndex: number, toIndex: number) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  return <div className="panel rounded-2xl p-4 transition">
    <div className="flex items-start justify-between gap-3">
      <StepTitle number="02" title="Melhores plantões" icon={Users} />
    </div>
    <p className="ui-font mt-2 text-xs text-graphite">Arraste a qualquer momento. A nova ordem orienta próximas gerações e pedidos de redistribuição feitos à IA.</p>
    {notice ? <p className="ui-font mt-2 rounded-xl bg-sand/15 p-2 text-xs">{notice}</p> : null}
    <div className="mt-3 grid max-h-[360px] gap-2 overflow-auto pr-1">
      {items.length ? items.map((item, index) => <div key={item.localName} draggable onDragStart={() => setDragIndex(index)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragIndex !== null && dragIndex !== index) onMove(dragIndex, index); setDragIndex(null); }} className="ui-font flex cursor-grab items-center gap-2 rounded-xl border border-graphite/10 bg-white/60 p-2 text-xs font-bold active:cursor-grabbing"><GripVertical size={14} className="text-sand" /><span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-paper">{index + 1}</span><span className="min-w-0 flex-1 truncate">{item.localName}</span><button aria-label={`Subir ${item.localName}`} disabled={index === 0} onClick={() => onMove(index, index - 1)} className="disabled:cursor-not-allowed disabled:opacity-25"><ArrowUp size={13} /></button><button aria-label={`Descer ${item.localName}`} disabled={index === items.length - 1} onClick={() => onMove(index, index + 1)} className="disabled:cursor-not-allowed disabled:opacity-25"><ArrowDown size={13} /></button></div>) : <div className="ui-font rounded-xl border border-dashed border-sand p-4 text-center text-xs text-graphite">A lista aparece automaticamente após validar o XLSX.</div>}
    </div>
  </div>;
}
