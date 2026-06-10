import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireManager(request);
  if ("error" in auth) return auth.error;

  return NextResponse.json({
    error: "A publicação direta foi desativada. Solicite a geração à IA e confirme a prévia analisada."
  }, { status: 403 });
}
