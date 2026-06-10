"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { StatusPill } from "@/components/StatusPill";
import { WeeklyScheduleAgenda } from "@/components/WeeklyScheduleAgenda";
import { AiReviewCard } from "@/components/AiReviewCard";
import { ScheduleChangeNotices } from "@/components/ScheduleChangeNotices";
import { normalizeWeekStart } from "@/lib/constants";
import { currentSaoPauloWeekStart } from "@/lib/deadlines";
import { authenticatedFetch, setTabSessionToken } from "@/lib/client-auth";

type PublicData = {
  weekStart?: string;
  schedule: null | {
    id: string;
    status: string;
    publishedAt?: string | null;
    import?: { id: string; fileName: string; layoutJson?: string | null } | null;
    assignments: any[];
    aiReview?: any | null;
    changeNotices?: any[];
  };
  brokers: Array<{
    id: string;
    name: string;
    team: { name: string; isFerreira?: boolean };
  }>;
};

function currentWeekStart() {
  return currentSaoPauloWeekStart().toISOString().slice(0, 10);
}

function normalizeWeekInput(value: string) {
  return normalizeWeekStart(value).toISOString().slice(0, 10);
}

export default function SchedulePage() {
  const [data, setData] = useState<PublicData | null>(null);
  const [me, setMe] = useState<any>(null);
  const [weekStart, setWeekStart] = useState(currentWeekStart());
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    authenticatedFetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return response.json();
      })
      .then((payload) => {
        if (payload) {
          if (payload.sessionToken) setTabSessionToken(payload.sessionToken);
          setMe(payload.user);
        }
      });
  }, []);

  const isManager = me?.role === "MANAGER";

  async function reload() {
    // Gerente escolhe a semana; corretor recebe a semana atual (a API força).
    const query = isManager ? `?weekStart=${weekStart}` : "";
    const response = await authenticatedFetch(`/api/escala/publica${query}`, { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    const payload = await response.json();
    if (!response.ok) {
      setLoadError(payload.error ?? "Falha ao carregar a escala.");
      return;
    }
    setLoadError("");
    setData(payload);
  }

  useEffect(() => {
    if (!me) return;
    void reload();
  }, [me, isManager, weekStart]);

  const schedule = data?.schedule ?? null;
  return (
    <AppShell active="escala">
      <div className="flex flex-col gap-5">
        <section className="grid gap-4">
          <div className="hero-panel rounded-[26px] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Agenda publicada</p>
              <h2 className="mt-1 text-3xl font-semibold">Escala final da semana</h2>
              <p className="ui-font mt-1 text-xs text-graphite">
                Uma leitura por dia, horário e local. Alterações de atribuição são feitas exclusivamente por pedidos à IA do gerente.
              </p>
            </div>
            {isManager ? (
              <label className="ui-font text-xs font-bold">
                Semana
                <input
                  className="control mt-1 rounded-md px-2 py-1 text-sm"
                  type="date"
                  value={weekStart}
                  onChange={(event) => setWeekStart(normalizeWeekInput(event.target.value))}
                  data-help="Escolha a semana da escala (so o gerente). O app ajusta para a segunda-feira."
                />
              </label>
            ) : schedule ? (
              <StatusPill tone="ok">publicada</StatusPill>
            ) : (
              <StatusPill tone="warn">aguardando</StatusPill>
            )}
            </div>
          </div>

          {loadError ? <div className="ui-font mb-4 rounded-md border border-signal/30 bg-signal/10 p-3 text-sm font-bold text-signal">{loadError}</div> : null}
          {schedule?.aiReview ? <AiReviewCard review={schedule.aiReview} /> : null}
          <ScheduleChangeNotices notices={schedule?.changeNotices} />

          {schedule?.assignments?.length ? (
            <WeeklyScheduleAgenda
              assignments={schedule.assignments}
              weekStart={data?.weekStart ?? weekStart}
              brokerId={me?.broker?.id ?? null}
              isManager={isManager}
            />
          ) : (
            <div className="ui-font rounded-md border border-graphite/15 bg-paper p-4 text-sm text-graphite">
              Nenhuma escala publicada para esta semana.
            </div>
          )}
        </section>

        {/* Memorando: como o sistema distribui os plantoes (visivel a todos) */}
        <section className="panel rounded-lg p-4">
          <div className="mb-2">
            <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Memorando</p>
            <h2 className="text-xl font-bold">Como os plantões são distribuídos</h2>
            <p className="ui-font mt-1 text-xs text-graphite">
              Regras públicas de segurança e equilíbrio usadas pelo motor.
            </p>
          </div>

          <div className="ui-font space-y-3 text-sm">
            <div className="rounded-md border border-graphite/15 bg-paper p-3">
              <div className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-graphite">
                Primeiro, regras que tiram o corretor do plantão (travas)
              </div>
              <ul className="list-disc pl-5 text-graphite">
                <li>Indisponibilidade: quem marcou “não pode” naquele horário não entra.</li>
                <li>Plantão externo: só corretores autorizados a fazer externo.</li>
                <li>Não pode estar em dois plantões no mesmo horário.</li>
                <li>Corretor inativo não entra na distribuição.</li>
              </ul>
            </div>

            <div className="rounded-md border border-graphite/15 bg-linen/50 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-graphite">
                Depois, entre os que podem, vale o peso de cada critério
              </div>
              <ul className="space-y-2 text-graphite">
                <li>
                  <strong className="text-ink">1) Equilíbrio entre os corretores.</strong> Quem já
                  pegou mais plantões no geral cede a vez, para a distribuição ficar justa.
                </li>
                <li>
                  <strong className="text-ink">2) Não concentrar o mesmo tipo de plantão.</strong>{" "}
                  Evita que sempre o mesmo corretor pegue o mesmo tipo de plantão.
                </li>
                <li>
                  <strong className="text-ink">3) Espalhar ao longo da semana.</strong> Evita
                  acumular muitos plantões do mesmo corretor na mesma semana.
                </li>
                <li>
                  <strong className="text-ink">4) Desempate justo.</strong> Quando dá empate, um sorteio leve
                  decide, sem favorecer ninguém.
                </li>
              </ul>
            </div>

            <p className="text-xs text-graphite">
              Observação: o gerente pode pedir à IA o “modo mais equilibrado”, que aumenta o peso do
              equilíbrio entre os corretores nessa geração.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
