import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { applyReconciliationAndFinalize } from "@/lib/import-workflow";
import { invalidatePendingChangeRequests } from "@/lib/ai-schedule-changes";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireManager(request);
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { importId, decisions } = body as { importId: string; decisions: Record<string, string> };

    if (!importId || !decisions || typeof decisions !== "object") {
      return NextResponse.json({ error: "importId e decisions sao obrigatorios." }, { status: 400 });
    }

    // Aplica as decisões e finaliza o import.
    const finalized = await applyReconciliationAndFinalize(importId, decisions);

    // Invalida mudanças pendentes.
    await invalidatePendingChangeRequests(finalized.weekStart);

    return NextResponse.json({
      import: finalized,
      summary: {
        total: finalized.cells.length,
        ferreiraWindows: finalized.cells.filter((cell) => cell.ownerType === "FERREIRA_WINDOW").length,
        external: finalized.cells.filter((cell) => cell.ownerType === "EXTERNAL_IMPORTED").length
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na reconciliacao." }, { status: 500 });
  }
}
