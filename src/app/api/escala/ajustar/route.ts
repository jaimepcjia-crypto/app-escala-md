import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json(
    { error: "A escala nao pode ser editada diretamente. Solicite a alteracao pela IA do gerente." },
    { status: 403 }
  );
}
