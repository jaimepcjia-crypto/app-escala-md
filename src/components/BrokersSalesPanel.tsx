"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, Trash2 } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";

export type BrokerSnapshot = {
  id: string;
  name: string;
  user?: { email: string } | null;
  salesAmountReais: string;
  salesRank: number | null;
  salesRankLabel: string;
  salesTieSize: number;
  salesOrdinalStart: number | null;
  salesOrdinalEnd: number | null;
  autoHistoryTotal: number;
  canExternalDuty: boolean;
  active: boolean;
  team: { name: string; isFerreira: boolean };
};

function monthLabel(value?: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function BrokersSalesPanel({
  brokers,
  salesMonthStart,
  onSave,
  onSaleSave,
  onDelete,
  onResetPassword
}: {
  brokers: BrokerSnapshot[];
  salesMonthStart?: string;
  onSave: (broker: BrokerSnapshot, patch: Partial<BrokerSnapshot>) => void | Promise<void>;
  onSaleSave: (broker: BrokerSnapshot, amountReais: string) => void | Promise<void>;
  onDelete: (broker: BrokerSnapshot) => void | Promise<void>;
  onResetPassword: (broker: BrokerSnapshot) => void | Promise<void>;
}) {
  return (
    <section className="panel rounded-lg p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Corretores e vendas</h2>
          <p className="ui-font text-xs text-graphite">
            Mes de referencia: {monthLabel(salesMonthStart)}. Sem valor informado, o app usa R$ 1,00. Valores iguais ficam empatados.
          </p>
        </div>
        <StatusPill tone="muted">{brokers.length} ativos/cadastrados</StatusPill>
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
            {brokers.map((broker) => (
              <BrokerRow key={broker.id} broker={broker} onSave={onSave} onSaleSave={onSaleSave} onDelete={onDelete} onResetPassword={onResetPassword} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
  onSave: (broker: BrokerSnapshot, patch: Partial<BrokerSnapshot>) => void | Promise<void>;
  onSaleSave: (broker: BrokerSnapshot, amountReais: string) => void | Promise<void>;
  onDelete: (broker: BrokerSnapshot) => void | Promise<void>;
  onResetPassword: (broker: BrokerSnapshot) => void | Promise<void>;
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
      <td className="px-1.5 py-1.5 text-center font-bold">{broker.salesRankLabel ?? "-"}</td>
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
