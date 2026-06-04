import { clsx } from "clsx";

export function StatusPill({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "ui-font inline-flex items-center rounded-full border px-2 py-1 text-xs font-bold",
        tone === "ok" && "border-moss/30 bg-moss/10 text-moss",
        tone === "warn" && "border-signal/30 bg-signal/10 text-signal",
        tone === "muted" && "border-graphite/20 bg-graphite/5 text-graphite"
      )}
    >
      {children}
    </span>
  );
}
