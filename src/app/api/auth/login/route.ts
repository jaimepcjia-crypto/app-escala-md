import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, normalizeEmail, setSessionCookie, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  const user = await prisma.user.findUnique({
    where: { email },
    include: { broker: { include: { team: true } } }
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Email ou senha invalidos." }, { status: 401 });
  }

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      broker: user.broker
    }
  });
  setSessionCookie(response, createSessionToken(user));
  return response;
}
