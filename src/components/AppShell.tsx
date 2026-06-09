"use client";

import Link from "next/link";
import { BarChart3, CalendarDays, ClipboardList, LogOut, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { authenticatedFetch, clearTabSessionToken, setTabSessionToken } from "@/lib/client-auth";

export function AppShell({ children, active }: { children: React.ReactNode; active: "admin" | "disponibilidade" | "escala" }) {
  const [role, setRole] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    authenticatedFetch("/api/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (payload?.sessionToken) setTabSessionToken(payload.sessionToken);
        setRole(payload?.user?.role ?? null);
      })
      .catch(() => setRole(null));
  }, []);

  const managerLinks = [
    { href: "/admin", label: "PUBLICAR ESCALA", key: "admin", icon: Shield, help: "Painel do gerente: importar, gerar e publicar a escala, e gerir corretores." },
    { href: "/disponibilidade", label: "INDISPONIBILIDADES", key: "disponibilidade", icon: ClipboardList, help: "Abre a visualizacao mensal de indisponibilidades dos corretores." },
    { href: "/escala", label: "ESCALA/RANKING", key: "escala", icon: BarChart3, help: "Mostra o ranking de vendas e a escala publicada da semana." }
  ] as const;
  const brokerLinks = [
    { href: "/disponibilidade", label: "INDISPONIBILIDADES", key: "disponibilidade", icon: ClipboardList, help: "Abre o calendario mensal para marcar os dias e turnos em que nao pode trabalhar." },
    { href: "/escala", label: "ESCALA/RANKING", key: "escala", icon: BarChart3, help: "Mostra o ranking de vendas e a escala publicada da semana." }
  ] as const;
  const links = useMemo(() => {
    if (role === "BROKER") return brokerLinks;
    if (role === "MANAGER") return managerLinks;
    return active === "admin" ? managerLinks : brokerLinks;
  }, [active, role]);

  async function logout() {
    try {
      setLoggingOut(true);
      await authenticatedFetch("/api/auth/logout", { method: "POST" });
    } finally {
      clearTabSessionToken();
      window.location.href = "/login";
    }
  }

  return (
    <main className="min-h-screen px-3 py-4 text-ink sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-[24px] bg-ink p-4 text-paper shadow-panel lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full border border-sand/50 bg-paper/5 text-sand">
              <CalendarDays size={24} />
            </div>
            <div>
              <p className="ui-font text-xs font-bold uppercase tracking-[0.18em] text-sand">App Escala MD</p>
              <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">Escala inteligente do Ferreira</h1>
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
                    selected ? "border-sand bg-sand text-ink" : "border-paper/15 bg-paper/5 text-paper hover:border-sand"
                  }`}
                >
                  <Icon size={16} />
                  {link.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              data-help="Sai desta conta e volta para a tela de login."
              className="inline-flex items-center gap-2 rounded-md border border-paper/15 bg-paper/5 px-3 py-2 text-sm font-bold text-paper hover:border-signal disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogOut size={16} />
              {loggingOut ? "Saindo" : "Sair"}
            </button>
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}
