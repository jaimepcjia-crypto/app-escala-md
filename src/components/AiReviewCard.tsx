"use client";

import { StatusPill } from "@/components/StatusPill";

// Card "Resultado da publicação" — análise da IA sobre a escala publicada.
export function AiReviewCard({ review }: { review: any }) {
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
        <strong>Resultado da publicação</strong>
        <StatusPill tone={review.status === "ERROR" ? "warn" : review.status === "DISABLED" ? "muted" : "ok"}>
          {review.status === "OK" ? "analisada" : review.status === "ERROR" ? "atenção" : "sem IA"}
        </StatusPill>
      </div>
      <div className="rounded-md border border-graphite/15 bg-linen/50 p-2">
        <div className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-graphite">O que aconteceu</div>
        <p>{review.summary}</p>
      </div>
      {review.conflicts ? (
        <div className="mt-2 rounded-md border border-signal/20 bg-signal/10 p-2">
          <div className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-signal">Atenção</div>
          <p>{review.conflicts}</p>
        </div>
      ) : null}
      {review.meritocracy ? <p className="mt-2"><strong>Critério de vendas:</strong> {review.meritocracy}</p> : null}
      {review.balance ? <p className="mt-2"><strong>Equilíbrio:</strong> {review.balance}</p> : null}
      {recommendations.length ? (
        <ul className="mt-2 list-disc pl-5">
          {recommendations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      {review.error ? <p className="mt-2 text-signal">{review.error}</p> : null}
    </div>
  );
}
