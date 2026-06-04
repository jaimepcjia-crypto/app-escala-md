"use client";

import Link from "next/link";
import { Archive, CalendarDays, ClipboardList, Eye, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function AppShell({ children, active }: { children: React.ReactNode; active: "admin" | "arquivo" | "disponibilidade" | "escala" }) {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setRole(payload?.user?.role ?? null))
      .catch(() => setRole(null));
  }, []);

  const managerLinks = [
    { href: "/admin", label: "Gerente", key: "admin", icon: Shield, help: "Abre o painel administrativo do Ferreira." },
    { href: "/admin/arquivo", label: "Arquivo", key: "arquivo", icon: Archive, help: "Abre importacoes e escalas publicadas anteriores do gerente." },
    { href: "/disponibilidade", label: "Nao pode", key: "disponibilidade", icon: ClipboardList, help: "Abre a visualizacao mensal de indisponibilidades dos corretores." },
    { href: "/escala", label: "Escala", key: "escala", icon: Eye, help: "Mostra a escala publicada da semana." }
  ] as const;
  const brokerLinks = [
    { href: "/disponibilidade", label: "Nao pode", key: "disponibilidade", icon: ClipboardList, help: "Abre o calendario mensal para marcar os dias e turnos em que nao pode trabalhar." },
    { href: "/escala", label: "Escala", key: "escala", icon: Eye, help: "Mostra a escala publicada da semana." }
  ] as const;
  const links = useMemo(() => {
    if (role === "BROKER") return brokerLinks;
    if (role === "MANAGER") return managerLinks;
    return active === "admin" || active === "arquivo" ? managerLinks : brokerLinks;
  }, [active, role]);

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="panel flex flex-col gap-4 rounded-lg p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-md bg-ink text-paper">
              <CalendarDays size={24} />
            </div>
            <div>
              <p className="ui-font text-xs font-bold uppercase tracking-[0.18em] text-signal">App Escala MD</p>
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">Escala inteligente do Ferreira</h1>
            </div>
          </div>
          <nav className="ui-font flex flex-wrap gap-2">
            {links.map((link) => {
              const Icon = link.icon;
              const selected = active === link.key;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  data-help={link.help}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold ${
                    selected ? "border-ink bg-ink text-paper" : "border-graphite/20 bg-paper text-ink hover:border-signal"
                  }`}
                >
                  <Icon size={16} />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}
