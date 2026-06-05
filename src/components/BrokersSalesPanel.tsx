"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";

export type BrokerSnapshot = {
  id: string;
  name: string;
  user?: { email: string; passwordPlain?: string | null } | null;
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

export type BrokerSavePatch = {
  name: string;
  user: { email: string };
  password: string;
  canExternalDuty: boolean;
  active: boolean;
};

function monthLabel(value?: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

// Monta a URL pessoal de acesso (pré-preenche o e-mail no login).
export function accessUrlFor(email: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/login?email=${encodeURIComponent(email)}`;
}

export function BrokersSalesPanel({
  brokers,
  salesMonthStart,
  onSave,
  onSaleSave,
  onDelete
}: {
  brokers: BrokerSnapshot[];
  salesMonthStart?: string;
  onSave: (broker: BrokerSnapshot, patch: BrokerSavePatch) => void | Promise<void>;
  onSaleSave: (broker: BrokerSnapshot, amountReais: string) => void | Promise<void>;
  onDelete: (broker: BrokerSnapshot) => void | Promise<void>;
}) {
  return (
    <section className="panel rounded-lg p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Corretores, logins e vendas</h2>
          <p className="ui-font text-xs text-graphite">
            Email = login. Senha numerica (4-10 digitos), editavel. O link copia o acesso pessoal (abre o login com o email preenchido).
          </p>
        </div>
        <StatusPill tone="muted">{brokers.length} ativos/cadastrados</StatusPill>
      </div>
      <div className="overflow-hidden">
        <table className="ui-font w-full table-fixed border-collapse text-[11px] leading-tight">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[17%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[6%]" />
            <col className="w-[11%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
            <col className="w-[21%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-graphite/15 text-left text-[9px] uppercase tracking-[0.02em] text-graphite">
              <th className="whitespace-nowrap px-1.5 py-2">Nome</th>
              <th className="whitespace-nowrap px-1.5 py-2">Email (login)</th>
              <th className="whitespace-nowrap px-1.5 py-2">Senha</th>
              <th className="whitespace-nowrap px-1.5 py-2">Equipe</th>
              <th className="whitespace-nowrap px-1.5 py-2 text-center">Ranking</th>
              <th className="whitespace-nowrap px-1.5 py-2">Vendas</th>
              <th className="whitespace-nowrap px-1.5 py-2 text-center">Hist.</th>
              <th className="whitespace-nowrap px-1.5 py-2 text-center">Ext.</th>
              <th className="whitespace-nowrap px-1.5 py-2 text-center">Ativo</th>
              <th className="px-1.5 py-2 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {brokers.map((broker) => (
              <BrokerRow key={broker.id} broker={broker} onSave={onSave} onSaleSave={onSaleSave} onDelete={onDelete} />
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
  onDelete
}: {
  broker: BrokerSnapshot;
  onSave: (broker: BrokerSnapshot, patch: BrokerSavePatch) => void | Promise<void>;
  onSaleSave: (broker: BrokerSnapshot, amountReais: string) => void | Promise<void>;
  onDelete: (broker: BrokerSnapshot) => void | Promise<void>;
}) {
  const [sale, setSale] = useState(broker.salesAmountReais);
  const [name, setName] = useState(broker.name);
  const [email, setEmail] = useState(broker.user?.email ?? "");
  const [password, setPassword] = useState(broker.user?.passwordPlain ?? "");
  const [external, setExternal] = useState(broker.canExternalDuty);
  const [active, setActive] = useState(broker.active);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSale(broker.salesAmountReais);
    setName(broker.name);
    setEmail(broker.user?.email ?? "");
    setPassword(broker.user?.passwordPlain ?? "");
    setExternal(broker.canExternalDuty);
    setActive(broker.active);
  }, [broker]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(accessUrlFor(email));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard pode falhar em contexto inseguro — ignora */
    }
  }

  return (
    <tr className="border-b border-graphite/10 align-middle">
      <td className="px-1.5 py-1.5 font-bold">
        <input className="control w-full rounded-md px-1.5 py-1 text-[11px]" value={name} onChange={(event) => setName(event.target.value)} data-help="Edita o nome exibido do corretor." />
      </td>
      <td className="px-1.5 py-1.5">
        <input className="control w-full rounded-md px-1.5 py-1 text-[11px]" type="email" value={email} onChange={(event) => setEmail(event.target.value)} data-help="Edita o email usado como login deste corretor." />
      </td>
      <td className="px-1.5 py-1.5">
        <input className="control w-full rounded-md px-1.5 py-1 text-[11px]" inputMode="numeric" value={password} onChange={(event) => setPassword(event.target.value)} data-help="Senha numerica de acesso do corretor (4 a 10 digitos). Visivel e editavel." />
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
        <div className="flex flex-nowrap items-center justify-end gap-1.5">
          <button className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-ink text-paper" onClick={() => onSave(broker, { name, user: { email }, password, canExternalDuty: external, active })} data-help="Grava nome, login, senha, permissao externa e status ativo desta linha." aria-label="Salvar corretor">
            <Check size={13} />
            <span className="sr-only">Salvar</span>
          </button>
          <button className={`inline-flex h-7 items-center justify-center gap-1 rounded-md border px-2 ${copied ? "border-signal/30 bg-signal/10 text-signal" : "border-graphite/20 bg-paper text-ink"}`} onClick={copyLink} data-help="Copia o link de acesso pessoal deste corretor (abre o login com o email preenchido)." aria-label="Copiar link de acesso">
            <Copy size={12} />
            <span className="text-[10px] font-bold">{copied ? "copiado!" : "link"}</span>
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
