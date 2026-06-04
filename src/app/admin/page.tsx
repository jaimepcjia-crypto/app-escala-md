"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Check, GripVertical, KeyRound, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RealScheduleGrid } from "@/components/RealScheduleGrid";
import { normalizeWeekStart } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";

type BrokerSnapshot = {
  id: string;
  name: string;
  user?: { email: string } | null;
  salesAmountReais: string;
  salesRank: number | null;
  autoHistoryTotal: number;
  canExternalDuty: boolean;
  active: boolean;
  team: { name: string; isFerreira: boolean };
};

type Snapshot = {
  weekStart: string;
  salesMonthStart: string;
  teams: { id: string; name: string; isFerreira: boolean }[];
  brokers: BrokerSnapshot[];
  schedules: Array<{ id: string; status: "DRAFT" | "PUBLISHED"; assignments: any[]; publishedAt?: string | null; aiReview?: any | null }>;
  imports: Array<{ id: string; fileName: string; status: string; cells: Array<{ id: string; ownerType: string }> }>;
  readiness: { totalFerreiraBrokers: number; confirmed: number; allConfirmed: boolean };
  plantaoPriorities: Array<{ localName: string; position: number }>;
  generationGate: { allowed: boolean; reason: string | null; allowedWeekStart: string };
};

function formatDateBr(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(date);
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

const initialWeek = nextPlanningWeekStart();

function monthLabel(value?: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function reservationSummary(items: Array<{ localName: string }>) {
  if (!items.length) return "Importe e confirme o arquivo da semana para ordenar os plantoes.";
  const first = items[0]?.localName ?? "-";
  const second = items[1]?.localName ?? "-";
  const third = items[2]?.localName ?? "-";
  return `Reservas: 1o/2o em vendas recebem 40% de ${first}; 3o/4o recebem 40% de ${second}; 5o/6o recebem 40% de ${third}. Do quarto plantao em diante nao ha reserva.`;
}

export default function AdminPage() {
  const [weekStart, setWeekStart] = useState(initialWeek);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [iaCommand, setIaCommand] = useState("");
  const [iaAnswer, setIaAnswer] = useState("");
  const [iaBusy, setIaBusy] = useState(false);
  const [newBroker, setNewBroker] = useState({ name: "", email: "", initialPassword: "", canExternalDuty: true, active: true });
  const [managerPassword, setManagerPassword] = useState({ currentPassword: "", newPassword: "" });
  const [priorityNotice, setPriorityNotice] = useState("");
  const priorityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useMemo(() => snapshot?.schedules.find((item) => item.status === "PUBLISHED") ?? snapshot?.schedules[0], [snapshot]);

  async function load() {
    setBusy(true);
    const response = await fetch(`/api/admin?weekStart=${weekStart}`, { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    setSnapshot(await response.json());
    setBusy(false);
  }

  useEffect(() => {
    load();
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

  async function updateBroker(broker: BrokerSnapshot, patch: Partial<BrokerSnapshot>) {
    try {
      await postAdmin({
        action: "updateBroker",
        id: broker.id,
        name: patch.name ?? broker.name,
        email: patch.user?.email ?? broker.user?.email,
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
      await postAdmin({
        action: "updateMonthlySale",
        brokerId: broker.id,
        weekStart,
        amountReais
      });
      setNotice("Venda mensal atualizada e ranking recalculado.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao atualizar venda mensal.");
    }
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

  async function resetBrokerPassword(broker: BrokerSnapshot) {
    const newPassword = window.prompt(`Nova senha numerica para ${broker.name}`);
    if (newPassword === null) return;
    try {
      await postAdmin({ action: "resetBrokerPassword", brokerId: broker.id, newPassword });
      setNotice(`Senha de ${broker.name} redefinida.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao redefinir senha.");
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

  async function adjustAssignment(assignmentId: string, brokerId: string) {
    try {
      const response = await fetch("/api/escala/ajustar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, brokerId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao ajustar.");
      setNotice(data.assignment.balanceAlert || (data.assignment.isViolation ? "Ajuste salvo com alerta de regra." : "Ajuste salvo."));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao ajustar.");
    }
  }

  return (
    <AppShell active="admin">
      <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-5">
          <div className="panel rounded-lg p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Controle</p>
                <h2 className="text-xl font-bold">Painel do gerente</h2>
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
              <div className="mt-1 text-xs text-graphite">A escala sempre começa na segunda-feira e termina no domingo. O padrão é montar a semana seguinte.</div>
              <button className="mt-2 rounded-md border border-graphite/20 px-2 py-1 text-xs font-bold hover:border-signal" onClick={() => setWeekStart(nextPlanningWeekStart())} data-help="Seleciona automaticamente a próxima segunda-feira para montar a escala seguinte.">
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
                {snapshot?.readiness.allConfirmed ? "Todos os corretores da equipe Ferreira ja confirmaram." : "Aguardando confirmacao de todos os corretores."}
              </p>
            </div>
            <div className="rounded-md border border-graphite/15 bg-paper p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="ui-font text-sm font-bold">IA</span>
                {iaBusy ? <Loader2 className="animate-spin text-steel" size={16} /> : <StatusPill tone="muted">Gemini</StatusPill>}
              </div>
              <textarea
                className="control min-h-24 w-full resize-y rounded-md px-3 py-2 text-sm"
                value={iaCommand}
                onChange={(event) => setIaCommand(event.target.value)}
                placeholder="Ex: IA publique a escala"
                data-help="Digite uma ordem para a IA executar no app."
              />
              <button
                className="ui-font mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-steel px-3 py-2 font-bold text-paper disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => askIa()}
                disabled={iaBusy}
                data-help="Envia esta ordem para a IA interpretar e executar."
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

          <div className="panel rounded-lg p-4">
            <h2 className="mb-3 text-xl font-bold">Novo corretor</h2>
            <div className="grid gap-2">
              <input className="control rounded-md px-3 py-2" placeholder="Nome" value={newBroker.name} onChange={(event) => setNewBroker({ ...newBroker, name: event.target.value })} data-help="Informe o nome do novo corretor." />
              <input className="control rounded-md px-3 py-2" placeholder="Email" type="email" value={newBroker.email} onChange={(event) => setNewBroker({ ...newBroker, email: event.target.value })} data-help="Informe o email que o corretor usara para acessar o app." />
              <input className="control rounded-md px-3 py-2" placeholder="Senha inicial numerica" inputMode="numeric" value={newBroker.initialPassword} onChange={(event) => setNewBroker({ ...newBroker, initialPassword: event.target.value })} data-help="Informe uma senha inicial somente com numeros, de 4 a 10 digitos." />
              <label className="ui-font flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newBroker.canExternalDuty} onChange={(event) => setNewBroker({ ...newBroker, canExternalDuty: event.target.checked })} data-help="Define se o corretor pode trabalhar fora da sede." />
                Pode fazer externo
              </label>
              <label className="ui-font flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newBroker.active} onChange={(event) => setNewBroker({ ...newBroker, active: event.target.checked })} data-help="Define se o corretor entra na distribuicao da IA." />
                Ativo
              </label>
              <button className="ui-font inline-flex items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 font-bold text-paper" onClick={createBroker} data-help="Cria o corretor na equipe Ferreira e libera login inicial para ele.">
                <Plus size={16} />
                Adicionar
              </button>
            </div>
          </div>

          <div className="panel rounded-lg p-4">
            <h2 className="mb-3 text-xl font-bold">Minha senha</h2>
            <div className="grid gap-2">
              <input className="control rounded-md px-3 py-2" type="password" inputMode="numeric" placeholder="Senha atual" value={managerPassword.currentPassword} onChange={(event) => setManagerPassword({ ...managerPassword, currentPassword: event.target.value })} data-help="Informe sua senha atual de gerente." />
              <input className="control rounded-md px-3 py-2" type="password" inputMode="numeric" placeholder="Nova senha numerica" value={managerPassword.newPassword} onChange={(event) => setManagerPassword({ ...managerPassword, newPassword: event.target.value })} data-help="Escolha uma nova senha somente com numeros, de 4 a 10 digitos." />
              <button className="ui-font inline-flex items-center justify-center gap-2 rounded-md border border-graphite/20 bg-paper px-3 py-2 font-bold text-ink" onClick={changeManagerPassword} data-help="Altera a senha da conta do gerente Ferreira.">
                <KeyRound size={16} />
                Alterar senha
              </button>
            </div>
          </div>

          <PriorityCard
            items={snapshot?.plantaoPriorities ?? []}
            notice={priorityNotice}
            onMove={movePriority}
          />

          <div className="panel rounded-lg p-4">
            <h2 className="mb-2 text-xl font-bold">Arquivos e historico</h2>
            <p className="ui-font mb-3 text-sm text-graphite">
              Importacoes de PDF/XLSX e escalas publicadas anteriores ficam em uma area separada, restrita ao gerente.
            </p>
            <Link className="ui-font inline-flex w-full items-center justify-center rounded-md bg-ink px-3 py-2 font-bold text-paper" href="/admin/arquivo" data-help="Abre importacoes e escalas antigas do gerente.">
              Abrir arquivo
            </Link>
          </div>
        </aside>

        <div className="flex flex-col gap-5">
          <section className="panel rounded-lg p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Corretores e vendas</h2>
                <p className="ui-font text-xs text-graphite">Mes de referencia: {monthLabel(snapshot?.salesMonthStart)}. Sem valor informado, o app usa R$ 1,00.</p>
              </div>
              <StatusPill tone="muted">{snapshot?.brokers.length ?? 0} ativos/cadastrados</StatusPill>
            </div>
            <div className="overflow-hidden">
              <table className="ui-font w-full table-fixed border-collapse text-[11px] leading-tight">
                <colgroup>
                  <col className="w-[13%]" />
                  <col className="w-[19%]" />
                  <col className="w-[10%]" />
                  <col className="w-[6%]" />
                  <col className="w-[13%]" />
                  <col className="w-[7%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-graphite/15 text-left text-[9px] uppercase tracking-[0.02em] text-graphite">
                    <th className="whitespace-nowrap px-1.5 py-2">Nome</th>
                    <th className="whitespace-nowrap px-1.5 py-2">Email</th>
                    <th className="whitespace-nowrap px-1.5 py-2">Equipe</th>
                    <th className="whitespace-nowrap px-1.5 py-2 text-center">Ranking</th>
                    <th className="whitespace-nowrap px-1.5 py-2">Vendas</th>
                    <th className="whitespace-nowrap px-1.5 py-2 text-center">Hist.</th>
                    <th className="whitespace-nowrap px-1.5 py-2 text-center">Externo</th>
                    <th className="whitespace-nowrap px-1.5 py-2 text-center">Ativo</th>
                    <th className="px-1.5 py-2 text-right">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot?.brokers.map((broker) => (
                    <BrokerRow key={broker.id} broker={broker} onSave={updateBroker} onSaleSave={updateMonthlySale} onDelete={deleteBroker} onResetPassword={resetBrokerPassword} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel rounded-lg p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Escala final</h2>
              {schedule ? <StatusPill tone={schedule.status === "PUBLISHED" ? "ok" : "muted"}>{schedule.status === "PUBLISHED" ? "publicada" : "rascunho"}</StatusPill> : <StatusPill tone="warn">sem escala</StatusPill>}
            </div>
            {schedule?.assignments?.length ? (
              <>
                {schedule.aiReview ? <AiReviewCard review={schedule.aiReview} /> : null}
                <RealScheduleGrid assignments={schedule.assignments} brokers={snapshot?.brokers.filter((broker) => broker.team.isFerreira) ?? []} editable onChange={adjustAssignment} />
              </>
            ) : (
              <div className="ui-font flex items-center gap-2 rounded-md border border-signal/20 bg-signal/10 p-3 text-sm text-signal">
                <AlertTriangle size={18} />
                Importe o arquivo semanal, confirme as janelas roxas e clique em GERAR ESCALA.
              </div>
            )}
          </section>
        </div>
      </section>
    </AppShell>
  );
}

function AiReviewCard({ review }: { review: any }) {
  const recommendations = (() => {
    try {
      return JSON.parse(review.recommendations || "[]") as string[];
    } catch {
      return [];
    }
  })();
  return (
    <div className="ui-font mb-4 rounded-md border border-graphite/15 bg-paper p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <strong>Analise da IA</strong>
        <StatusPill tone={review.status === "OK" ? "ok" : review.status === "ERROR" ? "warn" : "muted"}>{review.status}</StatusPill>
      </div>
      <p>{review.summary}</p>
      {review.meritocracy ? <p className="mt-2"><strong>Meritocracia:</strong> {review.meritocracy}</p> : null}
      {review.balance ? <p className="mt-2"><strong>Equilibrio:</strong> {review.balance}</p> : null}
      {review.conflicts ? <p className="mt-2"><strong>Conflitos:</strong> {review.conflicts}</p> : null}
      {recommendations.length ? (
        <ul className="mt-2 list-disc pl-5">
          {recommendations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      {review.error ? <p className="mt-2 text-signal">{review.error}</p> : null}
    </div>
  );
}

function PriorityCard({ items, notice, onMove }: { items: Array<{ localName: string; position: number }>; notice: string; onMove: (fromIndex: number, toIndex: number) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <div className="panel rounded-lg p-4">
      <h2 className="mb-2 text-xl font-bold">Prioridade dos plantoes</h2>
      <p className="ui-font mb-3 text-sm text-graphite">Arraste os plantoes. O primeiro e o melhor; os tres primeiros ativam reservas meritocraticas.</p>
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
            <button className="rounded border border-graphite/15 p-1 disabled:opacity-30" disabled={index === 0} onClick={() => onMove(index, index - 1)} data-help="Move este plantao uma posicao para cima.">
              <ArrowUp size={14} />
            </button>
            <button className="rounded border border-graphite/15 p-1 disabled:opacity-30" disabled={index === items.length - 1} onClick={() => onMove(index, index + 1)} data-help="Move este plantao uma posicao para baixo.">
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

function BrokerRow({
  broker,
  onSave,
  onSaleSave,
  onDelete,
  onResetPassword
}: {
  broker: BrokerSnapshot;
  onSave: (broker: BrokerSnapshot, patch: Partial<BrokerSnapshot>) => void;
  onSaleSave: (broker: BrokerSnapshot, amountReais: string) => void;
  onDelete: (broker: BrokerSnapshot) => void;
  onResetPassword: (broker: BrokerSnapshot) => void;
}) {
  const [sale, setSale] = useState(broker.salesAmountReais);
  const [name, setName] = useState(broker.name);
  const [email, setEmail] = useState(broker.user?.email ?? "");
  const [external, setExternal] = useState(broker.canExternalDuty);
  const [active, setActive] = useState(broker.active);

  useEffect(() => {
    setSale(broker.salesAmountReais);
    setName(broker.name);
    setEmail(broker.user?.email ?? "");
    setExternal(broker.canExternalDuty);
    setActive(broker.active);
  }, [broker]);

  return (
    <tr className="border-b border-graphite/10 align-middle">
      <td className="px-1.5 py-1.5 font-bold">
        <input className="control w-full rounded-md px-1.5 py-1 text-[11px]" value={name} onChange={(event) => setName(event.target.value)} data-help="Edita o nome exibido do corretor." />
      </td>
      <td className="px-1.5 py-1.5">
        <input className="control w-full rounded-md px-1.5 py-1 text-[11px]" type="email" value={email} onChange={(event) => setEmail(event.target.value)} data-help="Edita o email usado como login deste corretor." />
      </td>
      <td className="break-words px-1.5 py-1.5 leading-snug">{broker.team.name}</td>
      <td className="px-1.5 py-1.5 text-center font-bold">{broker.salesRank ? `${broker.salesRank}o` : "-"}</td>
      <td className="px-1.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <span>R$</span>
          <input className="control min-w-0 flex-1 rounded-md px-1.5 py-1 text-[11px]" value={sale} onChange={(event) => setSale(event.target.value)} onBlur={() => onSaleSave(broker, sale)} data-help="Informa o total vendido no mes em reais. O ranking e recalculado automaticamente." />
        </div>
      </td>
      <td className="px-1.5 py-1.5 text-center">{broker.autoHistoryTotal}</td>
      <td className="px-1.5 py-1.5 text-center"><input type="checkbox" checked={external} onChange={(event) => setExternal(event.target.checked)} data-help="Define se o corretor pode trabalhar fora da sede." /></td>
      <td className="px-1.5 py-1.5 text-center"><input className="h-3.5 w-3.5" type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} data-help="Define se o corretor entra na distribuicao da IA." /></td>
      <td className="px-1.5 py-1.5 text-right">
        <div className="flex flex-nowrap justify-end gap-1.5">
        <button className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-ink text-paper" onClick={() => onSave(broker, { name, user: { email }, canExternalDuty: external, active })} data-help="Grava nome, login, permissao externa e status ativo desta linha." aria-label="Salvar corretor">
          <Check size={13} />
          <span className="sr-only">Salvar</span>
        </button>
        <button className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-graphite/20 bg-paper text-ink" onClick={() => onResetPassword(broker)} data-help="Define uma nova senha numerica para este corretor." aria-label="Redefinir senha">
          <KeyRound size={12} />
          <span className="sr-only">Senha</span>
        </button>
        <button className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-signal/30 bg-signal/10 text-signal" onClick={() => onDelete(broker)} data-help="Exclui este corretor, remove o login e desvincula plantões antigos." aria-label="Excluir corretor">
          <Trash2 size={12} />
          <span className="sr-only">Excluir</span>
        </button>
        </div>
      </td>
    </tr>
  );
}
