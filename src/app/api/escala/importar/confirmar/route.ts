import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { confirmScheduleImport } from "@/lib/import-workflow";

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const importId = String(body.importId ?? "");
  if (!importId) return NextResponse.json({ error: "Importacao obrigatoria." }, { status: 400 });

  try {
    const scheduleImport = await confirmScheduleImport(importId);
    return NextResponse.json({ import: scheduleImport });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao confirmar importacao." }, { status: 400 });
  }
}
